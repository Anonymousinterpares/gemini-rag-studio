import { useEffect, useRef } from 'react';
import { useComputeStore, useFileStore, useSettingsStore } from '../store';
import { ComputeCoordinator } from '../compute/coordinator';
import { TaskCompleteMessage, JobCompleteMessage, JobProgressMessage, SystemComputeStatusMessage, TaskType, EmbedQueryResult, RerankResult } from '../compute/types';
import { chunkDocument, VectorStore } from '../rag/pipeline';
import { AppFile, SearchResult } from '../types';
import { embeddingCache } from '../cache/embeddingCache';
import { summaryCache } from '../cache/summaryCache';
import { createFileTasks } from '../utils/taskFactory';

export const useCompute = (docFontSize: number) => {
    const { 
        setIsEmbedding, 
        setJobProgress, 
        setRerankProgress, 
        setJobTimers, 
        setComputeDevice, 
        setMlWorkerCount, 
        setActiveJobCount, 
        setTotalEmbeddingsCount 
    } = useComputeStore();
    
    const { files, setFiles } = useFileStore();
    const { appSettings, selectedModel, selectedProvider, apiKeys } = useSettingsStore();

    const coordinator = useRef<ComputeCoordinator | null>(null);
    const vectorStore = useRef<VectorStore | null>(null);
    const queryEmbeddingResolver = useRef<((value: number[]) => void) | null>(null);
    const rerankPromiseResolver = useRef<{ resolve: (results: SearchResult[]) => void; jobId: string; taskResults: SearchResult[] } | null>(null);

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
                
                const file = files.find((f: AppFile) => f.id === docPath);
                if (!file) {
                    console.error(`[${now}] [useCompute ERROR] Could not find file ${docPath} after ingestion job completion.`);
                    return;
                }

                if (fileResult.parentChunks && fileResult.childChunks) {
                    const { parentChunks, childChunks } = fileResult;
                    // For streaming, these might have been added incrementally already, 
                    // but for non-streaming (HierarchicalChunk task), they are added here.
                    if (!fileResult.isStreaming) {
                        vectorStore.current?.addParentChunks(docPath, parentChunks);
                        for (let i = 0; i < childChunks.length; i++) {
                            const child = childChunks[i];
                            vectorStore.current?.addChildChunkEmbedding(docPath, finalEmbeddings[i], {
                                ...child,
                                parentChunkIndex: child.parentChunkIndex ?? -1,
                            });
                        }
                    }
                    setTotalEmbeddingsCount(vectorStore.current?.getEmbeddingCount() || 0);
                } else {
                    const chunks = fileResult.chunks ?? (file.content ? await chunkDocument(file.content) : []);
                    for (let i = 0; i < chunks.length; i++) {
                        vectorStore.current?.addChunkEmbedding(chunks[i], docPath, finalEmbeddings[i]);
                    }
                    setTotalEmbeddingsCount(vectorStore.current?.getEmbeddingCount() || 0);
                }

                embeddingCache.set({
                    id: docPath,
                    path: file.path,
                    name: fileResult.name,
                    lastModified: fileResult.lastModified,
                    size: fileResult.size,
                    embedding: finalEmbeddings,
                    language: file.language || 'unknown',
                    parentChunks: fileResult.parentChunks,
                    childChunks: fileResult.childChunks,
                    entities: vectorStore.current?.getEntities(docPath),
                    structure: vectorStore.current?.getStructure(docPath),
                });

                if (coordinator.current && file && file.summaryStatus === 'missing') {
                    setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === docPath ? { ...f, summaryStatus: 'in_progress' } : f));
                    // For streaming files, we can use the first few parent chunks for the summary query
                    const summaryTasks = await createFileTasks(file, 'summary', coordinator.current, docFontSize, selectedModel, selectedProvider, apiKeys, appSettings);
                    coordinator.current.addJob(`Summary: ${docPath}`, summaryTasks);
                }
            }
            
            if (message.jobName.startsWith('Summary:')) {
                const docIdFromJob = message.jobName.replace('Summary: ', '');
                const result = message.payload as { summary: string };
                if (result && result.summary) {
                    const file = files.find((f: AppFile) => f.id === docIdFromJob);
                    if (file) {
                        await summaryCache.set(file.id, result.summary, file.lastModified);
                        setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === file.id ? { ...f, summaryStatus: 'available' } : f));
                    } else {
                        setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === docIdFromJob ? { ...f, summaryStatus: 'missing' } : f));
                    }
                } else {
                    setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === docIdFromJob ? { ...f, summaryStatus: 'missing' } : f));
                }
            }

            if (rerankPromiseResolver.current && message.jobId === rerankPromiseResolver.current.jobId) {
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
            setComputeDevice(message.device);
            setMlWorkerCount(message.mlWorkerCount);
        };

        const handleSummaryStarted = (message: import('../compute/types').SummaryGenerationStartedMessage) => {
            setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === message.docId ? { ...f, summaryStatus: 'in_progress' } : f));
        };

        const handleSummaryCompleted = (message: import('../compute/types').SummaryGenerationCompletedMessage) => {
            setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === message.docId ? { ...f, summaryStatus: 'available' } : f));
        };

        const handleSummaryFailed = (message: import('../compute/types').SummaryGenerationFailedMessage) => {
            setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === message.docId ? { ...f, summaryStatus: 'missing' } : f));
        };

        const handleLayoutUpdated = (message: import('../compute/types').LayoutUpdatedMessage) => {
            setFiles((prev: AppFile[]) => prev.map((f: AppFile) => f.id === message.docId ? { ...f, layoutStatus: 'ready' } : f));
        };

        const handleStreamChunkAdded = (message: import('../compute/types').StreamChunkAddedMessage) => {
            const { docId, parentChunks, childChunks, embeddings } = message;
            if (vectorStore.current) {
                vectorStore.current.addParentChunks(docId, [...(vectorStore.current.getParentChunks(docId) || []), ...parentChunks]);
                for (let i = 0; i < childChunks.length; i++) {
                    const child = childChunks[i];
                    vectorStore.current.addChildChunkEmbedding(docId, embeddings[i], {
                        ...child,
                        parentChunkIndex: child.parentChunkIndex ?? -1,
                    });
                }
                setTotalEmbeddingsCount(vectorStore.current.getEmbeddingCount());
            }
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
            coordinator.current.on('stream_chunk_added', handleStreamChunkAdded);
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
                coordinator.current.off('stream_chunk_added', handleStreamChunkAdded);
            }
        };
    }, [appSettings, files, setFiles, apiKeys, docFontSize, selectedModel, selectedProvider, setIsEmbedding, setJobProgress, setRerankProgress, setJobTimers, setComputeDevice, setMlWorkerCount, setActiveJobCount, setTotalEmbeddingsCount]);

    return {
        coordinator,
        vectorStore,
        queryEmbeddingResolver,
        rerankPromiseResolver
    };
};
