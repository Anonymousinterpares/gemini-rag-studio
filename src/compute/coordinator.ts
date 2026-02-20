import { AppSettings } from '../config';
import { ComputeTask, TaskPriority, WorkerToCoordinatorMessage, TaskType, JobCompleteMessage, CoordinatorEventMap, ComputeDevice, JobProgressMessage, ParagraphLayout, CalculateLayoutResult, SummarizeResult, HierarchicalChunkResult, EmbedChildChunkResult, IndexDocumentResult } from './types';
import { VectorStore } from '../rag/pipeline';

type Listener<T> = (payload: T) => void;

// Represents a single unit of work managed by the coordinator
interface Job {
  id: string;
  name: string;
  tasks: ComputeTask[];
  completedTasks: number;
  pendingTaskIds: Set<string>; // Track remaining tasks
}

// Represents a worker, tracking its status and current task
interface WorkerHandle {
  worker: Worker;
  id: string;
  isIdle: boolean;
  isInitialized: boolean; // New flag to track full initialization
  currentTaskId: string | null;
}

export class ComputeCoordinator {
  private mlWorkerPool: WorkerHandle[] = [];
  private mlWorkersToInitialize: string[] = [];
  private gpWorkerPool: WorkerHandle[] = [];
  private mlTaskQueue: ComputeTask[] = [];
  private gpTaskQueue: ComputeTask[] = [];
  private jobRegistry = new Map<string, Job>();
  private summaryJobsInProgress = new Set<string>();
  private listeners = new Map<keyof CoordinatorEventMap, Set<Listener<unknown>>>();
  private workerDeviceStatuses = new Map<string, ComputeDevice>();
  private layoutCache = new Map<string, ParagraphLayout[]>();
  private embeddingResults = new Map<string, import('./types').IngestionJobPayload>();
  private workerPins = new Map<string, string>(); // docId -> workerId
  private nextJobId = 0;
  private nextMlWorkerIndex = 0;
  private isLoggingEnabled = true;
  private vectorStore: VectorStore;
  private setActiveJobCount: (updater: (prev: number) => number) => void;

