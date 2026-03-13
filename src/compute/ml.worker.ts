/// <reference types="@webgpu/types" />
import { pipeline, FeatureExtractionPipeline, AutoTokenizer, AutoModelForSequenceClassification, env } from '@huggingface/transformers';

// Configure Transformers.js to use local models exclusively and set the correct path
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = '/models/';

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
  EmbedQueryResult,
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
      const modelId = 'Xenova/all-MiniLM-L6-v2';

      try {
        if (isLoggingEnabled) console.log(`[ML Worker] Initializing v3 embedding pipeline...`);

        // Try WebGPU with FP16 first (Standard for v3)
        try {
          this.instance = (await pipeline('feature-extraction', modelId, {
            device: 'webgpu',
            dtype: 'fp16',
          })) as unknown as FeatureExtractionPipeline;
          this.platform = 'gpu';
          if (isLoggingEnabled) console.log(`[ML Worker] v3 Embedding: WebGPU (fp16) SUCCESS.`);
        } catch (gpuError) {
          console.warn(`[ML Worker] WebGPU (fp16) failed, trying WebGPU (fp32)...`, gpuError);
          try {
            this.instance = (await pipeline('feature-extraction', modelId, {
              device: 'webgpu',
              dtype: 'fp32',
            })) as unknown as FeatureExtractionPipeline;
            this.platform = 'gpu';
            if (isLoggingEnabled) console.log(`[ML Worker] v3 Embedding: WebGPU (fp32) SUCCESS.`);
          } catch (gpuError2) {
            console.warn(`[ML Worker] WebGPU failed, falling back to CPU...`, gpuError2);
            this.instance = (await pipeline('feature-extraction', modelId, {
              device: 'wasm',
              dtype: 'q8',
            })) as unknown as FeatureExtractionPipeline;
            this.platform = 'cpu';
            if (isLoggingEnabled) console.log(`[ML Worker] v3 Embedding: CPU (q8) SUCCESS.`);
          }
        }
      } catch (e) {
        console.error(`[ML Worker] Critical failure in v3 embedding pipeline:`, e);
        throw e;
      }

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

      try {
        if (isLoggingEnabled) console.log(`[ML Worker] Initializing v3 reranker pipeline...`);
        const tokenizer = await AutoTokenizer.from_pretrained(modelName);
        let model;
        let platform: 'gpu' | 'cpu' = 'cpu';

        try {
          // Try GPU for reranker (INT8 since bge-reranker usually doesn't have FP16 locally)
          model = await AutoModelForSequenceClassification.from_pretrained(modelName, {
            device: 'webgpu',
            dtype: 'q8'
          });
          platform = 'gpu';
          if (isLoggingEnabled) console.log(`[ML Worker] v3 Reranker: WebGPU (q8) SUCCESS.`);
        } catch (e) {
          console.warn(`[ML Worker] v3 Reranker WebGPU failed, falling back to CPU...`, e);
          model = await AutoModelForSequenceClassification.from_pretrained(modelName, {
            device: 'wasm',
            dtype: 'q8'
          });
          platform = 'cpu';
          if (isLoggingEnabled) console.log(`[ML Worker] v3 Reranker: CPU (q8) SUCCESS.`);
        }

        this.instance = new CustomRerankerPipeline(tokenizer, model);
        this.platform = platform;
      } catch (e) {
        console.error(`[ML Worker] Critical failure in v3 reranker pipeline:`, e);
        throw e;
      }
    }
    return this.instance;
  }

  /**
   * Scores query-document pairs using the cross-encoder.
   * Accepts pairs as [[query, doc], [query, doc], ...] — the tokenizer
   * automatically formats each pair as [CLS] query [SEP] doc [SEP],
   * matching the format the model was trained on.
   */
  async run(pairs: [string, string][]): Promise<number[]> {
    // @ts-expect-error - Transformers.js typing issue
    const inputs = this.tokenizer(pairs, { padding: true, truncation: true, return_tensors: 'pt' });
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

async function initPhase1(): Promise<void> {
  await EmbeddingPipeline.getInstance();
  if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Phase 1 complete — embedding pipeline ready.`);
  self.postMessage({ type: 'worker_initialized', workerId });
}

async function initPhase2(): Promise<void> {
  try {
    await CustomRerankerPipeline.getInstance();
    if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Phase 2 complete — reranker pipeline ready.`);
    self.postMessage({ type: 'worker_reranker_ready', workerId });
  } catch (e) {
    console.error(`[ML Worker ${workerId}] Phase 2 failed — reranker could not be loaded.`, e);
    // Non-fatal: worker is still usable for embedding tasks.
    // Emit reranker_ready with an error flag so the coordinator knows.
    self.postMessage({ type: 'worker_reranker_ready', workerId, error: true });
  }
}

async function initializeAndReport() {
  try {
    if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Received initialization command. Starting Phase 1 (embedding)...`);
    // Phase 1: load embedding pipeline — await this so the worker is ready for tasks ASAP.
    await initPhase1();
    // Phase 2: load reranker concurrently in background — intentionally NOT awaited.
    // The worker is already accepting tasks while this runs.
    initPhase2();
  } catch (e) {
    console.error(`[ML Worker ${workerId}] Critical error during Phase 1 initialization.`, e);
    // Do not send worker_initialized — coordinator will handle timeout (future: 5.4).
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
        result = Array.from(embeddingResult.data) as EmbedQueryResult;
        if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Finished query embedding for: ${taskId}`);
        break;
      }
      case TaskType.Rerank: {
        if (isLoggingEnabled) console.log(`[ML Worker ${workerId}] Starting reranking for: ${taskId}`);
        const { query, documents } = taskPayload;
        const reranker = await CustomRerankerPipeline.getInstance();
        // Pass [query, document] pairs directly — the tokenizer handles
        // [CLS] query [SEP] doc [SEP] formatting, matching training conditions.
        const rerankPairs: [string, string][] = documents.map(d => [query, d.chunk]);
        const rerankedScores = await reranker.run(rerankPairs);

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
      case TaskType.EmbedSnippet: {
        const payload = taskPayload;
        const embedder = await EmbeddingPipeline.getInstance();
        const embeddingResult = await embedder(payload.snippet, { pooling: 'mean', normalize: true });
        result = {
          snippet: payload.snippet,
          embedding: Array.from(embeddingResult.data),
        };
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