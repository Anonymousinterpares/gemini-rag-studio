import { SearchResult, Model, TokenUsage } from "../types";
import { DocumentChunk } from "../rag/pipeline";

// The different types of computation the engine can perform
export enum TaskType {
  EmbedDocumentChunk,
  EmbedQuery,
  Rerank,
  CalculateLayout,
  Summarize,
  GenerateSummaryQuery,
  ExecuteRAGForSummary,
  DetectLanguage,
  HierarchicalChunk,
  EmbedChildChunk,
  IndexDocument,
  StreamChunk,
  CompleteStream,
}

// Task priorities, from highest to lowest
export enum TaskPriority {
  P0_UserView,      // User is actively waiting for this layout
  P1_Primary,       // High priority background work (embedding, reranking)
  P2_Background,    // Proactive background layout calculation
}

// Specific payload for a chunk of data from a stream
export interface StreamChunkPayload {
  type: TaskType.StreamChunk;
  docId: string;
  chunkText: string;
  isFirst: boolean;
  name: string;
  lastModified: number;
  size: number;
}

// Specific payload for signaling completion of a stream
export interface CompleteStreamPayload {
  type: TaskType.CompleteStream;
  docId: string;
  name: string;
  lastModified: number;
  size: number;
  chunkSize: number;
  chunkOverlap: number;
}

// Specific payload for embedding a document chunk
export interface EmbedDocumentChunkPayload {
  type: TaskType.EmbedDocumentChunk;
  docId: string;
  chunkIndex: number;
  chunkText: string;
  name: string;
  lastModified: number;
  size: number;
  totalChunks: number;
}

// Specific payload for calculating text layout for a document
export interface CalculateLayoutPayload {
  type: TaskType.CalculateLayout;
  docId: string;
  docContent?: string;
  file?: File;
  containerWidth: number;
  fontSize: number;
  fontFamily: string;
}

// Specific payload for embedding a search query
export interface EmbedQueryPayload {
  type: TaskType.EmbedQuery;
  query: string;
}

// Specific payload for re-ranking search results
export interface RerankPayload {
  type: TaskType.Rerank;
  query: string;
  // A simplified version of the search result for the worker
  documents: {
    chunk: string;
    id: string; // Changed from path to id
    start: number;
    end: number;
  }[];
}

// Specific payload for summarizing a document
export interface SummarizePayload {
  type: TaskType.Summarize;
  docId: string;
  searchResults: SearchResult[];
  model: Model;
  apiKey: string | undefined;
}

// Specific payload for generating a summary query
export interface GenerateSummaryQueryPayload {
    type: TaskType.GenerateSummaryQuery;
    docId: string;
    firstTwoChunks: string;
    model: Model;
    apiKey: string | undefined;
}

// Specific payload for executing RAG for a summary
export interface ExecuteRAGForSummaryPayload {
    type: TaskType.ExecuteRAGForSummary;
    docId: string;
    query: string;
    model: Model;
    apiKey: string | undefined;
}

export interface ExecuteRAGForSummaryResult {
    docId: string;
    searchResults: SearchResult[];
    model: Model;
    apiKey: string | undefined;
}

export interface DetectLanguagePayload {
    type: TaskType.DetectLanguage;
    docId: string;
    content: string;
    model: Model;
    apiKey: string;
}

export interface HierarchicalChunkPayload {
  type: TaskType.HierarchicalChunk;
  docId: string;
  docContent: string;
  name: string;
  lastModified: number;
  size: number;
  chunkSize: number;
  chunkOverlap: number;
}

export interface EmbedChildChunkPayload {
  type: TaskType.EmbedChildChunk;
  docId: string;
  childChunkIndex: number;
  childChunkText: string;
  parentChunkIndex: number; // Link back to the parent
  name: string;
  lastModified: number;
  size: number;
  totalChunks: number;
}

