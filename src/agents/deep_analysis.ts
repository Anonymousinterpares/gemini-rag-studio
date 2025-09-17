// src/agents/deep_analysis.ts
// Sectioned Deep Analysis pipeline (Planner -> Per-section retrieval -> Summarizer -> Composer -> Gap analysis)

import { VectorStore } from '../rag/pipeline';
import { AppSettings } from '../config';
import { ChatMessage, SearchResult } from '../types';
import { generateContent } from '../api/llm-provider';
import { Model } from '../types';

export type PlanSection = {
  name: string;
  objective: string;
  maxBullets: number;
};

export type Plan = {
  sections: PlanSection[];
  targetWordCount: number;
};

export type SectionSummary = {
  section: string;
  bullets: { text: string; citations: { id: string; start: number; end: number }[] }[];
};

export type DeepAnalysisResult = {
  plan: Plan;
  sections: SectionSummary[];
  finalText: string;
  usedResults: SearchResult[];
  coverage: { [section: string]: number };
  llmTokens: { promptTokens: number; completionTokens: number };
};

// Intent-centric structures for reasoning-first orchestration
export type AnswerSpec = {
  intent: string;
  dimensions: string[]; // induced from intent, e.g., identity, traits, relationships, arc, quotes, summary
  style?: { language?: string; thoroughness?: 'concise' | 'balanced' | 'comprehensive' };
  rubric?: string[]; // success checks in natural language
};

export type EvidenceRef = { id: string; start: number; end: number; quote?: string };
export type Claim = {
  text: string;
  type?: string; // trait | relationship | arc | event | theme | other
  entities?: string[];
  evidence: EvidenceRef[];
  confidence?: number; // 0..1
  dimension?: string; // which induced dimension this supports
};

