export type Provider = 'google' | 'openai' | 'openrouter' | 'ollama';

export interface Model {
  id: string;
  name: string
  provider: Provider
  apiKeyRequired: boolean
}

export type SummaryStatus = 'missing' | 'in_progress' | 'available';

export interface AppFile {
  id: string; // Unique identifier for the file
  path: string
  name: string
  content?: string
  file?: File
  lastModified: number
  size: number
  summaryStatus: SummaryStatus;
  language: string;
  summary?: string;
  layoutStatus?: 'pending' | 'ready';
}

export interface FileTree {
  [key: string]: FileTree | AppFile;
}

// Represents an item in the folder review tree view
export interface ReviewFileTreeItem {
  name: string;
  path: string; // Full path for unique identification
  isDirectory: boolean;
  isChecked: boolean;
  isIndeterminate: boolean; // For folders, if some children are checked
  children?: { [key: string]: ReviewFileTreeItem };
}

export type ViewMode = 'tree' | 'list'

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface MessageSection {
  id: string;
  content: string;
  comment?: string;
  isEditingComment?: boolean;
}

export interface SelectionComment {
  id: string;
  sectionId: string;
  text: string;
  comment: string;
}

// ─── Case File Types ──────────────────────────────────────────────────────────

export interface CaseFileComment {
  id: string;
  sectionId: string;
  selectedText: string;   // text that was highlighted – sent to LLM for context only
  instruction: string;    // user's instruction for the LLM
  createdAt: number;
}

export interface CaseFileSection {
  id: string;             // e.g. "sec-0", "sec-1"
  title?: string;         // optional heading extracted at parse time
  content: string;        // raw markdown
  comments: CaseFileComment[];
}

export interface CaseFile {
  version: 1;
  title: string;
  createdAt: number;
  sections: CaseFileSection[];
}

export interface ChatMessage {
  role: 'user' | 'model' | 'system' | 'tool'
  content: string | null; // Content can be null for tool calls
  type?: 'case_file_analysis' | 'case_file_report';
  tokenUsage?: TokenUsage;
  elapsedTime?: number;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  isInternal?: boolean;
  sections?: MessageSection[];
  selectionComments?: SelectionComment[];
  pendingEdits?: {
    sectionId: string;
    fragmentId?: string;   // If present, targets a specific selection comment
    newContent?: string;   // For non-table plain-text replacements
    tableEdit?: {          // For structured table row replacements
      rowIndex: number;    // 0-based data row index (excludes header/separator)
      cells: string[];     // Full updated cells array for the row
    };
    isConfirmed?: boolean;
    isRejected?: boolean;
  }[];
}

export interface JobProgress {
  progress: number;
  total: number;
}

export interface JobTimer {
  startTime: number;
  elapsed: number;
  isActive: boolean;
}

export interface SearchResult {
  chunk: string;
  similarity: number;
  id: string; // Use file ID instead of path
  start: number;
  end: number;
  parentChunkIndex: number;
  embedding?: number[]; // Optional raw vector for diversification/clustering
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

import { DocumentChunk, DocumentStructureMap } from "../rag/pipeline";

export interface CachedEmbedding {
  id: string; // Use file ID for cache key
  path: string;
  name: string;
  lastModified: number;
  size: number;
  embedding: number[][]; // Embeddings for child chunks
  language: string;
  parentChunks?: DocumentChunk[];
  childChunks?: DocumentChunk[];
  entities?: Record<string, { count: number; positions: number[] }>;
  structure?: DocumentStructureMap;
}