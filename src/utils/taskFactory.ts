import { AppFile, Model, Provider } from '../types';
import { ComputeCoordinator } from '../compute/coordinator';
import { ComputeTask, TaskPriority, TaskType } from '../compute/types';
import { AppSettings } from '../config';
import { chunkDocument } from '../rag/pipeline';

export const createFileTasks = async (
    file: AppFile,
    jobType: 'ingestion' | 'layout' | 'summary' | 'language-detection',
    coordinator: ComputeCoordinator,
    docFontSize: number,
    selectedModel: Model,
    selectedProvider: Provider,
    apiKeys: Record<string, string>,
    appSettings: AppSettings
): Promise<Omit<ComputeTask, 'jobId'>[]> => {
    console.log(`[DEBUG] createTaskFactory: Creating tasks for file ${file.id} with jobType "${jobType}"`);
    const tasks: Omit<ComputeTask, 'jobId'>[] = [];
    let taskIdCounter = 0;

    switch (jobType) {
        case 'ingestion': {
            console.log(`[DEBUG] createTaskFactory: Building 'ingestion' job...`);
            tasks.push({
                id: `${file.id}-detect-language-${taskIdCounter++}`,
                priority: TaskPriority.P1_Primary,
                payload: {
                    type: TaskType.DetectLanguage,
                    docId: file.id,
                    content: file.content ? file.content.slice(0, 2000) : (file.name.slice(0, 500)),
                    model: selectedModel,
                    apiKey: apiKeys[selectedProvider],
                }
            });

            if (appSettings.isSemanticChunkingEnabled) {
                console.log(`[DEBUG] createTaskFactory: Adding HierarchicalChunk task.`);
                tasks.push({
                    id: `${file.id}-hierarchical-chunk-${taskIdCounter++}`,
                    priority: TaskPriority.P1_Primary,
                    payload: {
                        type: TaskType.HierarchicalChunk,
                        docId: file.id,
                        docContent: file.content || "",
                        name: file.name,
                        lastModified: file.lastModified,
                        size: file.size,
                        chunkSize: appSettings.parentChunkSize,
                        chunkOverlap: 200,
                    }
                });
            } else if (file.content) {
                console.log(`[DEBUG] createTaskFactory: Adding legacy EmbedDocumentChunk tasks.`);
                const chunks = await chunkDocument(file.content);
                coordinator.prewarmEmbeddingResults(file.id, file.name, file.lastModified, file.size, chunks.length);
                
                tasks.push({
                    id: `${file.id}-index-${taskIdCounter++}`,
                    priority: TaskPriority.P1_Primary,
                    payload: {
                        type: TaskType.IndexDocument,
                        docId: file.id,
                        parentChunks: chunks,
                    }
                });

                chunks.forEach((chunk, index) => {
                    tasks.push({
                        id: `${file.id}-embed-${taskIdCounter++}`,
                        priority: TaskPriority.P1_Primary,
                        payload: {
                            type: TaskType.EmbedDocumentChunk,
                            docId: file.id,
                            chunkIndex: index,
                            chunkText: chunk.text,
                            name: file.name,
                            lastModified: file.lastModified,
                            size: file.size,
                            totalChunks: chunks.length,
                        }
                    });
                });
            }
            
            break;
        }
        case 'summary': {
            let firstTwoChunks = "";
            if (file.content) {
                firstTwoChunks = file.content.slice(0, 2000);
            } else {
                // For streaming files, we can try to get the first parent chunk from the vector store
                const parentChunks = coordinator.getVectorStore().getParentChunks(file.id);
                if (parentChunks && parentChunks.length > 0) {
                    firstTwoChunks = parentChunks[0].text.slice(0, 2000);
                }
            }
            
            tasks.push({
                id: `${file.id}-summarize-${taskIdCounter++}`,
                priority: TaskPriority.P2_Background,
                payload: {
                    type: TaskType.GenerateSummaryQuery,
                    docId: file.id,
                    firstTwoChunks: firstTwoChunks,
                    model: selectedModel,
                    apiKey: apiKeys[selectedProvider],
                }
            });
            break;
        }
        case 'language-detection': {
            tasks.push({
                id: `${file.id}-detect-language-${taskIdCounter++}`,
                priority: TaskPriority.P1_Primary,
                payload: {
                    type: TaskType.DetectLanguage,
                    docId: file.id,
                    content: file.content ? file.content.slice(0, 2000) : "",
                    model: selectedModel,
                    apiKey: apiKeys[selectedProvider],
                }
            });
            break;
        }
        case 'layout': {
            const modalContent = document.querySelector('.modal-content');
            const defaultWidth = modalContent?.clientWidth || 800;
            tasks.push({
                id: `${file.id}-layout-${taskIdCounter++}`,
                priority: TaskPriority.P2_Background,
                payload: {
                    type: TaskType.CalculateLayout,
                    docId: file.id,
                    docContent: file.content,
                    file: file.file,
                    containerWidth: defaultWidth - (2 * 16),
                    fontSize: docFontSize,
                    fontFamily: "'Fira Code', 'Courier New', monospace",
                }
            });
            break;
        }
    }

    return tasks;
};