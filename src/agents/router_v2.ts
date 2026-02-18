// src/agents/router_v2.ts
// Evidence-aware, general-purpose router. Decides Chat, RAG, or Deep Analysis levels.

import { VectorStore } from '../rag/pipeline';
import { AppSettings } from '../config';
import { ChatMessage, SearchResult } from '../types';
import { generateContent } from '../api/llm-provider';
import { Model } from '../types';

export type RouteDecision = {
  mode: 'CHAT' | 'RAG' | 'DEEP_ANALYSIS_L1' | 'DEEP_ANALYSIS_L2' | 'DEEP_ANALYSIS_L3';
  reason: string;
  preResults?: SearchResult[];
};

export async function decideRouteV2(opts: {
  query: string;
  history: ChatMessage[];
  filesLoaded: boolean;
  vectorStore: VectorStore | null;
  model: Model;
  apiKey: string | undefined;
  settings: AppSettings;
  embedQuery: (q: string) => Promise<number[]>;
}): Promise<RouteDecision> {
  const {
    query,
    history,
    filesLoaded,
    vectorStore,
    model,
    apiKey,
    settings,
    embedQuery,
  } = opts;

  // No corpus -> Chat
  if (!filesLoaded || !vectorStore) {
    return { mode: 'CHAT', reason: 'No local documents available.' };
  }

  // Pre-retrieval: quick signal check
  let preResults: SearchResult[] = [];
  try {
    const emb = await embedQuery(query);
    const k = Math.min(10, Math.max(5, Math.floor((settings.numInitialCandidates || 20) / 4)));
    preResults = vectorStore.search(emb, k);
  } catch {
    // Fallback to RAG if embed fails
    return { mode: 'RAG', reason: 'Pre-retrieval failed; falling back to RAG.' };
  }

  const maxSim = preResults.reduce((m, r) => Math.max(m, r.similarity), 0);
  const docSet = new Set(preResults.map(r => r.id));
  const docDiversity = docSet.size;

  // Small classifier to determine complexity (general-purpose, domain-agnostic)
  let complexity: 'factoid' | 'overview' | 'synthesis' | 'comparison' | 'reasoning' | 'unknown' = 'unknown';
  try {
    const historyText = history.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n');
    const cls = await generateContent(model, apiKey, [
      { role: 'user', content: `Classify the task type for this user query.
Context History:
${historyText}

Query: ${query}
Categories: factoid, overview, synthesis, comparison, reasoning
Return only one word.` },
    ]);
    const t = cls.text.trim().toLowerCase();
    if (['factoid', 'overview', 'synthesis', 'comparison', 'reasoning'].includes(t)) {
      complexity = t as 'factoid' | 'overview' | 'synthesis' | 'comparison' | 'reasoning';
    }
  } catch {
    // ignore; keep unknown
  }

  // Evidence-aware rules
  const tauLow = settings.relevanceThreshold ?? 0.25;
  const goodEvidence = maxSim >= tauLow && docDiversity >= 1;

  if (!goodEvidence) {
    // Lack of evidence; still allow user to proceed with RAG if they want
    return { mode: 'CHAT', reason: 'Evidence below threshold in pre-retrieval; defaulting to Chat.' };
  }

  // Decide depth by complexity; do not rely on keywords
  if (complexity === 'factoid') {
    return { mode: 'RAG', reason: 'Factoid task with evidence present.', preResults };
  }
  if (complexity === 'overview') {
    return { mode: 'RAG', reason: 'Overview task; RAG is sufficient.', preResults };
  }
  if (complexity === 'comparison' || complexity === 'reasoning') {
    return { mode: 'DEEP_ANALYSIS_L2', reason: 'Reasoning/comparison; sectioned analysis needed.', preResults };
  }
  if (complexity === 'synthesis') {
    return { mode: 'DEEP_ANALYSIS_L2', reason: 'Synthesis task; sectioned deep analysis selected.', preResults };
  }
  // default (including 'unknown')
  return { mode: 'RAG', reason: 'Complexity unknown or low-confidence; defaulting to RAG.', preResults };
}

