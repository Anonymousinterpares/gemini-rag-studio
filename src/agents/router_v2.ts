// src/agents/router_v2.ts
// Evidence-aware, general-purpose router. Decides Chat, RAG, or Deep Analysis levels.

import { VectorStore } from '../rag/pipeline';
import { AppSettings } from '../config';
import { ChatMessage, SearchResult } from '../types';
import { generateContent } from '../api/llm-provider';
import { Model } from '../types';
import { filterVisibleHistory } from '../utils/chatUtils';

export type RouteDecision = {
  mode: 'CHAT' | 'RAG' | 'DEEP_ANALYSIS_L1' | 'DEEP_ANALYSIS_L2' | 'DEEP_ANALYSIS_L3' | 'CASE_FILE';
  reason: string;
  preResults?: SearchResult[];
  complexity?: 'factoid' | 'overview' | 'synthesis' | 'comparison' | 'reasoning' | 'case_file' | 'unknown';
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
  onTokenUsage?: (usage: { promptTokens: number; completionTokens: number }) => void;
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
    onTokenUsage,
  } = opts;

  // No corpus -> Chat
  if (!filesLoaded || !vectorStore) {
    return { mode: 'CHAT', reason: 'No local documents available.', complexity: 'unknown' };
  }

  // Pre-retrieval: quick signal check
  let preResults: SearchResult[] = [];
  try {
    const emb = await embedQuery(query);
    const k = Math.min(10, Math.max(5, Math.floor((settings.numInitialCandidates || 20) / 4)));
    preResults = vectorStore.search(emb, k);
  } catch {
    // Fallback to RAG if embed fails
    return { mode: 'RAG', reason: 'Pre-retrieval failed; falling back to RAG.', complexity: 'unknown' };
  }

  const maxSim = preResults.reduce((m, r) => Math.max(m, r.similarity), 0);
  const docSet = new Set(preResults.map(r => r.id));
  const docDiversity = docSet.size;

  // Small classifier to determine complexity (general-purpose, domain-agnostic)
  let complexity: 'factoid' | 'overview' | 'synthesis' | 'comparison' | 'reasoning' | 'case_file' | 'unknown' = 'unknown';
  try {
    const visibleHistory = filterVisibleHistory(history);
    const historyText = visibleHistory.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n');
    const cls = await generateContent(model, apiKey, [
      { role: 'user', content: `Classify the task type for this user query.
Context History:
${historyText}

Query: ${query}
Categories: factoid, overview, synthesis, comparison, reasoning, case_file
Note: case_file is for requests to generate an extensive, structured report, document, or case study based on the discussion.
Return only one word.` },
    ]);
    if (onTokenUsage) {
      onTokenUsage({ promptTokens: cls.usage.promptTokens, completionTokens: cls.usage.completionTokens });
    }
    const t = (cls.text || '').trim().toLowerCase();
    const categories = ['factoid', 'overview', 'synthesis', 'comparison', 'reasoning', 'case_file'];
    if (categories.includes(t)) {
      complexity = t as 'factoid' | 'overview' | 'synthesis' | 'comparison' | 'reasoning' | 'case_file';
    }
  } catch {
    // ignore; keep unknown
  }

  // Evidence-aware rules
  const tauLow = settings.relevanceThreshold ?? 0.25;
  const goodEvidence = maxSim >= tauLow && docDiversity >= 1;

  if (complexity === 'case_file') {
    return { mode: 'CASE_FILE', reason: 'User requested an extensive report (Case File).', preResults, complexity };
  }

  if (!goodEvidence) {
    // Lack of evidence; still allow user to proceed with RAG if they want
    return { mode: 'CHAT', reason: 'Evidence below threshold in pre-retrieval; defaulting to Chat.', complexity };
  }

  // Decide depth by complexity; do not rely on keywords
  if (complexity === 'factoid') {
    return { mode: 'RAG', reason: 'Factoid task with evidence present.', preResults, complexity };
  }
  if (complexity === 'overview') {
    return { mode: 'RAG', reason: 'Overview task; RAG is sufficient.', preResults, complexity };
  }
  if (complexity === 'comparison' || complexity === 'reasoning') {
    return { mode: 'DEEP_ANALYSIS_L2', reason: 'Reasoning/comparison; sectioned analysis needed.', preResults, complexity };
  }
  if (complexity === 'synthesis') {
    return { mode: 'DEEP_ANALYSIS_L2', reason: 'Synthesis task; sectioned deep analysis selected.', preResults, complexity };
  }
  // default (including 'unknown')
  return { mode: 'RAG', reason: 'Complexity unknown or low-confidence; defaulting to RAG.', preResults, complexity };
}

