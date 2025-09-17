import { useState, useEffect, useRef } from 'react';
import { AppSettings } from '../config';
import { ComputeCoordinator } from '../compute/coordinator';
import { TaskCompleteMessage, JobCompleteMessage, JobProgressMessage, SystemComputeStatusMessage, TaskType, EmbedQueryResult, RerankResult } from '../compute/types';
import { chunkDocument, VectorStore } from '../rag/pipeline';
import { AppFile, JobProgress, JobTimer, SearchResult } from '../types';
import { embeddingCache } from '../cache/embeddingCache';
import { summaryCache } from '../cache/summaryCache';

import { createFileTasks } from '../utils/taskFactory';
import { Model, Provider } from '../types';

interface UseComputeProps {
    appSettings: AppSettings;
    files: AppFile[];
    setFiles: React.Dispatch<React.SetStateAction<AppFile[]>>;
    selectedModel: Model;
    selectedProvider: Provider;
    apiKeys: Record<string, string>;
    docFontSize: number;
}

export const useCompute = ({ appSettings, files, setFiles, selectedModel, selectedProvider, apiKeys, docFontSize }: UseComputeProps) => {
    const coordinator = useRef<ComputeCoordinator | null>(null);
    const vectorStore = useRef<VectorStore | null>(null);
    const queryEmbeddingResolver = useRef<((value: number[]) => void) | null>(null);
    const rerankPromiseResolver = useRef<{ resolve: (results: SearchResult[]) => void; jobId: string; taskResults: SearchResult[] } | null>(null);
    const [jobProgress, setJobProgress] = useState<Record<string, JobProgress>>({});
    const [rerankProgress, setRerankProgress] = useState<JobProgress | null>(null);
    const [jobTimers, setJobTimers] = useState<Record<string, JobTimer>>({});
    const [computeDevice, setComputeDevice] = useState<'gpu' | 'cpu' | 'unknown'>('unknown');
    const [mlWorkerCount, setMlWorkerCount] = useState(appSettings.numMlWorkers);
    const [activeJobCount, setActiveJobCount] = useState(0);
    const [totalEmbeddingsCount, setTotalEmbeddingsCount] = useState(0);

    useEffect(() => {
        if (!vectorStore.current) {
            vectorStore.current = new VectorStore();
        }
        if (!coordinator.current) {
            coordinator.current = new ComputeCoordinator(appSettings, navigator.hardwareConcurrency || 4, setActiveJobCount, vectorStore.current);
        }

        const handleTaskComplete = (message: TaskCompleteMessage) => {
            const now = new Date().toISOString();
            switch (message.taskType) {
                case TaskType.DetectLanguage: {
                    const result = message.result as import('../compute/types').DetectLanguageResult;
                    if (appSettings.isLoggingEnabled) console.log(`[${now}] [useCompute] Received DetectLanguage result:`, { result });
                    setFiles((prev: AppFile[]) => {
                        const newFiles = prev.map((f: AppFile) => f.id === result.docId ? { ...f, language: result.language } : f);
                        if (appSettings.isLoggingEnabled) console.log(`[${now}] [useCompute] Updated files state with language:`, { newFiles });
                        return newFiles;
                    });
                    break;
                }
                case TaskType.EmbedDocumentChunk: {
                    // This is now handled in job_complete to avoid race conditions.
                    break;
                }
                case TaskType.EmbedQuery: {
                    if (queryEmbeddingResolver.current) {
                        queryEmbeddingResolver.current(message.result as EmbedQueryResult);
                        queryEmbeddingResolver.current = null;
                    }
                    break;
                }
                case TaskType.Rerank: {
                    if (rerankPromiseResolver.current && message.jobId === rerankPromiseResolver.current.jobId) {
                        if (appSettings.isLoggingEnabled) console.log(`[${now}] [App DEBUG] Rerank task complete for job ${message.jobId}. Received ${ (message.result as RerankResult).length} results.`);
                        rerankPromiseResolver.current.taskResults = rerankPromiseResolver.current.taskResults.concat(message.result as RerankResult);
                    }
                    break;
                }
            }
        };

        const handleJobComplete = async (message: JobCompleteMessage) => {
            const now = new Date().toISOString();
            if (appSettings.isLoggingEnabled) console.log(`[${now}] [App] Received job_complete event for job: ${message.jobName} (${message.jobId})`);

            if (message.jobName.startsWith('Ingestion:') && message.payload) {
                const fileResult = message.payload as import('../compute/types').IngestionJobPayload;
                const docPath = message.jobName.replace('Ingestion: ', '');
                const finalEmbeddings = fileResult.embeddings.filter(e => e !== undefined) as number[][];
                if (appSettings.isLoggingEnabled) console.log(`[${now}] [useCompute DEBUG] Handling 'Ingestion' job completion for ${docPath}. Received ${finalEmbeddings.length} embeddings. Payload has chunks: ${!!fileResult.chunks}`, { fileResult });

                if (appSettings.isLoggingEnabled) console.log(`[${now}] [useCompute DIAGNOSTIC] Attempting to find file with ID: ${docPath}`);
                const file = files.find((f: AppFile) => f.id === docPath);
                if (!file) {
                    console.error(`[${now}] [useCompute ERROR] Could not find file ${docPath} after ingestion job completion. This means the file was not correctly added to the 'files' state or its ID changed.`);
                    return;
                }

                // If parentChunks and childChunks exist, we are on the new hierarchical path.
                if (fileResult.parentChunks && fileResult.childChunks) {
                    const { parentChunks, childChunks } = fileResult;
                    if (childChunks.length !== finalEmbeddings.length) {
                        console.error(`[useCompute ERROR] Mismatch for ${docPath}. Child Chunks: ${childChunks.length}, Embeddings: ${finalEmbeddings.length}.`);
                    } else {
                        // FINAL DIAGNOSTIC: Check for parent chunk array corruption before adding to store.
                        if (appSettings.isLoggingEnabled && parentChunks.length > 2) {
                            const first = parentChunks[0].start;
                            const middle = parentChunks[Math.floor(parentChunks.length / 2)].start;
                            const last = parentChunks[parentChunks.length - 1].start;
                            console.log(`[useCompute DIAGNOSTIC] Checking parent chunk integrity. First start: ${first}, Middle start: ${middle}, Last start: ${last}. Are they the same? ${first === middle && middle === last}`);
                        }

                        vectorStore.current?.addParentChunks(docPath, parentChunks);
                        for (let i = 0; i < childChunks.length; i++) {
                            const child = childChunks[i];
                            vectorStore.current?.addChildChunkEmbedding(docPath, finalEmbeddings[i], {
                                ...child,
                                parentChunkIndex: child.parentChunkIndex ?? -1, // Ensure parentChunkIndex is a number
                            });
                        }
                        if (appSettings.isLoggingEnabled) console.log(`[${now}] [useCompute] Populated vector store for ${docPath} with ${parentChunks.length} parent and ${childChunks.length} child chunks.`);
                        setTotalEmbeddingsCount(vectorStore.current?.getEmbeddingCount() || 0);
                    }
                } else {
                    // Otherwise, we are on the legacy path.
                    const chunks = fileResult.chunks ?? await chunkDocument(file.content);
                    if (chunks.length !== finalEmbeddings.length) {
                        console.error(`[useCompute ERROR] Mismatch for ${docPath}. Chunks: ${chunks.length}, Embeddings: ${finalEmbeddings.length}.`);
                    } else {
                        for (let i = 0; i < chunks.length; i++) {
                            vectorStore.current?.addChunkEmbedding(chunks[i], docPath, finalEmbeddings[i]);
                        }
                        if (appSettings.isLoggingEnabled) console.log(`[${now}] [useCompute] Populated vector store for ${docPath} with ${chunks.length} legacy chunks.`);
                        setTotalEmbeddingsCount(vectorStore.current?.getEmbeddingCount() || 0);
                    }
                }

                // Save to cache, now including the hierarchical chunk structure
                embeddingCache.set({
                    id: docPath, // docPath is actually the file.id
                    path: file.path, // Use the actual file path from the found file
                    name: fileResult.name,
                    lastModified: fileResult.lastModified,
                    size: fileResult.size,
                    embedding: finalEmbeddings,
                    language: file.language || 'unknown',
                    parentChunks: fileResult.parentChunks,
                    childChunks: fileResult.childChunks,
                });
                if (appSettings.isLoggingEnabled) console.log(`[${now}] [useCompute] Saved all embeddings for ${docPath} to cache.`);

                // Trigger Summary job if needed. Layout is already part of the ingestion job.
                if (coordinator.current && file && file.summaryStatus === 'missing') {
                    if (appSettings.isLoggingEnabled) console.log(`[${now}] [useCompute] Triggering Summary job for ${docPath}.`);
                    setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === docPath ? { ...f, summaryStatus: 'in_progress' } : f));
                    const summaryTasks = await createFileTasks(file, 'summary', coordinator.current, docFontSize, selectedModel, selectedProvider, apiKeys, appSettings);
                    coordinator.current.addJob(`Summary: ${docPath}`, summaryTasks);
                }
            }
            
            if (message.jobName.startsWith('Summary:')) {
                const docIdFromJob = message.jobName.replace('Summary: ', '');
                const result = message.payload as { summary: string };
                // Defensive check: Only process if the job was successful and has a payload
                if (result && result.summary) {
                    if (appSettings.isLoggingEnabled) console.log(`[${now}] [useCompute DIAGNOSTIC] Attempting to find file for summary with ID: ${docIdFromJob}`);
                    const file = files.find((f: AppFile) => f.id === docIdFromJob);
                    if (file) {
                        if (appSettings.isLoggingEnabled) console.log(`[${now}] [useCompute DIAGNOSTIC] Found file for summary: ${file.id}. Saving summary to cache.`);
                        await summaryCache.set(file.id, result.summary, file.lastModified);
                        setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === file.id ? { ...f, summaryStatus: 'available' } : f));
                    } else {
                        console.error(`[${now}] [useCompute ERROR] Could not find file ${docIdFromJob} for summary after job completion. Summary not cached.`);
                        setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === docIdFromJob ? { ...f, summaryStatus: 'missing' } : f));
                    }
                } else {
                    // This case might be hit if the summary job fails.
                    setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === docIdFromJob ? { ...f, summaryStatus: 'missing' } : f));
                }
            }

            if (rerankPromiseResolver.current && message.jobId === rerankPromiseResolver.current.jobId) {
                if (appSettings.isLoggingEnabled) console.log(`[${now}] [App DEBUG] Rerank job ${message.jobId} complete. Resolving promise.`);
                const sortedResults = rerankPromiseResolver.current.taskResults.sort((a, b) => b.similarity - a.similarity);
                rerankPromiseResolver.current.resolve(sortedResults);
                rerankPromiseResolver.current = null;
                setRerankProgress(null);
                return;
            }

            if (message.jobName.startsWith('Rerank Query')) {
                setRerankProgress(null);
            } else {
                setJobProgress(prev => {
                    const newProgress = { ...prev };
                    const job = newProgress[message.jobName];
                    const total = job ? job.total : 1;
                    newProgress[message.jobName] = { progress: total, total: total };
                    return newProgress;
                });
                setJobTimers(prev => ({
                    ...prev,
                    [message.jobName]: { ...prev[message.jobName], isActive: false }
                }));
            }
        };

        const handleJobProgress = (message: JobProgressMessage) => {
            // const now = new Date().toISOString();
            // if (appSettings.isLoggingEnabled) console.log(`[${now}] [App] Job Progress for ${message.jobName}: ${message.progress}/${message.total}`);
            if (message.jobName.startsWith('Rerank Query')) {
                setRerankProgress({ progress: message.progress, total: message.total });
            } else {
                setJobProgress(prev => ({
                    ...prev,
                    [message.jobName]: { progress: message.progress, total: message.total }
                }));
            }
        };

        const handleSystemStatus = (message: SystemComputeStatusMessage) => {
            const now = new Date().toISOString();
            if (appSettings.isLoggingEnabled) console.log(`[${now}] [App] Received system_compute_status event: ${message.device}`);
            setComputeDevice(message.device);
            setMlWorkerCount(message.mlWorkerCount);
        };

        const handleSummaryStarted = (message: import('../compute/types').SummaryGenerationStartedMessage) => {
            setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === message.docId ? { ...f, summaryStatus: 'in_progress' } : f));
        };

        const handleSummaryCompleted = (message: import('../compute/types').SummaryGenerationCompletedMessage) => {
            console.log(`[useCompute] Summary completed for ${message.docId}. Setting status to 'available'.`);
            setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === message.docId ? { ...f, summaryStatus: 'available' } : f));
        };

        const handleSummaryFailed = (message: import('../compute/types').SummaryGenerationFailedMessage) => {
            console.error(`[useCompute] Summary failed for ${message.docId}:`, message.error);
            setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === message.docId ? { ...f, summaryStatus: 'missing' } : f));
        };

        const handleLayoutUpdated = (message: import('../compute/types').LayoutUpdatedMessage) => {
            if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [useCompute DIAGNOSTIC] Received 'layout_updated' event for ${message.docId}. Setting status to 'ready'.`);
            setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === message.docId ? { ...f, layoutStatus: 'ready' } : f));
        };

        if (coordinator.current) {
            coordinator.current.on('task_complete', handleTaskComplete);
            coordinator.current.on('job_complete', handleJobComplete);
            coordinator.current.on('job_progress', handleJobProgress);
            coordinator.current.on('system_compute_status', handleSystemStatus);
            coordinator.current.on('summary_generation_started', handleSummaryStarted);
            coordinator.current.on('summary_generation_completed', handleSummaryCompleted);
            coordinator.current.on('summary_generation_failed', handleSummaryFailed);
            coordinator.current.on('layout_updated', handleLayoutUpdated);
        }


        return () => {
            if (coordinator.current) {
                coordinator.current.off('task_complete', handleTaskComplete);
                coordinator.current.off('job_complete', handleJobComplete);
                coordinator.current.off('job_progress', handleJobProgress);
                coordinator.current.off('system_compute_status', handleSystemStatus);
                coordinator.current.off('summary_generation_started', handleSummaryStarted);
                coordinator.current.off('summary_generation_completed', handleSummaryCompleted);
                coordinator.current.off('summary_generation_failed', handleSummaryFailed);
                coordinator.current.off('layout_updated', handleLayoutUpdated);
            }
        };
    }, [appSettings, files, setFiles, apiKeys, docFontSize, selectedModel, selectedProvider]);

    return {
        coordinator,
        vectorStore,
        queryEmbeddingResolver,
        rerankPromiseResolver,
        jobProgress,
        setJobProgress,
        rerankProgress,
        setRerankProgress,
        jobTimers,
        setJobTimers,
        computeDevice,
        mlWorkerCount,
        activeJobCount,
        totalEmbeddingsCount,
    };
};