  public on<K extends keyof CoordinatorEventMap>(eventName: K, listener: Listener<CoordinatorEventMap[K]>): void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName)!.add(listener as Listener<unknown>);
  }

  public off<K extends keyof CoordinatorEventMap>(eventName: K, listener: Listener<CoordinatorEventMap[K]>): void {
    if (this.listeners.has(eventName)) {
      this.listeners.get(eventName)!.delete(listener as Listener<unknown>);
    }
  }

  private emit<K extends keyof CoordinatorEventMap>(eventName: K, payload: CoordinatorEventMap[K]): void {
    if (this.listeners.has(eventName)) {
      this.listeners.get(eventName)!.forEach(listener => {
        try {
          (listener as Listener<CoordinatorEventMap[K]>)(payload);
        } catch (e) {
          console.error(`[Coordinator] Error in listener for event "${eventName}":`, e);
        }
      });
    }
  }

  constructor(settings: AppSettings, hardwareConcurrency: number, setActiveJobCount: (updater: (prev: number) => number) => void, vectorStore: VectorStore) {
    this.vectorStore = vectorStore;
    this.setActiveJobCount = setActiveJobCount;
    const numMlWorkers = settings.numMlWorkers;
    const numGpWorkers = Math.max(1, hardwareConcurrency - numMlWorkers);

    if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Initializing with ${numMlWorkers} ML workers and ${numGpWorkers} GP workers.`);
    this.setLogging(settings.isLoggingEnabled);

    // Initialize ML Worker Pool
    for (let i = 0; i < numMlWorkers; i++) {
      this.addMlWorker();
    }

    // Initialize General Purpose Worker Pool
    for (let i = 0; i < numGpWorkers; i++) {
      const workerId = `gp-worker-${i}`;
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: workerId });
      const handle: WorkerHandle = { worker, id: workerId, isIdle: true, isInitialized: true, currentTaskId: null };
      this.gpWorkerPool.push(handle);
      this.workerDeviceStatuses.set(workerId, 'cpu');
      worker.onmessage = (event: MessageEvent<WorkerToCoordinatorMessage>) => this.handleWorkerMessage(handle, event.data);
    }
  }

  private handleWorkerMessage(workerHandle: WorkerHandle, message: WorkerToCoordinatorMessage) {
    switch (message.type) {
      case 'worker_ready':
        if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Worker script ${message.workerId} has loaded.`);
        // If it's the first ML worker in the queue, kick off its initialization.
        if (this.mlWorkersToInitialize[0] === message.workerId) {
          if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Sending initialization command to ${message.workerId}.`);
          workerHandle.worker.postMessage({ type: 'initialize_worker' });
        }
        break;
      case 'worker_initialized':
        if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Worker ${message.workerId} has successfully initialized its pipelines.`);
        workerHandle.isInitialized = true;
        workerHandle.isIdle = true;
        // Remove the initialized worker from the queue
        this.mlWorkersToInitialize.shift();
        // Trigger initialization of the next worker if it exists
        if (this.mlWorkersToInitialize.length > 0) {
          const nextWorkerId = this.mlWorkersToInitialize[0];
          const nextWorkerHandle = this.mlWorkerPool.find(w => w.id === nextWorkerId);
          if (nextWorkerHandle) {
            if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Sending initialization command to ${nextWorkerId}.`);
            nextWorkerHandle.worker.postMessage({ type: 'initialize_worker' });
          }
        } else {
          if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] All ML workers have been initialized.`);
        }
        // Attempt to dispatch tasks now that a worker is ready
        this.dispatchTasks();
        break;
      case 'worker_device_status':
        if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Worker ${message.workerId} reported final device status: ${message.device}`);
        this.workerDeviceStatuses.set(message.workerId, message.device);
        this.updateAndEmitSystemStatus();
        break;
      case 'task_complete': {
        const { jobId, taskId, taskType, result } = message;
        // if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator DEBUG] Task ${taskId} (Type: ${TaskType[taskType]}) completed by worker ${workerHandle.id}.`);
        
        switch (taskType) {
          case TaskType.DetectLanguage: {
            const { docId, language, tokenUsage } = result as import('./types').DetectLanguageResult;
            if (tokenUsage) {
                this.emit('token_usage_update', { type: 'token_usage_update', usage: tokenUsage });
            }
            // This is a fire-and-forget operation for the coordinator.
            // The result will be used by the main thread to update the file state.
            if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Language for ${docId} detected as ${language}.`);
            break;
          }
          case TaskType.CalculateLayout: {
            const layoutResult = result as CalculateLayoutResult;
            this.layoutCache.set(layoutResult.docId, layoutResult.layout);
            if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator DIAGNOSTIC] Emitting 'layout_updated' for ${layoutResult.docId}.`);
            this.emit('layout_updated', { type: 'layout_updated', docId: layoutResult.docId });
            break;
          }
          case TaskType.EmbedDocumentChunk: {
            const embedResult = result as import('./types').EmbedDocumentChunkResult;
            const fileResult = this.embeddingResults.get(embedResult.docId);
            if (fileResult) {
              if (fileResult.isStreaming) {
                fileResult.embeddings.push(Array.from(embedResult.embedding));
              } else {
                fileResult.embeddings[embedResult.chunkIndex] = Array.from(embedResult.embedding);
              }
            }
            break;
          }
          case TaskType.EmbedChildChunk: {
            const embedResult = result as EmbedChildChunkResult;
            const fileResult = this.embeddingResults.get(embedResult.docId);
            if (fileResult) {
              if (fileResult.isStreaming) {
                fileResult.embeddings.push(Array.from(embedResult.embedding));
              } else {
                // The embeddings array now corresponds to the child chunks
                fileResult.embeddings[embedResult.childChunkIndex] = Array.from(embedResult.embedding);
              }
            }
            break;
          }
          case TaskType.GenerateSummaryQuery: {
            const { docId, query, model, apiKey, tokenUsage } = result as import('./types').GenerateSummaryQueryResult;
            if (tokenUsage) {
                this.emit('token_usage_update', { type: 'token_usage_update', usage: tokenUsage });
            }
            const nextTask: Omit<ComputeTask, 'jobId'> = {
              id: `${docId}-execute-rag-for-summary`,
              priority: TaskPriority.P2_Background,
              payload: {
                type: TaskType.ExecuteRAGForSummary,
                docId,
                query,
                model,
                apiKey,
              },
            };
            this.addTasksToJob(jobId, [nextTask]);
            break;
          }
          case TaskType.ExecuteRAGForSummary: {
            const { docId, searchResults, model, apiKey } = result as import('./types').ExecuteRAGForSummaryResult;
            if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator DEBUG] RAG for summary task complete for ${docId}. Creating next Summarize task with ${searchResults.length} search results.`, { searchResults });
            const nextTask: Omit<ComputeTask, 'jobId'> = {
              id: `${docId}-summarize`,
              priority: TaskPriority.P2_Background,
              payload: {
                type: TaskType.Summarize,
                docId,
                searchResults,
                model,
                apiKey,
              },
            };
            this.addTasksToJob(jobId, [nextTask]);
            break;
          }
          case TaskType.Summarize: {
            // This is the final step in the summary chain. The job_complete handler will now have the payload.
            break;
          }
          case TaskType.HierarchicalChunk: {
            const chunkResult = result as HierarchicalChunkResult;
            if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator DEBUG] HierarchicalChunk task complete for ${chunkResult.docId}. Found ${chunkResult.parentChunks.length} parent and ${chunkResult.childChunks.length} child chunks.`);

            // The child chunks from the splitter now have the correct parent index.
            // We can directly construct the final payload without recalculating anything.
            const finalPayload: import('./types').IngestionJobPayload = {
              name: chunkResult.name,
              lastModified: chunkResult.lastModified,
              size: chunkResult.size,
              embeddings: new Array(chunkResult.childChunks.length).fill(undefined),
              parentChunks: chunkResult.parentChunks,
              childChunks: chunkResult.childChunks, // This is now correct
              language: 'unknown',
            };
            
            // Store the final, correct payload in the results map.
            this.embeddingResults.set(chunkResult.docId, finalPayload);

            // Create embedding tasks for the CHILD chunks from the correct payload.
            const embedTasks: Omit<ComputeTask, 'jobId'>[] = (finalPayload.childChunks || []).map((child, childIndex) => {
                if (child.parentChunkIndex === undefined || child.parentChunkIndex < 0) {
                    console.error(`[Coordinator ERROR] Child chunk ${childIndex} for ${chunkResult.docId} has an invalid parent index.`, child);
                }
                return {
                    id: `${chunkResult.docId}-embed-child-${childIndex}`,
                    priority: TaskPriority.P1_Primary,
                    payload: {
                        type: TaskType.EmbedChildChunk,
                        docId: chunkResult.docId,
                        childChunkIndex: childIndex,
                        childChunkText: child.text,
                        parentChunkIndex: child.parentChunkIndex ?? -1,
                        name: chunkResult.name,
                        lastModified: chunkResult.lastModified,
                        size: chunkResult.size,
                        totalChunks: chunkResult.childChunks.length,
                    },
                };
            });

            if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator DEBUG] Creating ${embedTasks.length} EmbedChildChunk tasks for ${chunkResult.docId}.`);
            this.addTasksToJob(jobId, embedTasks);

            // Also create an indexing task for entities and structure.
            const indexTask: Omit<ComputeTask, 'jobId'> = {
              id: `${chunkResult.docId}-index`,
              priority: TaskPriority.P1_Primary,
              payload: {
                type: TaskType.IndexDocument,
                docId: chunkResult.docId,
                parentChunks: chunkResult.parentChunks,
              },
            };
            this.addTasksToJob(jobId, [indexTask]);
            break;
          }
          case TaskType.IndexDocument: {
            const { docId, entities, structure } = result as IndexDocumentResult;
            if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Indexing for ${docId} complete.`);
            this.vectorStore.setIndexes(docId, entities, structure);
            break;
          }
          case TaskType.StreamChunk: {
            const streamResult = result as import('./types').StreamChunkResult;
            const { docId, parentChunks, childChunks, embeddings } = streamResult;

            let fileResult = this.embeddingResults.get(docId);
            if (!fileResult) {
                // Initialize if not present (this handles the first chunk)
                const taskPayload = (this.jobRegistry.get(jobId)?.tasks.find(t => t.id === taskId)?.payload as import('./types').StreamChunkPayload);
                fileResult = {
                    name: taskPayload.name,
                    lastModified: taskPayload.lastModified,
                    size: taskPayload.size,
                    embeddings: [],
                    parentChunks: [],
                    childChunks: [],
                    language: 'unknown',
                    isStreaming: true,
                };
                this.embeddingResults.set(docId, fileResult);
            }

            // Append new chunks and embeddings
            fileResult.parentChunks = [...(fileResult.parentChunks || []), ...parentChunks];
            fileResult.childChunks = [...(fileResult.childChunks || []), ...childChunks];
            fileResult.embeddings.push(...embeddings);

            if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Incremental stream chunk for ${docId}: ${parentChunks.length} parents, ${childChunks.length} children.`);
            
            // Emit special event for incremental UI updates
            this.emit('stream_chunk_added', {
                type: 'stream_chunk_added',
                docId,
                parentChunks,
                childChunks,
                embeddings,
            });
            break;
          }
          case TaskType.CompleteStream: {
            const completeResult = result as HierarchicalChunkResult;
            const docId = completeResult.docId;
            if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Stream complete for ${docId}. Unpinning worker.`);
            this.workerPins.delete(docId);

            // The worker might have returned some final chunks. Add them.
            const fileResult = this.embeddingResults.get(docId);
            if (fileResult) {
                fileResult.parentChunks = [...(fileResult.parentChunks || []), ...completeResult.parentChunks];
                fileResult.childChunks = [...(fileResult.childChunks || []), ...completeResult.childChunks];
                // Embeddings should have been sent already or if worker embeds in CompleteStream, 
                // we'd need them here. But our worker sends them in StreamChunk.
                // Wait, if CompleteStream returns chunks, they might not have embeddings yet.
                // Let's re-use the HierarchicalChunk logic to create embedding tasks if needed.
                
                if (completeResult.childChunks.length > 0) {
                     if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Stream completion returned ${completeResult.childChunks.length} additional child chunks. Creating embedding tasks.`);
                     const embedTasks: Omit<ComputeTask, 'jobId'>[] = completeResult.childChunks.map((child, i) => {
                         const childIndex = fileResult.childChunks!.length - completeResult.childChunks.length + i;
                         return {
                             id: `${docId}-embed-final-${childIndex}`,
                             priority: TaskPriority.P1_Primary,
                             payload: {
                                 type: TaskType.EmbedChildChunk,
                                 docId: docId,
                                 childChunkIndex: childIndex,
                                 childChunkText: child.text,
                                 parentChunkIndex: child.parentChunkIndex ?? -1,
                                 name: fileResult.name,
                                 lastModified: fileResult.lastModified,
                                 size: fileResult.size,
                                 totalChunks: -1, // Unknown total
                             },
                         };
                     });
                     this.addTasksToJob(jobId, embedTasks);
                }
            }
            break;
          }
        }

        this.emit('task_complete', message);

        const job = this.jobRegistry.get(jobId);
        if (job) {
          job.completedTasks++;
          const progressMessage: JobProgressMessage = {
            type: 'job_progress',
            jobId: job.id,
            jobName: job.name,
            progress: job.completedTasks,
            total: job.tasks.length,
          };
          this.emit('job_progress', progressMessage);

          job.pendingTaskIds.delete(taskId); // Remove completed task from pending set

          if (job.pendingTaskIds.size === 0) {
            if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator DEBUG] Job "${job.name}" (${job.id}) has completed (all tasks finished).`);
            
            const isTemporary = job.name.startsWith('_temp');
            
            if (job.name.startsWith('Ingestion:')) {
              const docId = job.name.replace('Ingestion: ', '');
              const fileResult = this.embeddingResults.get(docId);
              if (fileResult) {
                if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator DEBUG] Ingestion job for ${docId} complete. Emitting payload with ${fileResult.embeddings.filter(Boolean).length} embeddings and ${fileResult.chunks?.length ?? 0} chunks.`, { fileResult });
                this.emit('job_complete', { type: 'job_complete', jobId: job.id, jobName: job.name, payload: fileResult } as JobCompleteMessage);
                // Do not delete embedding results here, Summary job might need it.
              } else {
                if (this.isLoggingEnabled) console.error(`[${new Date().toISOString()}] [Coordinator ERROR] Ingestion job for ${docId} complete, but no embedding results found!`);
                // If for some reason the result isn't there, still signal completion
                this.emit('job_complete', { type: 'job_complete', jobId: job.id, jobName: job.name } as JobCompleteMessage);
              }
            } else if (job.name.startsWith('Summary:')) {
                const docId = job.name.replace('Summary: ', '');
                // The result of the 'task_complete' message for the final 'Summarize' task is the payload we need.
                const summaryPayload = message.result as SummarizeResult;
                this.summaryJobsInProgress.delete(docId);

                // Emit the token usage update
                if (summaryPayload.tokenUsage) {
                    this.emit('token_usage_update', {
                        type: 'token_usage_update',
                        usage: summaryPayload.tokenUsage,
                    });
                }

                // Emit the original completion event for other listeners
                this.emit('summary_generation_completed', {
                    type: 'summary_generation_completed',
                    docId: summaryPayload.docId,
                    summary: summaryPayload.summary,
                    tokenUsage: summaryPayload.tokenUsage, // Keep it here for listeners that need it
                });

                this.emit('job_complete', { type: 'job_complete', jobId: job.id, jobName: job.name, payload: summaryPayload } as JobCompleteMessage);
                // Now it's safe to delete the embedding result
                this.embeddingResults.delete(docId);
            } else if (job.name.startsWith('Layout:')) {
              // These job types have their own lifecycles and don't need to emit a payload.
              this.emit('job_complete', { type: 'job_complete', jobId: job.id, jobName: job.name } as JobCompleteMessage);
            } else {
              this.emit('job_complete', { type: 'job_complete', jobId: job.id, jobName: job.name } as JobCompleteMessage);
            }

            this.jobRegistry.delete(jobId);
            if (!isTemporary) {
                this.setActiveJobCount(prev => prev - 1);
            }
            if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator DEBUG] Job ${jobId} deleted from registry. Active jobs remaining: check main thread state.`);
          }
        }

        workerHandle.isIdle = true;
        workerHandle.currentTaskId = null;
        this.dispatchTasks();
        break;
      }
      case 'task_error': {
        const { jobId, taskId, error } = message;
        if (this.isLoggingEnabled) console.error(`[${new Date().toISOString()}] [Coordinator] Worker reported an error for task ${taskId}:`, error);
        
        const job = this.jobRegistry.get(jobId);
        if (job) {
            if (job.name.startsWith('Summary:')) {
                const docId = job.name.replace('Summary: ', '');
                this.summaryJobsInProgress.delete(docId);
                this.emit('summary_generation_failed', { type: 'summary_generation_failed', docId, error });
            }
            // For now, we'll count it as "completed" to avoid stalling the job forever.
            job.completedTasks++;
             if (job.completedTasks === job.tasks.length) {
                if (this.isLoggingEnabled) console.warn(`[${new Date().toISOString()}] [Coordinator] Job "${job.name}" (${job.id}) is finishing with errors.`);
                this.emit('job_complete', { type: 'job_complete', jobId: job.id, jobName: job.name } as JobCompleteMessage);
                this.jobRegistry.delete(jobId);
                this.setActiveJobCount(prev => prev - 1);
            }
        }
        workerHandle.isIdle = true;
        workerHandle.currentTaskId = null;
        this.dispatchTasks();
        break;
      }
      case 'embed_and_search': {
        const { query, topK, docId } = message;
        // This is a multi-step process that involves both ML and GP workers.
        // 1. Create a temporary job to embed the query.
        const embedTask: Omit<ComputeTask, 'jobId'> = {
            id: `embed-query-for-summary-${Date.now()}`,
            priority: TaskPriority.P1_Primary,
            payload: {
                type: TaskType.EmbedQuery,
                query,
            },
        };
        const tempJobId = this.addJob(`_temp_embed_for_search_${Date.now()}`, [embedTask], true);
        
        // 2. Listen for the completion of this specific task.
        const taskCompletionListener = (completionMessage: WorkerToCoordinatorMessage) => {
            if (completionMessage.type === 'task_complete' && completionMessage.jobId === tempJobId) {
                const queryEmbedding = completionMessage.result as number[];
                if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator DEBUG] Got query embedding for ${docId}. Searching vector store...`);
                const searchResults = this.vectorStore.search(queryEmbedding, topK, docId);
                if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator DEBUG] Search for ${docId} completed. Found ${searchResults.length} results. Sending back to worker ${workerHandle.id}.`, { searchResults });
                workerHandle.worker.postMessage({ type: 'search_result', results: searchResults });
                this.off('task_complete', taskCompletionListener); // Clean up listener
            }
        };
        this.on('task_complete', taskCompletionListener);
        break;
      }
    }
  }

  public addJob(name: string, tasks: Omit<ComputeTask, 'jobId'>[], isTemporary = false): string {
    const jobId = `job-${this.nextJobId++}`;
    
    if (!isTemporary) {
        this.setActiveJobCount(prev => prev + 1);
    }

    const tasksWithJobId: ComputeTask[] = tasks.map(task => ({
      ...task,
      jobId: jobId,
    }));

    const job: Job = {
      id: jobId,
      name,
      tasks: tasksWithJobId,
      completedTasks: 0,
      pendingTaskIds: new Set(tasksWithJobId.map(t => t.id)),
    };
    this.jobRegistry.set(jobId, job);

    if (name.startsWith('Summary:')) {
        const docId = name.replace('Summary: ', '');
        this.summaryJobsInProgress.add(docId);
        this.emit('summary_generation_started', { type: 'summary_generation_started', docId });
    }

    if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator DEBUG] Added job "${name}" (${jobId}) with ${tasks.length} tasks.`);

    // Route tasks to the correct queue
    this.routeTasks(tasksWithJobId);

    this.dispatchTasks();
    return jobId;
  }

  public addTasksToJob(jobId: string, tasks: Omit<ComputeTask, 'jobId'>[]): void {
    const job = this.jobRegistry.get(jobId);
    if (!job) {
      if (this.isLoggingEnabled) console.error(`[Coordinator] Cannot add tasks to non-existent job ${jobId}`);
      return;
    }

    const tasksWithJobId: ComputeTask[] = tasks.map(task => ({
      ...task,
      jobId: jobId,
    }));

    job.tasks.push(...tasksWithJobId);
    tasksWithJobId.forEach(t => job.pendingTaskIds.add(t.id));

    if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator DEBUG] Added ${tasks.length} tasks to job "${job.name}" (${jobId}). Total tasks now: ${job.tasks.length}.`);

    // Route new tasks to the correct queue
    this.routeTasks(tasksWithJobId);
    this.dispatchTasks();
  }

  private routeTasks(tasks: ComputeTask[]) {
      tasks.forEach(task => {
        if (task.payload.type === TaskType.CalculateLayout || 
            task.payload.type === TaskType.GenerateSummaryQuery || 
            task.payload.type === TaskType.Summarize || 
            task.payload.type === TaskType.DetectLanguage || 
            task.payload.type === TaskType.ExecuteRAGForSummary ||
            task.payload.type === TaskType.IndexDocument) {
          this.gpTaskQueue.push(task);
        } else {
          this.mlTaskQueue.push(task);
        }
      });
      // Re-sort queues by priority
      this.gpTaskQueue.sort((a, b) => a.priority - b.priority);
      this.mlTaskQueue.sort((a, b) => a.priority - b.priority);
  }

  public getJobs(): Job[] {
    return Array.from(this.jobRegistry.values());
  }

  public isSummaryInProgress(docId: string): boolean {
    return this.summaryJobsInProgress.has(docId);
  }

  public getPendingTaskCount(jobId: string): number {
    const job = this.jobRegistry.get(jobId);
    return job ? job.pendingTaskIds.size : 0;
  }

  public getVectorStore(): VectorStore {
    return this.vectorStore;
  }

  public getLayout(docId: string): ParagraphLayout[] | undefined {
    return this.layoutCache.get(docId);
  }

  public prewarmEmbeddingResults(docId: string, name: string, lastModified: number, size: number, totalChunks: number) {
    if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Pre-warming embedding cache for ${docId} with ${totalChunks} chunks.`);
    this.embeddingResults.set(docId, {
      name,
      lastModified,
      size,
      embeddings: [], // Initialize as empty, can grow
      language: 'unknown',
      // Chunks are not available in the non-semantic path, so this is undefined
    });
  }

  public getWorkerCount(): { ml: number, gp: number, total: number } {
    return {
      ml: this.mlWorkerPool.length,
      gp: this.gpWorkerPool.length,
      total: this.mlWorkerPool.length + this.gpWorkerPool.length,
    };
  }

  public setLogging(enabled: boolean): void {
    this.isLoggingEnabled = enabled;
    if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Setting logging for all workers to: ${enabled}`);
    const message = { type: 'set_logging', enabled };
    this.mlWorkerPool.forEach(w => w.worker.postMessage(message));
    this.gpWorkerPool.forEach(w => w.worker.postMessage(message));
  }

  public async setMlWorkerCount(newCount: number) {
    if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Adjusting ML worker count from ${this.mlWorkerPool.length} to ${newCount}`);
    const currentCount = this.mlWorkerPool.length;

    if (newCount > currentCount) {
      // Add workers
      for (let i = 0; i < newCount - currentCount; i++) {
        this.addMlWorker();
      }
    } else if (newCount < currentCount) {
      // Remove workers
      const workersToRemove = this.mlWorkerPool.slice(newCount);
      this.mlWorkerPool.splice(newCount); // Immediately remove them from the pool

      for (const workerHandle of workersToRemove) {
        if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Terminating worker ${workerHandle.id}`);
        workerHandle.worker.terminate();
        this.workerDeviceStatuses.delete(workerHandle.id);
        // If the worker was in the initialization queue, remove it
        const initQueueIndex = this.mlWorkersToInitialize.indexOf(workerHandle.id);
        if (initQueueIndex > -1) {
          this.mlWorkersToInitialize.splice(initQueueIndex, 1);
        }
      }
    }
    this.updateAndEmitSystemStatus();
  }

  private addMlWorker() {
    const workerId = `ml-worker-${this.nextMlWorkerIndex++}`;
    if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Creating new ML worker: ${workerId}`);

    const worker = new Worker(new URL('./ml.worker.ts', import.meta.url), { type: 'module', name: workerId });
    const handle: WorkerHandle = { worker, id: workerId, isIdle: false, isInitialized: false, currentTaskId: null };

    this.mlWorkerPool.push(handle);
    this.workerDeviceStatuses.set(workerId, 'unknown');
    worker.onmessage = (event: MessageEvent<WorkerToCoordinatorMessage>) => this.handleWorkerMessage(handle, event.data);

    // Add to the initialization queue.
    // If the queue was empty, it means all previous workers were already initialized,
    // so we can kick off initialization for this new one immediately.
    const shouldStartInitialization = this.mlWorkersToInitialize.length === 0;
    this.mlWorkersToInitialize.push(workerId);
    if (shouldStartInitialization) {
      if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Sending initialization command to ${workerId}.`);
      handle.worker.postMessage({ type: 'initialize_worker' });
    }
  }

  private updateAndEmitSystemStatus() {
    const statuses = Array.from(this.workerDeviceStatuses.values());
    // If any worker is on GPU, the system status is GPU.
    // Otherwise, if all are CPU, it's CPU.
    // Otherwise, it's unknown.
    const overallStatus: ComputeDevice = statuses.includes('gpu')
      ? 'gpu'
      : statuses.every(s => s === 'cpu')
      ? 'cpu'
      : 'unknown';
    
    this.emit('system_compute_status', {
      type: 'system_compute_status',
      device: overallStatus,
      mlWorkerCount: this.mlWorkerPool.length,
    });
  }

  public prioritizeLayoutForDoc(docId: string) {
    if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Prioritizing layout for doc: ${docId}`);
    // Prioritization only affects the GP queue
    const taskIndex = this.gpTaskQueue.findIndex(t =>
      t.payload.type === TaskType.CalculateLayout && t.payload.docId === docId
    );

    if (taskIndex !== -1) {
      const task = this.gpTaskQueue[taskIndex];
      if (task.priority !== TaskPriority.P0_UserView) {
        if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Found layout task for ${docId} and elevating its priority to P0.`);
        task.priority = TaskPriority.P0_UserView;
        // Re-sort the queue to move the P0 task to the front
        this.gpTaskQueue.sort((a, b) => a.priority - b.priority);
        // Immediately try to dispatch this high-priority task
        this.dispatchTasks();
      }
    } else {
      if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Could not find a pending layout task for ${docId}. It might be already completed or in progress.`);
    }
  }

  private dispatchTasks() {
    this.dispatchMlTasks();
    this.dispatchGpTasks();
  }

  private dispatchMlTasks() {
    // Only use workers that are fully initialized and idle
    const availableWorkers = this.mlWorkerPool.filter(w => w.isInitialized && w.isIdle);
    if (availableWorkers.length === 0 || this.mlTaskQueue.length === 0) {
      return;
    }

    if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Dispatching ML... Queue: ${this.mlTaskQueue.length}, Available ML Workers: ${availableWorkers.length}/${this.mlWorkerPool.length}`);

    // Track which workers we've already assigned a task in this loop
    const assignedWorkerIds = new Set<string>();

    // Process tasks in order
    let i = 0;
    while (i < this.mlTaskQueue.length && assignedWorkerIds.size < availableWorkers.length) {
      const task = this.mlTaskQueue[i];
      // Safely extract docId if it exists in the payload
      const docId = 'docId' in task.payload ? (task.payload as { docId: string }).docId : null;
      const pinnedWorkerId = docId ? this.workerPins.get(docId) : null;
      
      let targetWorkerHandle: WorkerHandle | undefined;
      
      if (pinnedWorkerId) {
        // If this task is pinned, find that specific worker if it's available
        targetWorkerHandle = availableWorkers.find(w => w.id === pinnedWorkerId && !assignedWorkerIds.has(w.id));
      } else {
        // Otherwise, find the first available worker that isn't already assigned in this loop
        targetWorkerHandle = availableWorkers.find(w => !assignedWorkerIds.has(w.id));
        
        // If it's a streaming task, pin it for the future
        if (targetWorkerHandle && docId && (task.payload.type === TaskType.StreamChunk || task.payload.type === TaskType.CompleteStream)) {
            if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Pinning ${docId} to ${targetWorkerHandle.id}.`);
            this.workerPins.set(docId, targetWorkerHandle.id);
        }
      }

      if (targetWorkerHandle) {
        // Remove task from queue
        this.mlTaskQueue.splice(i, 1);
        if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator DEBUG] Assigning ML task ${task.id} (Job: ${task.jobId}) to ${targetWorkerHandle.id}.`);
        targetWorkerHandle.isIdle = false;
        targetWorkerHandle.currentTaskId = task.id;
        targetWorkerHandle.worker.postMessage({ type: 'start_task', task });
        assignedWorkerIds.add(targetWorkerHandle.id);
        // Don't increment 'i' because we just removed an element
      } else {
        // This task can't be assigned right now (either pinned worker is busy or no workers left), try next task
        i++;
      }
    }
  }

  private dispatchGpTasks() {
    // GP workers are initialized at startup, so we only need to check for idle status.
    const availableGpWorkers = this.gpWorkerPool.filter(w => w.isIdle);

    if (availableGpWorkers.length === 0 || this.gpTaskQueue.length === 0) {
      return;
    }
    
    if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Dispatching GP... Queue: ${this.gpTaskQueue.length}, Idle GP Workers: ${availableGpWorkers.length}/${this.gpWorkerPool.length}`);

    // P0 tasks get absolute priority and can use any idle worker, including the reserved one.
    const p0TaskIndex = this.gpTaskQueue.findIndex(t => t.priority === TaskPriority.P0_UserView);
    if (p0TaskIndex !== -1) {
      const task = this.gpTaskQueue.splice(p0TaskIndex, 1)[0];
      const workerHandle = availableGpWorkers.pop()!;
      
      if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] EMERGENCY DISPATCH: Assigning P0 task ${task.id} to a GP worker.`);
      workerHandle.isIdle = false;
      workerHandle.currentTaskId = task.id;
      workerHandle.worker.postMessage({ type: 'start_task', task });
      
      // After dispatching a P0, we immediately try to dispatch more tasks
      this.dispatchGpTasks(); // Recurse to handle other tasks
      return;
    }

    // Standard dispatch logic with worker reservation
    const workersToUseCount = Math.max(0, availableGpWorkers.length - 1);
    const workersToDispatch = availableGpWorkers.slice(0, workersToUseCount);

    if (workersToDispatch.length > 0) {
        if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Standard GP dispatch. Reserving 1 worker, attempting to use ${workersToDispatch.length}.`);
        for (const workerHandle of workersToDispatch) {
            if (this.gpTaskQueue.length === 0) break;
            const task = this.gpTaskQueue.shift()!;
            if (this.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Coordinator] Assigning GP task ${task.id} to ${workerHandle.id}.`);
            workerHandle.isIdle = false;
            workerHandle.currentTaskId = task.id;
            workerHandle.worker.postMessage({ type: 'start_task', task });
        }
    }
  }
}