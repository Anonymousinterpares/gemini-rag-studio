/// <reference types="@webgpu/types" />
import { pipeline, FeatureExtractionPipeline, AutoTokenizer, AutoModelForSequenceClassification } from '@xenova/transformers';
import {
  CoordinatorToWorkerMessage,
  TaskType,
  TaskResult,
  ComputeTask,
  HierarchicalChunkPayload,
  HierarchicalChunkResult,
  EmbedChildChunkPayload,
  EmbedChildChunkResult,
  StreamChunkPayload,
  StreamChunkResult,
  CompleteStreamPayload,
} from './types';
import { hierarchicalChunker, StreamingHierarchicalChunker } from '../rag/hierarchical-splitter';

let isLoggingEnabled = true; // Default to true

// Maintain state for streaming ingestion
const streamChunkers = new Map<string, StreamingHierarchicalChunker>();

// --- Embedding Pipeline ---
class EmbeddingPipeline {
  static instance: FeatureExtractionPipeline | null = null;
  static platform: 'gpu' | 'cpu' | null = null;

  static async getInstance(): Promise<FeatureExtractionPipeline> {
    if (this.instance === null) {
      const options: {
        local_files_only: boolean,
        device?: GPUDevice,
        quantized?: boolean
      } = { local_files_only: true };
      try {
        if (navigator.gpu) {
          const adapter = await navigator.gpu.requestAdapter();
          if (adapter) {
            const device = await adapter.requestDevice();
            options.device = device;
            options.quantized = true;
            this.platform = 'gpu';
            if (isLoggingEnabled) console.log(`[ML Worker] Initializing embedding pipeline on GPU.`);
          } else {
            throw new Error("No suitable GPU adapter found.");
          }
        } else {
            throw new Error("WebGPU not supported.");
        }
      } catch (e) {
        this.platform = 'cpu';
        console.error(`[ML Worker] Critical GPU initialization failed. Falling back to CPU for embedding.`, e);
      }

      this.instance = (await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        options
      )) as FeatureExtractionPipeline;

      if (isLoggingEnabled) console.log(`[ML Worker] Embedding pipeline successfully initialized. Final platform: ${this.platform}`);

      self.postMessage({
        type: 'worker_device_status',
        workerId,
        device: this.platform,
      });
    }
    return this.instance;
  }
}

// --- Reranker Pipeline ---
class CustomRerankerPipeline {
    private tokenizer: AutoTokenizer;
    private model: AutoModelForSequenceClassification;
    static platform: 'gpu' | 'cpu' | null = null;

    private constructor(tokenizer: AutoTokenizer, model: AutoModelForSequenceClassification) {
        this.tokenizer = tokenizer;
        this.model = model;
    }

    static instance: CustomRerankerPipeline | null = null;

    static async getInstance(): Promise<CustomRerankerPipeline> {
        if (this.instance === null) {
            const modelName = 'Xenova/bge-reranker-base';
            const options: { local_files_only: boolean, device?: GPUDevice, quantized?: boolean } = { local_files_only: true };
            
            try {
                if (navigator.gpu) {
                    const adapter = await navigator.gpu.requestAdapter();
                    if (adapter) {
                        const device = await adapter.requestDevice();
                        options.device = device;
                        options.quantized = true;
                        this.platform = 'gpu';
                        if (isLoggingEnabled) console.log(`[ML Worker] Initializing reranker pipeline on GPU.`);
                    } else { throw new Error("No GPU adapter"); }
                } else { throw new Error("WebGPU not supported"); }
            } catch (e) {
                this.platform = 'cpu';
                console.error(`[ML Worker] Critical GPU initialization failed. Falling back to CPU for reranker.`, e);
            }

            const tokenizer = await AutoTokenizer.from_pretrained(modelName, { local_files_only: true });
            const model = await AutoModelForSequenceClassification.from_pretrained(modelName, options);
            this.instance = new CustomRerankerPipeline(tokenizer, model);
            if (isLoggingEnabled) console.log(`[ML Worker] Reranker pipeline successfully initialized. Final platform: ${this.platform}`);
        }
        return this.instance;
    }

    async run(texts: string[]): Promise<number[]> {
        // @ts-expect-error - Transformers.js typing issue
        const inputs = this.tokenizer(texts, { padding: true, truncation: true, return_tensors: 'pt' });
        // @ts-expect-error - Transformers.js typing issue
        const { logits } = await this.model(inputs);
        
        // Apply sigmoid to convert logits to probabilities
        const scores = Array.from(logits.data).map(logit => 1 / (1 + Math.exp(-(logit as number))));
        return scores;
    }
}

if (isLoggingEnabled) console.log('[ML Worker] Script loaded.');

const workerId = self.name || `ml-worker-${Math.random().toString(36).substring(2, 9)}`;

self.onmessage = (event: MessageEvent<CoordinatorToWorkerMessage>) => {
  const { type } = event.data;

  switch (type) {
    case 'set_logging':
      isLoggingEnabled = event.data.enabled;
      if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Logging is now ${isLoggingEnabled ? 'ON' : 'OFF'}`);
      break;
    case 'initialize_worker':
      initializeAndReport();
      break;
    case 'start_task': {
      const { task } = event.data;
      // if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Received task:`, task.payload);
      executeTask(task);
      break;
    }
  }
};

async function initializeAndReport() {
  try {
    if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Received initialization command.`);
    await EmbeddingPipeline.getInstance();
    await CustomRerankerPipeline.getInstance();
    if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] All pipelines initialized successfully.`);
    self.postMessage({ type: 'worker_initialized', workerId });
  } catch (e) {
    console.error(`[ML Worker ${workerId}] A critical error occurred during pipeline initialization.`, e);
    // We don't send a message back, the coordinator will time out.
  }
}

