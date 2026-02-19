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

export interface ChatMessage {
  role: 'user' | 'model' | 'system'
  content: string
  tokenUsage?: TokenUsage;
  elapsedTime?: number;
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