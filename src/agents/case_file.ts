// src/agents/case_file.ts
import { VectorStore } from '../rag/pipeline';
import { AppSettings } from '../config';
import { ChatMessage, SearchResult, Model } from '../types';
import { generateContent } from '../api/llm-provider';
import { runDeepAnalysis } from './deep_analysis';
import { filterVisibleHistory } from '../utils/chatUtils';
export { filterVisibleHistory };

export interface CaseFileState {
  initialAnalysis: string;
  suggestedQuestions: string[];
  visibleHistory: ChatMessage[];
}

/**
 * Step 1: Analyze visible chat history and propose scope for Case File.
 */
export async function analyzeChatForCaseFile(opts: {
  history: ChatMessage[];
  model: Model;
  apiKey: string | undefined;
  onTokenUsage?: (usage: { promptTokens: number; completionTokens: number }) => void;
}): Promise<CaseFileState> {
  // STRICT FILTERING: Only include what the user sees in the UI
  const visibleHistory = filterVisibleHistory(opts.history);
  
  const analysisPrompt = `You are a Senior Strategic Analyst. Your task is to analyze the following conversation and propose the structure for a comprehensive, professional "Case File" (strategic report).

The report must be extensive, consistent, and highly structured.
Identify the primary mission/topic, key evidence discussed, and specific areas that require deep analysis.

Proposed Outline requirements:
1. Introduction & Context
2. Executive Summary
3. Detailed Analysis (multiple sections)
4. Hypothesis / Findings
5. Strategic Recommendations / Next Steps
6. Gaps in Information

Output strictly JSON with: 
{ 
  "initialAnalysis": "A high-level summary of what the case file will cover based on current chat context.", 
  "suggestedQuestions": ["3 targeted questions to help the user refine the scope, resolve ambiguities, or choose specific focus areas."] 
}

Chat History:
${visibleHistory.map((m: ChatMessage) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}
`;

  const resp = await generateContent(opts.model, opts.apiKey, [{ role: 'user', content: analysisPrompt }]);
  if (opts.onTokenUsage) opts.onTokenUsage(resp.usage);

  try {
    const text = resp.text || '';
    const json = JSON.parse(text.replace(/^```json\n?|```$/g, '').trim());
    return {
      initialAnalysis: json.initialAnalysis,
      suggestedQuestions: json.suggestedQuestions,
      visibleHistory
    };
  } catch (e) {
    console.error("Failed to parse analysis JSON", e, resp.text);
    return {
      initialAnalysis: "I've analyzed our conversation and I'm ready to build a comprehensive report.",
      suggestedQuestions: ["What specific aspects of our discussion should I prioritize in this report?"],
      visibleHistory
    };
  }
}

/**
 * Step 2: Generate the full Case File based on user feedback.
 */
export async function generateCaseFile(opts: {
  userFeedback: string;
  caseFileContext: CaseFileState;
  vectorStore: VectorStore | null;
  model: Model;
  apiKey: string | undefined;
  settings: AppSettings;
  embedQuery: (q: string) => Promise<number[]>;
  rerank?: (query: string, docs: { chunk: string; id: string; start: number; end: number }[]) => Promise<SearchResult[]>;
  onTokenUsage?: (usage: { promptTokens: number; completionTokens: number }) => void;
}) {
  const { userFeedback, caseFileContext, vectorStore, model, apiKey, settings, embedQuery, rerank, onTokenUsage } = opts;

  // Combine initial analysis and user feedback into a master query for Deep Analysis
  const masterQuery = `You are now generating a AAA-GRADE CASE FILE. 
This is an extensive, professional document that must be authoritative, consistent, and free of hallucinations or redundancy.

REPORT MISSION:
${caseFileContext.initialAnalysis}

USER SPECIFIC FOCUS & FEEDBACK:
${userFeedback}

REQUIRED STRUCTURE:
- Formal Introduction
- Executive Summary
- In-depth Analysis (with thematic chapters)
- Hypothesis & Key Findings
- Conclusion & Recommendations
- Source Attribution (using [Source: ID] format)

The document should be voluminous and thorough, leveraging all available evidence from the knowledge base.
`;

  return runDeepAnalysis({
    query: masterQuery,
    history: caseFileContext.visibleHistory,
    vectorStore,
    model,
    apiKey,
    settings,
    embedQuery,
    rerank,
    level: 3, // Force maximum depth for Case Files
    onTokenUsage
  });
}