// A union of all possible task payloads the engine can handle
export type ComputeTaskPayload =
  | EmbedDocumentChunkPayload
  | CalculateLayoutPayload
  | EmbedQueryPayload
  | RerankPayload
  | SummarizePayload
  | GenerateSummaryQueryPayload
  | ExecuteRAGForSummaryPayload
  | DetectLanguagePayload
  | HierarchicalChunkPayload
  | EmbedChildChunkPayload
  | IndexDocumentPayload
  | StreamChunkPayload
  | CompleteStreamPayload;

export interface IndexDocumentPayload {
  type: TaskType.IndexDocument;
  docId: string;
  parentChunks: DocumentChunk[];
}

// A task as it exists in the coordinator's queue, combining payload with metadata
export interface ComputeTask {
  id: string;
  jobId: string; // The ID of the parent job this task belongs to
  priority: TaskPriority;
  payload: ComputeTaskPayload;
}

// --- Message Contracts ---

// Message from Coordinator to Worker to start a task
export interface StartTaskMessage {
  type: 'start_task';
  payload: ComputeTaskPayload;
}

// --- Result Types ---


export interface EmbedDocumentChunkResult {
  docId: string;
  chunkIndex: number;
  chunkText: string;
  embedding: number[];
  name: string;
  lastModified: number;
  size: number;
}

export interface EmbedChildChunkResult {
  docId: string;
  childChunkIndex: number;
  childChunkText: string;
  parentChunkIndex: number;
  embedding: number[];
  name: string;
  lastModified: number;
  size: number;
}

export type EmbedQueryResult = number[];

export type RerankResult = SearchResult[];

export interface IngestionJobPayload {
  name: string;
  lastModified: number;
  size: number;
  embeddings: number[][]; // Now always a dynamic array
  chunks?: DocumentChunk[]; // Legacy path: standard chunks
  parentChunks?: DocumentChunk[]; // New path: parent chunks
  childChunks?: DocumentChunk[]; // New path: child chunks to be embedded
  language: string;
  isStreaming?: boolean;
}

export interface CalculateLayoutResult {
  docId: string;
  // For now, we just signal completion. The layout data is managed
  // by the useTextLayout hook and its cache.
    layout: ParagraphLayout[];
  }

export interface SummarizeResult {
  docId: string;
  summary: string;
  tokenUsage: TokenUsage;
}

export interface GenerateSummaryQueryResult {
    docId: string;
    query: string;
    model: Model;
    apiKey: string | undefined;
}

export interface DetectLanguageResult {
    docId: string;
    language: string;
}

export interface HierarchicalChunkResult {
  docId: string;
  parentChunks: DocumentChunk[];
  // Child chunks need to reference their parent
  childChunks: DocumentChunk[];
  name: string;
  lastModified: number;
  size: number;
}
  
  // --- Data Structures for Layout ---
  export interface Line {
    text: string;
    startIndex: number;
  }
  
  export interface ParagraphLayout {
    lines: Line[];
    startIndex: number;
  }
  
  
  export interface StreamChunkResult {
  docId: string;
  // If the chunk resulted in any finalized parent/child chunks, return them.
  parentChunks: DocumentChunk[];
  childChunks: DocumentChunk[];
  // If we have embeddings for those child chunks, return them.
  embeddings: number[][];
}

export type TaskResult =
  | EmbedDocumentChunkResult
  | EmbedQueryResult
  | RerankResult
  | CalculateLayoutResult
  | SummarizeResult
  | GenerateSummaryQueryResult
  | ExecuteRAGForSummaryResult
  | DetectLanguageResult
  | HierarchicalChunkResult
  | EmbedChildChunkResult
  | IndexDocumentResult
  | StreamChunkResult;


// --- Message Contracts ---

// Message from Coordinator to Worker to start a task
export interface StartTaskMessage {
  type: 'start_task';
  task: ComputeTask;
}

// Message from Worker to Coordinator with the result of a completed task
export interface TaskCompleteMessage {
  type: 'task_complete';
  taskId: string;
  jobId: string; // Pass the job ID back for tracking
  taskType: TaskType;
  result: TaskResult;
}