async function executeTask(task: ComputeTask) {
  const { id: taskId, jobId, payload: taskPayload } = task;
  try {
    let result: TaskResult;

    switch (taskPayload.type) {
      case TaskType.EmbedDocumentChunk: {
        const payload = taskPayload;
        // if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Starting embedding for: ${taskId}`);
        const embedder = await EmbeddingPipeline.getInstance();
        const embeddingResult = await embedder(payload.chunkText, { pooling: 'mean', normalize: true });
        
        result = {
          docId: payload.docId,
          chunkIndex: payload.chunkIndex,
          chunkText: payload.chunkText,
          embedding: Array.from(embeddingResult.data),
          name: payload.name,
          lastModified: payload.lastModified,
          size: payload.size,
        };
        // if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Finished embedding for: ${taskId}`);
        break;
      }
      case TaskType.EmbedQuery: {
        if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Starting query embedding for: ${taskId}`);
        const { query } = taskPayload;
        const embedder = await EmbeddingPipeline.getInstance();
        const embeddingResult = await embedder(query, { pooling: 'mean', normalize: true });
        result = Array.from(embeddingResult.data);
        if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Finished query embedding for: ${taskId}`);
        break;
      }
      case TaskType.Rerank: {
        if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Starting reranking for: ${taskId}`);
        const { query, documents } = taskPayload;
        const reranker = await CustomRerankerPipeline.getInstance();
        const rerankInputs = documents.map(d => query + "</s>" + d.chunk);
        const rerankedScores = await reranker.run(rerankInputs);
        
        const rankedDocuments = documents.map((doc, i) => ({
          ...doc,
          similarity: rerankedScores[i],
        })).sort((a, b) => b.similarity - a.similarity);

        result = rankedDocuments;
        if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Finished reranking for: ${taskId}`);
        break;
      }
      case TaskType.HierarchicalChunk: {
        if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Starting hierarchical chunking for: ${taskId}`);
        const payload = taskPayload as HierarchicalChunkPayload;
        
        const { parentChunks, childChunks } = await hierarchicalChunker(
          payload.docContent,
          payload.chunkSize,
          payload.chunkOverlap
        );

        result = {
            docId: payload.docId,
            parentChunks,
            childChunks,
            name: payload.name,
            lastModified: payload.lastModified,
            size: payload.size,
        } as HierarchicalChunkResult;
        if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Finished hierarchical chunking for: ${taskId}`);
        break;
      }
      case TaskType.EmbedChildChunk: {
        const payload = taskPayload as EmbedChildChunkPayload;
        // if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Starting child chunk embedding for: ${taskId}`);
        const embedder = await EmbeddingPipeline.getInstance();
        const embeddingResult = await embedder(payload.childChunkText, { pooling: 'mean', normalize: true });
        
        result = {
          docId: payload.docId,
          childChunkIndex: payload.childChunkIndex,
          childChunkText: payload.childChunkText,
          parentChunkIndex: payload.parentChunkIndex,
          embedding: Array.from(embeddingResult.data),
          name: payload.name,
          lastModified: payload.lastModified,
          size: payload.size,
        } as EmbedChildChunkResult;
        // if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Finished child chunk embedding for: ${taskId}`);
        break;
      }
      case TaskType.StreamChunk: {
        const payload = taskPayload as StreamChunkPayload;
        if (payload.isFirst || !streamChunkers.has(payload.docId)) {
            // Defaulting to 1000/200 for now. The coordinator can pass these if needed.
            streamChunkers.set(payload.docId, new StreamingHierarchicalChunker(1000, 200));
        }
        const chunker = streamChunkers.get(payload.docId)!;
        const { parentChunks, childChunks } = await chunker.processChunk(payload.chunkText, false);
        
        const embeddings: number[][] = [];
        if (childChunks.length > 0) {
            const embedder = await EmbeddingPipeline.getInstance();
            for (const child of childChunks) {
                const embeddingResult = await embedder(child.text, { pooling: 'mean', normalize: true });
                embeddings.push(Array.from(embeddingResult.data));
            }
        }

        result = {
            docId: payload.docId,
            parentChunks,
            childChunks,
            embeddings,
        } as StreamChunkResult;
        break;
      }
      case TaskType.CompleteStream: {
        const payload = taskPayload as CompleteStreamPayload;
        const chunker = streamChunkers.get(payload.docId);
        if (!chunker) {
            throw new Error(`[ML Worker] Received CompleteStream for ${payload.docId} but no chunker found.`);
        }
        const { parentChunks, childChunks } = await chunker.processChunk("", true);
        streamChunkers.delete(payload.docId);

        // We return these as a HierarchicalChunkResult so the coordinator can reuse existing logic
        result = {
            docId: payload.docId,
            parentChunks,
            childChunks,
            name: payload.name,
            lastModified: payload.lastModified,
            size: payload.size,
        } as HierarchicalChunkResult;
        break;
      }
      default: {
        // This worker should not receive other task types.
        // If the coordinator works correctly, this code is unreachable.
        throw new Error(`[ML Worker] Received an unsupported task type in the default switch case.`);
      }
    }

    self.postMessage({
      type: 'task_complete',
      taskId: taskId, // Ensure we send back the main task ID
      jobId,
      taskType: taskPayload.type,
      result,
    });

  } catch (error) {
    console.error(`[ML Worker ${workerId}] Error executing task ${taskId}:`, error);
    self.postMessage({
      type: 'task_error',
      taskId,
      jobId,
      error: error instanceof Error ? error.message : 'An unknown error occurred',
    });
  }
}

// Notify the coordinator that the worker script has loaded and is ready to be initialized.
self.postMessage({ type: 'worker_ready', workerId });
if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Script loaded, awaiting initialization command.`);