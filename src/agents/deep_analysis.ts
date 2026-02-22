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
  negativeEvidence?: EvidenceRef[]; // passages that weaken or contradict
  contradicts?: string[]; // ids/text of claims this conflicts with
  uncertaintyReason?: string; // brief reason if confidence is low or evidence is weak
};

export async function runDeepAnalysis(opts: {
  query: string;
  history: ChatMessage[];
  vectorStore: VectorStore | null;
  model: Model;
  apiKey: string | undefined;
  settings: AppSettings;
  embedQuery: (q: string) => Promise<number[]>;
  rerank?: (query: string, docs: { chunk: string; id: string; start: number; end: number }[]) => Promise<SearchResult[]>;
  level: 1 | 2 | 3;
  onTokenUsage?: (usage: { promptTokens: number; completionTokens: number }) => void;
}): Promise<DeepAnalysisResult> {
  const { query, vectorStore, settings, embedQuery, level, onTokenUsage } = opts;

  // Import recovery utilities
  const {
    callLLMWithRecovery,
    createRecoveryContext,
    finalizeRecovery,
    onGlobalModelUpdate
  } = await import('../utils/api-recovery');

  // Create recovery context for this deep analysis session
  const recoveryId = createRecoveryContext(
    'deep_analysis',
    10, // Estimated number of LLM calls
    {
      query: opts.query,
      history: opts.history,
      level: opts.level,
      settings: opts.settings
    }
  );

  // Utility variables for tracking
  let totalPrompt = 0;
  let totalCompletion = 0;
  let llmCallCount = 0;
  let currentModel = opts.model;
  let currentApiKey = opts.apiKey;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const llm = async (content: string, stepName: string = 'llm_call'): Promise<any> => {
    return callLLMWithRecovery(
      recoveryId,
      `${stepName}_${llmCallCount + 1}`,
      async () => {
        const resp = await generateContent(currentModel, currentApiKey, [{ role: 'user', content }]);
        totalPrompt += resp.usage.promptTokens;
        totalCompletion += resp.usage.completionTokens;
        llmCallCount += 1;
        if (onTokenUsage) {
          onTokenUsage({ promptTokens: resp.usage.promptTokens, completionTokens: resp.usage.completionTokens });
        }
        return resp;
      },
      {
        maxRetries: 5,
        baseDelay: 2000,
        maxDelay: 30000,
        enableUserInteraction: true,
        autoSwitchModels: false
      }
    );
  };

  // 1) Quick horizon scan via pre-retrieval
  const qEmb = await embedQuery(query);
  const initialK = Math.min(30, Math.max(10, Math.floor((settings.numInitialCandidates || 20) * 1.5)));
  const pre = vectorStore ? (vectorStore.search(qEmb, initialK) || []) : [];

  // 2) Planner (simple baseline plan)
  const plannerPrompt = `You are a planning agent. Given the user's query and the type of content available, propose a set of sections (3-8) to cover the topic thoroughly. Output JSON with {"sections":[{"name":"...","objective":"...","maxBullets":N}],"targetWordCount":number}. Query: ${query}`;
  let plan: Plan = { sections: [{ name: 'Overview', objective: 'Overview of findings', maxBullets: 5 }], targetWordCount: 600 };
  try {
    const resp = await llm(plannerPrompt, 'planner');
    const text = (resp as { text: string }).text.trim();
    const json = JSON.parse(text.replace(/^```json\n?|```$/g, '')) as Plan;
    if (json.sections?.length) plan = json;
  } catch {
    // keep baseline plan
  }

  // Function to update model/settings when user switches during recovery
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateModelSettings = (newModel: any, newApiKey?: string) => {
    currentModel = newModel;
    if (newApiKey) currentApiKey = newApiKey;
  };

  // Subscribe to global model updates from Recovery UI decisions
  const unsubscribeModelUpdate = onGlobalModelUpdate(({ model, apiKey }) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateModelSettings(model as any, apiKey as string);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (settings.isLoggingEnabled) console.info('[Deep Analysis] Model updated via Recovery UI:', (model as any).provider, (model as any).name);
    } catch {
      // ignore
    }
  });
  
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
    let current: Promise<unknown> = Promise.resolve();
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
    const intentResp = await llm(intentPrompt, 'intent_interpreter');
    const text = (intentResp as { text: string }).text.replace(/^```json\n?|```$/g, '').trim();
    const parsed = JSON.parse(text) as AnswerSpec;
    if (parsed && parsed.dimensions && parsed.dimensions.length) {
      answerSpec = parsed;
    }
  } catch {
    // ignore
  }

  // Narrative Sampler: sample 1–2 paragraphs per chapter/window to build a narrative skeleton
  const narrativeClaims: Claim[] = [];
  try {
    if (vectorStore) {
      const MAX_DOCS = 2;
      const PER_CHAPTER_SAMPLES = 2;
      const MAX_TOTAL_SAMPLES = 24;
      const samples: { id: string; start: number; end: number; score: number }[] = [];

      // Helper: get text segment from parent chunks
      const getTextSegment = (docId: string, start: number, end: number): string => {
        const parents = vectorStore.getParentChunks(docId) || [];
        if (!parents.length) return '';
        let out = '';
        for (const pc of parents) {
          const oStart = Math.max(start, pc.start);
          const oEnd = Math.min(end, pc.end);
          if (oStart < oEnd) {
            const ls = oStart - pc.start;
            const le = oEnd - pc.start;
            out += pc.text.slice(ls, le) + '\n';
          }
        }
        return out.trim();
      };

      // Build doc order from pre-retrieval results (unique by id)
      const seenDoc = new Set<string>();
      const preDocOrder: string[] = [];
      for (const r of pre) { if (!seenDoc.has(r.id)) { seenDoc.add(r.id); preDocOrder.push(r.id); } }

      const qEmbedding = qEmb;
      const entityCandidates = Array.from(new Set((query.match(/\b([Z][A-Za-zÀ-ÖØ-öø-ÿ'-]+(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'-]+)*)\b/g) || []).map(s => s.trim().toLowerCase())));

      for (const docId of preDocOrder.slice(0, MAX_DOCS)) {
        const structure = vectorStore.getStructure ? vectorStore.getStructure(docId) : undefined;
        if (!structure) continue;
        const chapters = structure.chapters || [];
        const paragraphs = structure.paragraphs || [];
        if (opts.settings.isLoggingEnabled) console.log(`[NarrativeSampler] Doc ${docId}: chapters=${chapters.length}, paragraphs=${paragraphs.length}`);

        // Precompute doc-local retrieval for scoring
        const localResults = vectorStore.search(qEmbedding, 80, docId) || [];

        let pickedCount = 0;
        for (const ch of chapters) {
          // Find paragraphs within chapter bounds
          const paras = paragraphs.filter(p => p.start >= ch.start && p.end <= ch.end);
          if (paras.length === 0) continue;
          // Score each paragraph by local similarity and entity proximity
          const scored = paras.map(p => {
            let sim = 0;
            for (const lr of localResults) {
              const ov = !(lr.end <= p.start || lr.start >= p.end);
              if (ov) { sim = Math.max(sim, lr.similarity); }
            }
            // Entity bonus
            let nearest = Infinity;
            for (const e of entityCandidates) {
              const mentions = typeof vectorStore.getEntityMentions === 'function' ? vectorStore.getEntityMentions(docId, e) : [];
              for (const m of mentions) {
                const dist = Math.min(Math.abs(m - p.start), Math.abs(m - p.end));
                if (dist < nearest) nearest = dist;
              }
            }
            const bonus = Number.isFinite(nearest) ? Math.max(0, 1 - Math.min(nearest, 4000) / 4000) * 0.1 : 0;
            return { para: p, score: sim + bonus };
          }).sort((a,b)=>b.score - a.score);

          // MMR within chapter
          const lambda = 0.7;
          const windowSize = Math.max(1000, Math.floor((ch.end - ch.start) / 6));
          const chosen: { para: { start: number; end: number }; score: number }[] = [];
          const cand = scored.slice();
          while (chosen.length < PER_CHAPTER_SAMPLES && cand.length > 0) {
            let bestI = 0; let bestS = -Infinity;
            for (let i = 0; i < cand.length; i++) {
              const c = cand[i];
              const rel = c.score;
              let red = 0;
              for (const sel of chosen) {
                const dist = Math.abs(((sel.para.start + sel.para.end) / 2) - ((c.para.start + c.para.end) / 2));
                red = Math.max(red, Math.max(0, (windowSize - dist) / windowSize));
              }
              const s = lambda * rel - (1 - lambda) * red;
              if (s > bestS) { bestS = s; bestI = i; }
            }
            chosen.push(cand.splice(bestI, 1)[0]);
          }

          for (const sel of chosen) {
            samples.push({ id: docId, start: sel.para.start, end: sel.para.end, score: sel.score });
            pickedCount++;
            if (samples.length >= MAX_TOTAL_SAMPLES) break;
          }
          if (samples.length >= MAX_TOTAL_SAMPLES) break;
        }
        if (opts.settings.isLoggingEnabled) console.log(`[NarrativeSampler] Doc ${docId}: selected ${pickedCount} paragraph samples.`);
        if (samples.length >= MAX_TOTAL_SAMPLES) break;
      }

      // Extract claims from samples
      for (const s of samples) {
        const paragraphText = getTextSegment(s.id, s.start, s.end);
        if (!paragraphText) continue;
        const context = `[#1] id:${s.id} start:${s.start} end:${s.end}\n${paragraphText}`;
        const claimsPrompt = `Extract structured, persona-level claims from the paragraph context.\nReturn strict JSON array of claim objects: [{\n  "text": string,\n  "type": string,\n  "entities": string[],\n  "confidence": number,\n  "evidence": [{ "id": string, "start": number, "end": number, "quote"?: string }],\n  "negativeEvidence"?: [{ "id": string, "start": number, "end": number, "quote"?: string }],\n  "contradicts"?: string[],\n  "uncertaintyReason"?: string\n}]\nRules:\n- Cite EXACTLY with [Source: id] using the provided id/start/end. DO NOT use 【】 or other brackets.\n- Prefer persona-level generalizations over micro-events.\n- Include 1 short quote only if anchoring a major claim.\nContext:\n${context}`;
        try {
          const resp = await llm(claimsPrompt, 'narrative_claims_extraction');
          const json = (resp as { text: string }).text.replace(/^```json\n?|```$/g, '').trim();
          const parsed = JSON.parse(json) as Claim[];
          if (Array.isArray(parsed)) narrativeClaims.push(...parsed);
        } catch {
          // ignore
        }
      }
    }

    if (narrativeClaims.length && opts.settings.isLoggingEnabled) {
      console.log(`[NarrativeSampler] Extracted ${narrativeClaims.length} claims from narrative samples.`);
    }
  } catch (e) {
    if (opts.settings.isLoggingEnabled) console.warn('[NarrativeSampler] Failed:', e);
  }

  // 3) Per-section retrieval with query expansion and optional rerank (PARALLELIZED)
  const perSectionResults: Record<string, SearchResult[]> = {};
  
  const processSection = async (sec: PlanSection): Promise<{ name: string; results: SearchResult[] }> => {
    if (!vectorStore) return { name: sec.name, results: [] };
    
    // Generate 2-3 targeted sub-queries for this section
    let subQs: string[] = [];
    try {
      const qPrompt = `You are a query expansion assistant. Generate 2-3 short, specific search queries to retrieve evidence for the section: "${sec.name}" in the context of user query: ${query}. Return a JSON array of strings.`;
      const qResp = await llm(qPrompt, 'query_expansion');
      const jsonTxt = (qResp as { text: string }).text.replace(/^```json\n?|```$/g, '').trim();
      const parsed = JSON.parse(jsonTxt);
      if (Array.isArray(parsed) && parsed.length) subQs = parsed.slice(0, 3);
    } catch {
      // ignore
    }
    if (subQs.length === 0) subQs = [`${query} ${sec.name}`];

    // Run independent vector searches per sub-query IN PARALLEL
    const k = Math.min(50, Math.max(15, (settings.numInitialCandidates || 20)));
    const searchPromises = subQs.map(async (sq) => {
      const emb = await embedSafe(sq); // serialize due to single resolver design
      return vectorStore.search(emb, k, undefined, { includeEmbeddings: true }) || [];
    });
    const searchResults = await Promise.all(searchPromises);
    const merged: (SearchResult & { embedding: number[] })[] = searchResults.flat() as (SearchResult & { embedding: number[] })[];

    // Optional rerank
    let ranked: (SearchResult & { embedding: number[] })[] = merged;
    if (opts.rerank) {
      const docs = merged.map(r => ({ chunk: r.chunk, id: r.id, start: r.start, end: r.end, parentChunkIndex: r.parentChunkIndex }));
      try {
        const reranked = await rerankSafe(`${query} ${sec.name}`, docs); // serialize due to single resolver design
        // Restore embeddings after rerank
        ranked = reranked.map(r => ({
            ...r,
            embedding: merged.find(m => m.id === r.id && m.start === r.start)?.embedding || []
        }));
      } catch {
        // ignore
      }
    }

    // Entity-aware boost
    try {
      const entityCandidates = Array.from(new Set((query.match(/\b([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'-]+(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'-]+)*)\b/g) || []).map(s => s.trim().toLowerCase())));
      if (entityCandidates.length > 0 && typeof vectorStore.getEntityMentions === 'function') {
        const boosted = ranked.map(r => {
          const mentions = entityCandidates.flatMap(e => vectorStore.getEntityMentions(r.id, e));
          let nearest = Infinity;
          for (const m of mentions) {
            const dist = Math.min(Math.abs(m - r.start), Math.abs(m - r.end));
            if (dist < nearest) nearest = dist;
          }
          const bonus = Number.isFinite(nearest) ? Math.max(0, 1 - Math.min(nearest, 3000) / 3000) * 0.1 : 0; // up to +0.1
          return { ...r, similarity: r.similarity + bonus };
        });
        boosted.sort((a,b)=>b.similarity - a.similarity);
        ranked = boosted;
      }
    } catch {
      // ignore
    }

    // Intelligent selection via native VectorStore diversification
    const target = Math.min(10, sec.maxBullets * 2);
    const picked = vectorStore.diversify(ranked, target, { lambda: 0.4, spanWeight: 0.2 });

    return { name: sec.name, results: picked };
  };
  
  // Process all sections in parallel
  const sectionPromises = plan.sections.map(processSection);
  const sectionData = await Promise.all(sectionPromises);
  
  // Populate results map
  for (const { name, results } of sectionData) {
    perSectionResults[name] = results;
  }

  // Compile global evidence pool (union) and prepare coverage stats
  const coverage: { [section: string]: number } = {};
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

  // 4) Claim extraction per induced dimension (investigator-style, structured) with capped LLM concurrency
  const allClaims: Claim[] = [];
  const extractClaimsForSection = async (sec: PlanSection): Promise<Claim[]> => {
    const picked = perSectionResults[sec.name] || [];
    // If no vector store, we might still want to extract from visible history?
    let context = picked.map((r, i) => `[#${i + 1}] id:${r.id} start:${r.start} end:${r.end}\n${r.chunk}`).join('\n\n');
    
    if (picked.length === 0) {
        // Fallback: extract from history for this dimension
        const visibleHistory = opts.history.filter(m => !m.isInternal && m.role !== 'tool');
        context = visibleHistory.slice(-10).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
        if (!context) return [] as Claim[];
    }

    const claimsPrompt = `Extract structured, persona-level claims relevant to dimension "${sec.name}" from the context.\nReturn strict JSON array of claim objects: [{\n  "text": string,\n  "type": string, // e.g., trait | relationship | arc | theme | event\n  "entities": string[],\n  "confidence": number, // 0..1\n  "evidence": [{ "id": string, "start": number, "end": number, "quote"?: string }],\n  "negativeEvidence"?: [{ "id": string, "start": number, "end": number, "quote"?: string }],\n  "contradicts"?: string[],\n  "uncertaintyReason"?: string\n}]\nRules:\n- Only cite evidence EXACTLY with [Source: id] if IDs are available. Otherwise omit evidence.\n- Prefer persona-level generalizations over one-off micro-events.\n- Include 1 short quote only when it anchors a major claim.\n- If confidence < 0.6, provide an uncertaintyReason.\nContext:\n${context}`;
    try {
      const resp = await llm(claimsPrompt, 'claims_extraction');
      const json = (resp as { text: string }).text.replace(/^```json\n?|```$/g, '').trim();
      const parsed = JSON.parse(json) as Claim[];
      if (Array.isArray(parsed)) {
        return parsed.map(c => ({ ...c, dimension: sec.name }));
      }
    } catch {
      // ignore
    }
    return [] as Claim[];
  };
  const claimsBySection = await executeInParallel(plan.sections, extractClaimsForSection, 3);
  for (const list of claimsBySection) allClaims.push(...list);
  

  // 4.5) Build citations index (unique ids) for composer; unionResults already computed above
  const uniqueDocIds = Array.from(new Set(unionResults.map(r => r.id)));

  // 5) Multi-iteration refinement with budgets
  const summarizeClaims = (claims: Claim[]) => claims.slice(0, 30).map((c, i) => `(${i + 1}) ${c.text} [ev: ${c.evidence.map(e => e.id).join(', ')}]`).join('\n');
  const startTime = Date.now();
  const MAX_ITERATIONS = 1; // Lower for Case File to avoid infinite search loops
  const MAX_ELAPSED_MS = 120000; // 2 minutes
  const MAX_LLM_CALLS = 40; 

  let iterations = 0;
  let sufficient = false;
  let lastDecision: { sufficient: boolean; missing_dimensions: string[]; proposed_questions: string[]; issues?: string[]; needs_gaps_section?: boolean; needs_contradictions_review?: boolean } | null = null;

  const evaluateSufficiency = async () => {
    const specTxt = JSON.stringify(answerSpec);
    const claimsTxt = summarizeClaims(allClaims);
    const evalPrompt = `You are an evaluator. Judge whether current claims satisfy the Answer Spec.\nReturn strict JSON with keys: {\n  "sufficient": boolean,\n  "missing_dimensions": string[],\n  "issues": string[],\n  "needs_gaps_section": boolean,\n  "needs_contradictions_review": boolean,\n  "proposed_questions": string[]\n}\nAnswer Spec:\n${specTxt}\nCurrent Claims (sample):\n${claimsTxt}`;
    const r = await llm(evalPrompt, 'sufficiency_evaluation');
    const dec = JSON.parse((r as { text: string }).text.replace(/^```json\n?|```$/g, '').trim()) as { sufficient: boolean; missing_dimensions: string[]; proposed_questions: string[]; issues?: string[]; needs_gaps_section?: boolean; needs_contradictions_review?: boolean };
    return dec;
  };

  while (vectorStore && iterations < MAX_ITERATIONS && (Date.now() - startTime) < MAX_ELAPSED_MS && llmCallCount < MAX_LLM_CALLS) {
    let dec: { sufficient: boolean; missing_dimensions: string[]; proposed_questions: string[] };
    try {
      dec = await evaluateSufficiency();
    } catch {
      break; 
    }
    lastDecision = dec;
    if (dec.sufficient) { sufficient = true; break; }
    if (!dec.proposed_questions || dec.proposed_questions.length === 0) break;

    const followUps = dec.proposed_questions.slice(0, 3);

    const followUpTasks = followUps.map(async (q) => {
      try {
        const emb = await embedSafe(q);
        const k = Math.min(40, Math.max(15, (opts.settings.numInitialCandidates || 20)));
        const res = vectorStore.search(emb, k) || [];
        let ranked = res;
        if (opts.rerank) {
          try { ranked = await rerankSafe(q, res.map(r => ({ chunk: r.chunk, id: r.id, start: r.start, end: r.end }))); } catch { /* ignore */ }
        }
        const picked = ranked.slice(0, 10);
        const ctx = picked.map((r, i) => `[#${i + 1}] id:${r.id} start:${r.start} end:${r.end}\n${r.chunk}`).join('\n\n');
        const morePrompt = `Extract additional claims relevant to: "${q}". Return strict JSON array.\nContext:\n${ctx}`;
        const more = await llm(morePrompt, 'followup_claims_extraction');
        const json = (more as { text: string }).text.replace(/^```json\n?|```$/g, '').trim();
        const parsed = JSON.parse(json) as Claim[];
        if (Array.isArray(parsed)) { for (const c of parsed) allClaims.push(c); }
        picked.forEach(r => unionMap.set(key(r), r));
      } catch {
        // ignore
      }
    });
    await Promise.all(followUpTasks);
    unionResults = Array.from(unionMap.values());
    iterations += 1;
  }

  // 7) Compose final answer
  const claimsForComposer = JSON.stringify(allClaims.slice(0, 120));
  const citationSheet = uniqueDocIds.map((id, i) => `[#${i + 1}] id:${id}`).join('\n');
  const evalContext = JSON.stringify({
    missing_dimensions: lastDecision?.missing_dimensions || [],
    issues: lastDecision?.issues || [],
    needs_gaps_section: lastDecision?.needs_gaps_section || (!sufficient && iterations >= 1),
    needs_contradictions_review: lastDecision?.needs_contradictions_review || false,
  });
  const composerPrompt = `Compose an organized Case File that satisfies the Answer Spec.\nRules:\n- Use the induced dimensions to structure content.\n- Prefer persona-level synthesis.\n- Use EXACTLY [Source: id] citations ONLY for document evidence. Do NOT cite history as a Source ID.\n- Keep language/style professional and AAA-grade.\nAnswer Spec:\n${JSON.stringify(answerSpec)}\nEvaluation Context:\n${evalContext}\nCitation Sheet (ids):\n${citationSheet}\nClaims (JSON):\n${claimsForComposer}\nVisible History Context:\n${opts.history.slice(-10).map(m => `${m.role}: ${m.content}`).join('\n')}\nUser Query: ${query}`;

  const compResp = await llm(composerPrompt, 'final_composer');
  let compText = (compResp as { text: string }).text;
  compText = compText.replace(/\[Source:\s*(\d+)\]/g, (_: string, n: string) => {
    const idx = parseInt(n, 10) - 1; const id = uniqueDocIds[idx]; return id ? `[Source: ${id}]` : `[Source: ${n}]`;
  });

  try { unsubscribeModelUpdate(); } catch {
    // Ignore unsubscription errors if the listener was already removed or never set
  }
  finalizeRecovery(recoveryId);

  return { plan, sections: [], finalText: compText, usedResults: unionResults, coverage, llmTokens: { promptTokens: totalPrompt, completionTokens: totalCompletion } };
}