// Message from Worker to Coordinator indicating an error
export interface TaskErrorMessage {
    type: 'task_error';
    taskId:string;
    jobId: string;
    error: string;
}

// Message from Worker to Coordinator when it's initialized and ready for work
export interface WorkerReadyMessage {
    type: 'worker_ready';
    workerId: string; // A unique ID for the worker
}

// Message from Coordinator to Worker to start its initialization process
export interface InitializeWorkerMessage {
  type: 'initialize_worker';
}

// Message from Worker to Coordinator when it has fully initialized its internal pipelines
export interface WorkerInitializedMessage {
    type: 'worker_initialized';
    workerId: string;
}

// A new message from the Coordinator to the App to signal job completion
export interface JobCompleteMessage {
  type: 'job_complete';
  jobId: string;
  jobName: string;
  payload?: unknown;
}

export type CoordinatorToWorkerMessage = StartTaskMessage | InitializeWorkerMessage | SetLoggingStateMessage;
export type ComputeDevice = 'gpu' | 'cpu' | 'unknown';

// Message from Worker to Coordinator with its determined compute device
export interface WorkerDeviceStatusMessage {
  type: 'worker_device_status';
  workerId: string;
  device: ComputeDevice;
}

// Message from Coordinator to App with the overall system compute status
export interface SystemComputeStatusMessage {
  type: 'system_compute_status';
  device: ComputeDevice;
  mlWorkerCount: number;
}

// Message from Coordinator to App with job progress updates
export interface JobProgressMessage {
  type: 'job_progress';
  jobId: string;
  jobName: string;
  progress: number;
  total: number;
}

// Message from Coordinator to Worker to enable/disable logging
export interface SetLoggingStateMessage {
  type: 'set_logging';
  enabled: boolean;
}

export interface SearchMessage {
    type: 'search';
    queryEmbedding: number[];
    topK: number;
    docId?: string;
}

export interface EmbedAndSearchMessage {
    type: 'embed_and_search';
    query: string;
    topK: number;
    docId?: string;
}

export interface SearchResultMessage {
    type: 'search_result';
    results: SearchResult[];
}

export type WorkerToCoordinatorMessage = TaskCompleteMessage | TaskErrorMessage | WorkerReadyMessage | WorkerInitializedMessage | WorkerDeviceStatusMessage | SearchMessage | EmbedAndSearchMessage;

// Defines a strict mapping between event names and their payload types for the coordinator's event emitter.
export interface LayoutUpdatedMessage {
  type: 'layout_updated';
  docId: string;
}

export interface SummaryGenerationStartedMessage {
    type: 'summary_generation_started';
    docId: string;
}

export interface SummaryGenerationCompletedMessage {
    type: 'summary_generation_completed';
    docId: string;
    summary: string;
    tokenUsage: TokenUsage;
}

export interface SummaryGenerationFailedMessage {
    type: 'summary_generation_failed';
    docId: string;
    error: string;
}

export interface TokenUsageUpdateMessage {
    type: 'token_usage_update';
    usage: TokenUsage;
}

export interface StreamChunkAddedMessage {
    type: 'stream_chunk_added';
    docId: string;
    parentChunks: DocumentChunk[];
    childChunks: DocumentChunk[];
    embeddings: number[][];
}

export interface CoordinatorEventMap {
  'task_complete': TaskCompleteMessage;
  'job_complete': JobCompleteMessage;
  'job_progress': JobProgressMessage;
  'system_compute_status': SystemComputeStatusMessage;
  'layout_updated': LayoutUpdatedMessage;
  'summary_generation_started': SummaryGenerationStartedMessage;
  'summary_generation_completed': SummaryGenerationCompletedMessage;
  'summary_generation_failed': SummaryGenerationFailedMessage;
  'token_usage_update': TokenUsageUpdateMessage;
  'stream_chunk_added': StreamChunkAddedMessage;
}