export async function runDeepAnalysis(opts: {
  query: string;
  history: ChatMessage[];
  vectorStore: VectorStore;
  model: Model;
  apiKey: string | undefined;
  settings: AppSettings;
  embedQuery: (q: string) => Promise<number[]>;
  rerank?: (query: string, docs: { chunk: string; id: string; start: number; end: number }[]) => Promise<SearchResult[]>;
  level: 1 | 2 | 3;
}): Promise<DeepAnalysisResult> {
  const { query, vectorStore, model, apiKey, settings, embedQuery, level } = opts;

  // 1) Quick horizon scan via pre-retrieval
  const qEmb = await embedQuery(query);
  const initialK = Math.min(30, Math.max(10, Math.floor((settings.numInitialCandidates || 20) * 1.5)));
  const pre = vectorStore.search(qEmb, initialK);

  // 2) Planner (simple baseline plan)
  const plannerPrompt = `You are a planning agent. Given the user's query and the type of content available, propose a set of sections (3-8) to cover the topic thoroughly. Output JSON with {"sections":[{"name":"...","objective":"...","maxBullets":N}],"targetWordCount":number}. Query: ${query}`;
  let plan: Plan = { sections: [{ name: 'Overview', objective: 'Overview of findings', maxBullets: 5 }], targetWordCount: 600 };
  try {
    const resp = await generateContent(model, apiKey, [{ role: 'user', content: plannerPrompt }]);
    const text = resp.text.trim();
    const json = JSON.parse(text.replace(/^```json\n?|```$/g, '')) as Plan;
    if (json.sections?.length) plan = json;
  } catch {
    // keep baseline plan
  }

  // Utility: wrapped generateContent with parallel execution, retry logic, and token accumulation
  let totalPrompt = 0;
  let totalCompletion = 0;
  let llmCallCount = 0;
  const llm = async (content: string, retryCount = 0): Promise<any> => {
    const maxRetries = 10;
    const delays = [1000, 5000, 10000]; // 1s, 5s, 10s, then 10s repeatedly
    
    try {
      const resp = await generateContent(opts.model, opts.apiKey, [{ role: 'user', content }]);
      totalPrompt += resp.usage.promptTokens;
      totalCompletion += resp.usage.completionTokens;
      llmCallCount += 1;
      return resp;
    } catch (error) {
      if (retryCount >= maxRetries) {
        if (opts.settings.isLoggingEnabled) {
          console.error(`[Deep Analysis] Max retries (${maxRetries}) exceeded for LLM call. Giving up.`);
        }
        throw error;
      }
      
      const delayIndex = Math.min(retryCount, delays.length - 1);
      const delay = retryCount < delays.length ? delays[delayIndex] : delays[delays.length - 1];
      
      if (opts.settings.isLoggingEnabled) {
        console.warn(`[Deep Analysis] LLM call failed (attempt ${retryCount + 1}/${maxRetries + 1}). Retrying in ${delay}ms...`);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return llm(content, retryCount + 1);
    }
  };
  
  // Parallel execution helper with concurrency limit
  const executeInParallel = async <T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = 8): Promise<R[]> => {
    const results: R[] = [];
    const executing: Promise<void>[] = [];
    
    for (let i = 0; i < items.length; i++) {
      const promise = fn(items[i]).then(result => {
        results[i] = result;
      });
      executing.push(promise);
      
      if (executing.length >= concurrency || i === items.length - 1) {
        await Promise.all(executing);
        executing.length = 0;
      }
    }
    
    return results;
  };

  // Simple serializer to enforce single-flight for coordinator-backed calls (embed/rerank)
  const makeSerializer = () => {
    let current: Promise<any> = Promise.resolve();
    return async <T>(fn: () => Promise<T>): Promise<T> => {
      const run = async () => await fn();
      const p = current.then(run, run);
      // Advance chain regardless of outcome to avoid deadlock
      current = p.then(() => {}, () => {});
      return p;
    };
  };
  const serializeEmbed = makeSerializer();
  const serializeRerank = makeSerializer();
  const embedSafe = (q: string) => serializeEmbed(() => embedQuery(q));
  const rerankSafe = (queryStr: string, docs: { chunk: string; id: string; start: number; end: number }[]) => serializeRerank(() => opts.rerank!(queryStr, docs));
  

  // 2.5) Intent Interpreter -> Answer Spec
  let answerSpec: AnswerSpec = {
    intent: 'Provide an accurate, organized, evidence-backed answer aligned to user intent.',
    dimensions: plan.sections.map(s => s.name),
    style: { thoroughness: level === 3 ? 'comprehensive' : 'balanced' },
    rubric: [
      'Covers all induced dimensions with organized headings',
      'Uses persona-level claims rather than listing micro-events',
      'Anchors important claims with explicit evidence and minimal, telling quotes',
      'Consistent language and style; reconcile contradictions or flag uncertainties',
    ],
  };
  try {
    const intentPrompt = `Infer the user's intent and output requirements from the prompt and history. Return strict JSON with keys: intent (string), dimensions (string[]), style {language?: string, thoroughness?: "concise"|"balanced"|"comprehensive"}, rubric (string[]).\nUser prompt: ${query}\nHistory:\n${opts.history.map(m => `${m.role}: ${m.content}`).join('\n')}`;
    const intentResp = await llm(intentPrompt);
    const text = intentResp.text.replace(/^```json\n?|```$/g, '').trim();
    const parsed = JSON.parse(text) as AnswerSpec;
    if (parsed && parsed.dimensions && parsed.dimensions.length) {
      answerSpec = parsed;
    }
  } catch {}

  // 3) Per-section retrieval with query expansion and optional rerank (PARALLELIZED)
  const perSectionResults: Record<string, SearchResult[]> = {};
  
  const processSection = async (sec: PlanSection): Promise<{ name: string; results: SearchResult[] }> => {
    // Generate 2-3 targeted sub-queries for this section
    let subQs: string[] = [];
    try {
      const qPrompt = `You are a query expansion assistant. Generate 2-3 short, specific search queries to retrieve evidence for the section: "${sec.name}" in the context of user query: ${query}. Return a JSON array of strings.`;
      const qResp = await llm(qPrompt);
      const jsonTxt = qResp.text.replace(/^```json\n?|```$/g, '').trim();
      const parsed = JSON.parse(jsonTxt);
      if (Array.isArray(parsed) && parsed.length) subQs = parsed.slice(0, 3);
    } catch {}
    if (subQs.length === 0) subQs = [`${query} ${sec.name}`];

    // Run independent vector searches per sub-query IN PARALLEL
    const k = Math.min(50, Math.max(15, (settings.numInitialCandidates || 20)));
    const searchPromises = subQs.map(async (sq) => {
      const emb = await embedSafe(sq); // serialize due to single resolver design
      return opts.vectorStore.search(emb, k) || [];
    });
    const searchResults = await Promise.all(searchPromises);
    const merged: SearchResult[] = searchResults.flat();

    // Optional rerank
    let ranked: SearchResult[] = merged;
    if (opts.rerank) {
      const docs = merged.map(r => ({ chunk: r.chunk, id: r.id, start: r.start, end: r.end }));
      try {
        ranked = await rerankSafe(`${query} ${sec.name}`, docs); // serialize due to single resolver design
      } catch {}
    }

    // Entity-aware boost: if the query contains capitalized entities, soft-boost chunks near their mentions
    try {
      const entityCandidates = Array.from(new Set((query.match(/\b([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'\-]+(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'\-]+)*)\b/g) || []).map(s => s.trim().toLowerCase())));
      if (entityCandidates.length > 0 && typeof vectorStore.getEntityMentions === 'function') {
        const boosted = ranked.map(r => {
          const mentions = entityCandidates.flatMap(e => vectorStore.getEntityMentions(r.id, e));
          let nearest = Infinity;
          for (const m of mentions) {
            const dist = Math.min(Math.abs(m - r.start), Math.abs(m - r.end));
            if (dist < nearest) nearest = dist;
          }
          const bonus = Number.isFinite(nearest) ? Math.max(0, 1 - Math.min(nearest, 3000) / 3000) * 0.1 : 0; // up to +0.1
          return { ...r, similarity: r.similarity + bonus } as SearchResult;
        });
        boosted.sort((a,b)=>b.similarity - a.similarity);
        ranked = boosted;
      }
    } catch {}

    // Coverage-aware selection with near-duplicate clustering and span quotas
    const byDoc = new Map<string, SearchResult[]>();
    for (const r of ranked) {
      if (!byDoc.has(r.id)) byDoc.set(r.id, []);
      byDoc.get(r.id)!.push(r);
    }

    const selected: SearchResult[] = [];
    const maxPerDoc = 3; // soft cap to avoid piling from a single id
    for (const [docId, list] of byDoc.entries()) {
      // Simple near-duplicate clustering within a doc: group by parent range window
      // Using start index windowing as proxy; can be upgraded to vector sim if needed
      const clusters: SearchResult[][] = [];
      const windowSize = 1500; // characters
      list.sort((a, b) => a.start - b.start);
      for (const item of list) {
        let placed = false;
        for (const cluster of clusters) {
          const head = cluster[0];
          if (Math.abs(head.start - item.start) < windowSize) { cluster.push(item); placed = true; break; }
        }
        if (!placed) clusters.push([item]);
      }
      // Take the best from each cluster by similarity
      const clusterHeads = clusters.map(c => c.sort((a, b) => b.similarity - a.similarity)[0]);
      clusterHeads.sort((a, b) => b.similarity - a.similarity);

      // Span-aware quota: distribute picks across early/middle/late windows
      const span = vectorStore.getDocSpan ? vectorStore.getDocSpan(docId) : undefined;
      const quota = Math.min(maxPerDoc, Math.max(1, sec.maxBullets - 1));
      if (span) {
        const { minStart, maxEnd } = span;
        const w1 = minStart + (maxEnd - minStart) / 3;
        const w2 = minStart + 2 * (maxEnd - minStart) / 3;
        const early: SearchResult[] = [];
        const middle: SearchResult[] = [];
        const late: SearchResult[] = [];
        for (const ch of clusterHeads) {
          if (ch.start <= w1) early.push(ch);
          else if (ch.start <= w2) middle.push(ch);
          else late.push(ch);
        }
        // Sort each bin by similarity
        early.sort((a,b)=>b.similarity-a.similarity);
        middle.sort((a,b)=>b.similarity-a.similarity);
        late.sort((a,b)=>b.similarity-a.similarity);
        const bins = [early, middle, late];
        // Round-robin take from bins until quota
        const picks: SearchResult[] = [];
        let bi = 0;
        while (picks.length < quota && (early.length || middle.length || late.length)) {
          const bin = bins[bi % bins.length];
          if (bin.length) picks.push(bin.shift()!);
          bi++;
          if (bi > 100) break; // safety
        }
        // If still short, fill from remaining clusterHeads
        if (picks.length < quota) {
          const remainingCH = clusterHeads.filter(h => !picks.some(p => p.start===h.start && p.end===h.end));
          picks.push(...remainingCH.slice(0, quota - picks.length));
        }
        selected.push(...picks);
      } else {
        selected.push(...clusterHeads.slice(0, quota));
      }
    }

    // If we still have room, fill with MMR globally
    const target = Math.min(10, sec.maxBullets * 2);
    const picked = selected.slice(0, target);
    const remaining = ranked.filter(r => !picked.some(p => p.id === r.id && p.start === r.start && p.end === r.end));
    const lambda = 0.7;
    while (picked.length < target && remaining.length > 0) {
      let bestIdx = 0; let bestScore = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const rel = cand.similarity;
        let red = 0;
        for (const s of picked) {
          // Redundancy proxy: proximity in the same doc reduces novelty
          if (s.id === cand.id) {
            const dist = Math.abs(s.start - cand.start);
            red = Math.max(red, Math.max(0, (windowSize - dist) / windowSize));
          }
        }
        const score = lambda * rel - (1 - lambda) * red;
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
      picked.push(remaining.splice(bestIdx, 1)[0]);
    }

    return { name: sec.name, results: picked };
  };
  
  // Process all sections in parallel
  const sectionPromises = plan.sections.map(processSection);
  const sectionData = await Promise.all(sectionPromises);
  
  // Populate results map
  for (const { name, results } of sectionData) {
    perSectionResults[name] = results;
  }

  // 4) Summarize each section (strict citations)
  let sections: SectionSummary[] = [];
  const coverage: { [section: string]: number } = {};
  const summarizeSection = async (sec: PlanSection, results: SearchResult[]): Promise<SectionSummary> => {
    // Provide context with explicit IDs to the model
    const context = results.map((r, i) => `[#${i + 1}] id:${r.id} start:${r.start} end:${r.end}\n${r.chunk}`).join('\n\n');
    const summarizerPrompt = `Summarize evidence for section \"${sec.name}\". Produce up to ${sec.maxBullets} bullets. For each fact, cite using [Source: id] where id is the \"id\" of the numbered context item (e.g., [#3] -> [Source: id-of-item-3]). Do NOT cite by number. Context:\n${context}`;
    const resp = await generateContent(model, apiKey, [{ role: 'user', content: summarizerPrompt }]);

    // Post-process: if the model returned numeric citations, convert them to [Source: id]
    let text = resp.text;
    text = text.replace(/\[Source:\s*(\d+)\]/g, (_, n) => {
      const idx = parseInt(n, 10) - 1; const id = results[idx]?.id; return id ? `[Source: ${id}]` : `[Source: ${n}]`;
    });
    text = text.replace(/\[Source:\s*([\d\s,]+)\]/g, (m, group) => {
      const ids = group.split(',').map(s => parseInt(s.trim(), 10) - 1).map(i => results[i]?.id).filter(Boolean);
      return ids.length ? `[Source: ${ids.join(', ')}]` : m;
    });

    return { section: sec.name, bullets: [{ text, citations: [] }] };
  };

  // Compile global evidence pool (union) and prepare coverage stats
  const key = (r: SearchResult) => `${r.id}:${r.start}:${r.end}`;
  const unionMap = new Map<string, SearchResult>();
  for (const sec of plan.sections) {
    const picked = perSectionResults[sec.name] || [];
    picked.forEach(r => unionMap.set(key(r), r));
  }
  let unionResults: SearchResult[] = Array.from(unionMap.values());

  // Compute simple coverage: unique ids per section / desired
  for (const sec of plan.sections) {
    const picked = perSectionResults[sec.name] || [];
    const uniqueIds = new Set(picked.map(r => r.id)).size;
    coverage[sec.name] = Math.min(1, uniqueIds / Math.max(2, sec.maxBullets));
  }

  // 4) Claim extraction per induced dimension (investigator-style, structured)
  const allClaims: Claim[] = [];
  // PARALLEL claim extraction per section
  const claimExtractionTasks = plan.sections.map(async (sec) => {
    const picked = perSectionResults[sec.name] || [];
    if (picked.length === 0) return [] as Claim[];
    const context = picked.map((r, i) => `[#${i + 1}] id:${r.id} start:${r.start} end:${r.end}\n${r.chunk}`).join('\n\n');
    const claimsPrompt = `Extract structured, persona-level claims relevant to dimension \"${sec.name}\" from the context.\nReturn strict JSON array of claim objects: [{\n  \"text\": string,\n  \"type\": string, // e.g., trait | relationship | arc | theme | event\n  \"entities\": string[],\n  \"confidence\": number, // 0..1\n  \"evidence\": [{ \"id\": string, \"start\": number, \"end\": number, \"quote\"?: string }]\n}]\nRules:\n- Only cite evidence using the explicit id/start/end from the numbered context (use the id value in each [#N] block).\n- Prefer generalizable claims over one-off micro-events.\n- Include at least one concise quote when useful to anchor a claim.\nContext:\n${context}`;
    try {
      const resp = await llm(claimsPrompt);
      const json = resp.text.replace(/^```json\n?|```$/g, '').trim();
      const parsed = JSON.parse(json) as Claim[];
      if (Array.isArray(parsed)) {
        return parsed.map(c => ({ ...c, dimension: sec.name }));
      }
    } catch {}
    return [] as Claim[];
  });
  const claimsBySection = await Promise.all(claimExtractionTasks);
  for (const list of claimsBySection) allClaims.push(...list);
  

  // 4.5) Build citations index (unique ids) for composer; unionResults already computed above
  const uniqueDocIds = Array.from(new Set(unionResults.map(r => r.id)));

  // 5) Multi-iteration refinement with budgets
  const summarizeClaims = (claims: Claim[]) => claims.slice(0, 30).map((c, i) => `(${i + 1}) ${c.text} [ev: ${c.evidence.map(e => e.id).join(', ')}]`).join('\n');
  const startTime = Date.now();
  const MAX_ITERATIONS = 2;
  const MAX_ELAPSED_MS = 120000; // 2 minutes
  const MAX_LLM_CALLS = 40; // conservative cap per job

  let iterations = 0;
  let sufficient = false;

  const evaluateSufficiency = async () => {
    const specTxt = JSON.stringify(answerSpec);
    const claimsTxt = summarizeClaims(allClaims);
    const evalPrompt = `Given the Answer Spec and current claims, decide if this is sufficient to satisfy the user's intent.\nReturn strict JSON: {\n  \"sufficient\": boolean,\n  \"missing_dimensions\": string[],\n  \"proposed_questions\": string[] // up to 4 targeted questions to explore relations (X->Y) and close gaps\n}\nAnswer Spec:\n${specTxt}\nCurrent Claims (sample):\n${claimsTxt}`;
    const r = await llm(evalPrompt);
    const dec = JSON.parse(r.text.replace(/^```json\n?|```$/g, '').trim()) as { sufficient: boolean; missing_dimensions: string[]; proposed_questions: string[] };
    return dec;
  };

  while (iterations < MAX_ITERATIONS && (Date.now() - startTime) < MAX_ELAPSED_MS && llmCallCount < MAX_LLM_CALLS) {
    let dec: { sufficient: boolean; missing_dimensions: string[]; proposed_questions: string[] };
    try {
      dec = await evaluateSufficiency();
    } catch {
      break; // if evaluator fails, stop iterating
    }
    if (dec.sufficient) { sufficient = true; break; }
    if (!dec.proposed_questions || dec.proposed_questions.length === 0) break;

    // Enhanced VoI scoring: prioritize questions that address missing dimensions and known entities
    const knownEntities = new Set<string>();
    for (const c of allClaims) (c.entities || []).forEach(e => knownEntities.add(e.toLowerCase()));
    const followUpsRaw = dec.proposed_questions.slice(0, 6);
    const scored = followUpsRaw.map(q => {
      const ql = q.toLowerCase();
      let dimScore = 0;
      for (const d of (dec.missing_dimensions || [])) if (ql.includes(String(d).toLowerCase())) dimScore += 1;
      let entScore = 0;
      knownEntities.forEach(e => { if (e && ql.includes(e)) entScore += 1; });
      const score = 2*dimScore + 1*entScore;
      return { q, score };
    }).sort((a,b)=>b.score - a.score).slice(0,3);
    const followUps = scored.map(s => s.q);

    // Execute follow-ups in parallel (LLM), coordinator ops serialized inside helpers
    const followUpTasks = followUps.map(async (q) => {
      try {
        const emb = await embedSafe(q);
        const k = Math.min(40, Math.max(15, (opts.settings.numInitialCandidates || 20)));
        const res = vectorStore.search(emb, k) || [];
        let ranked = res;
        if (opts.rerank) {
          try { ranked = await rerankSafe(q, res.map(r => ({ chunk: r.chunk, id: r.id, start: r.start, end: r.end }))); } catch {}
        }
        const picked = ranked.slice(0, 10);
        const ctx = picked.map((r, i) => `[#${i + 1}] id:${r.id} start:${r.start} end:${r.end}\n${r.chunk}`).join('\n\n');
        const morePrompt = `Extract additional claims relevant to: \"${q}\". Return strict JSON array of claim objects as previously specified.\nContext:\n${ctx}`;
        const more = await llm(morePrompt);
        const json = more.text.replace(/^```json\n?|```$/g, '').trim();
        const parsed = JSON.parse(json) as Claim[];
        if (Array.isArray(parsed)) { for (const c of parsed) allClaims.push(c); }
        picked.forEach(r => unionMap.set(key(r), r));
      } catch {}
    });
    await Promise.all(followUpTasks);
    unionResults = Array.from(unionMap.values());
    iterations += 1;
  }

  // 6) Final level based on whether we iterated
  let finalLevel: 2 | 3 = opts.level === 3 || iterations > 0 ? 3 : 2;

  // 7) Compose final answer from claims and Answer Spec; include citation index to force id-based citations
  const claimsForComposer = JSON.stringify(allClaims.slice(0, 120));
  const citationSheet = uniqueDocIds.map((id, i) => `[#${i + 1}] id:${id}`).join('\n');
  const composerPrompt = `Compose an organized answer that satisfies the Answer Spec.\nRules:\n- Use the induced dimensions to structure content, but adapt names naturally.\n- Prefer persona-level synthesis; avoid listing micro-events.\n- Use [Source: id] citations only (ids are in the citation sheet). Do not cite by number.\n- Include 1–3 short quotes only where they anchor important claims.\n- Keep language/style consistent with the Answer Spec.\nAnswer Spec:\n${JSON.stringify(answerSpec)}\nCitation Sheet (ids):\n${citationSheet}\nClaims (JSON):\n${claimsForComposer}\nUser Query: ${query}`;

  const compResp = await llm(composerPrompt);
  let compText = compResp.text;
  // Safety: strip any stray numeric [Source: N] to ids if they leaked (map by index order above)
  compText = compText.replace(/\[Source:\s*(\d+)\]/g, (_, n) => {
    const idx = parseInt(n, 10) - 1; const id = uniqueDocIds[idx]; return id ? `[Source: ${id}]` : `[Source: ${n}]`;
  });

  // Logging (final level and basic stats)
  try {
    if (opts.settings.isLoggingEnabled) {
      const docCount = new Set(unionResults.map(r => r.id)).size;
      console.info(`[Deep Analysis] Final Level: L${finalLevel} | Evidence: ${unionResults.length} chunks from ${docCount} docs | Claims: ${allClaims.length}.`);
    }
  } catch {}

  return { plan, sections: [], finalText: compText, usedResults: unionResults, coverage, llmTokens: { promptTokens: totalPrompt, completionTokens: totalCompletion } };
}

