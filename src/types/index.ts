export type Provider = 'google' | 'openai' | 'openrouter' | 'ollama';

export interface Model {
  id: string;
  name: string
  provider: Provider
  apiKeyRequired: boolean
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
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
  proposedContent?: string;
  resolvingCommentId?: string;
  isProcessing?: boolean;
}

export type EntityType = 'person' | 'location' | 'event' | 'organization' | 'evidence' | 'group';
export type ConnectionType = 'knows' | 'involved_in' | 'owns' | 'located_at' | 'conflicts_with' | 'related_to';

export interface MapNodeSource {
  type: 'web' | 'document' | 'chat_exchange';
  label: string;
  url?: string;
  fileId?: string;
  chatSessionId?: string;
  chatMessageIndex?: number;
  snippet?: string;
  parentChunkIndex?: number;
  start?: number;
  end?: number;
  embedding?: number[];
}

export interface MapNode {
  id: string;
  type: 'customEntity' | 'customGroup';
  position: { x: number; y: number };
  data: {
    label: string;
    entityType: EntityType;
    description?: string;
    tags?: string[];
    isCollapsed?: boolean;
    sources?: MapNodeSource[];
    lastUpdatedAt?: number;
    chatContextRefs?: string[];
    certainty?: 'confirmed' | 'inferred' | 'disproven';
    certaintyScore?: number; // 0-100
    isCertaintyVerified?: boolean;
    timestamp?: string | null; // DD.MM.YYYY | HH:MM:SS
    isTimestampVerified?: boolean;
    mass?: number;
    citationCount?: number;
    semanticFactId?: string | null;
    semanticZoom?: number;
    hideDescription?: boolean;
  };
  parentId?: string;
  extent?: 'parent';
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  data?: {
    connectionType: ConnectionType;
    certainty: 'confirmed' | 'suspected' | 'disproven';
  };
  type?: 'customEdge';
  animated?: boolean;
}

export interface InvestigationMap {
  id: string;
  projectId?: string; // Links map to a top-level project
  caseFileId: string; // Legacy fallback/reference
  nodes: MapNode[];
  edges: MapEdge[];
}

export interface CaseFile {
  version: 1;
  title: string;
  createdAt: number;
  sections: CaseFileSection[];
  map?: InvestigationMap;
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
  isStreaming?: boolean; // True only when content is being actively generated/typed
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

export interface ChatSession {
  id: string;              // UUID
  projectId?: string;      // Links chat to a top-level project
  title: string;           // Auto-generated or user-editable
  createdAt: number;       // Unix timestamp ms
  updatedAt: number;       // Unix timestamp ms
  chatHistory: ChatMessage[];
  tokenUsage: TokenUsage;
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

// ─── Dossier / Topic Types ─────────────────────────────────────────────────────────

export type DossierType = 'person' | 'organization' | 'event' | 'location' | 'topic' | 'custom';

export interface DossierSource {
  type: 'web' | 'document' | 'chat_exchange';
  label: string;          // Display name
  url?: string;           // For web sources
  fileId?: string;        // For document sources
  chatSessionId?: string; // For chat_exchange
  snippet?: string;       // Short excerpt
  start?: number;         // Start offset for document highlighting
  end?: number;           // End offset for document highlighting
  parentChunkIndex?: number; // Chunk index for structural linking
}

export interface DossierSection {
  id: string;             // e.g. "dsec-0"
  title: string;          // e.g. "Background", "Key Relations", "Timeline"
  content: string;        // Raw markdown
  updatedAt: number;
  sources: DossierSource[];
  proposedContent?: string;
  isProcessing?: boolean;
}

export interface Dossier {
  id: string;
  projectId?: string;     // Links dossier to a top-level project
  title: string;          // Subject name, e.g. "John Smith"
  dossierType: DossierType;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  sections: DossierSection[];
  linkedMapNodeId?: string; // If linked to a node on the investigation map
}