import { useState, useCallback, useMemo, useEffect } from 'react';
import { marked } from 'marked';
import { franc } from 'franc-min';
import { AppFile, ChatMessage, JobProgress, Model, SearchResult, TokenUsage } from '../types';
import { summaryCache } from '../cache/summaryCache';
import { ComputeTask, TaskPriority, TaskType, RerankPayload } from '../compute/types';
import { generateContent } from '../api/llm-provider';
import { AppSettings } from '../config';
import { ComputeCoordinator } from '../compute/coordinator';
import { VectorStore } from '../rag/pipeline';

const AGENT_SYSTEM_PROMPT_TEMPLATE = `You are a helpful and expert AI assistant. Your user is a software developer.
Be concise and accurate in your answers.
You have access to a knowledge base of the user's files.
{summaries_section}
When the user asks a question, you must first decide if you have enough information in the conversation history to answer.
If you don't, you should use the information from the provided file contexts.
Each context is numbered and preceded by its file path and a unique ID, like "[1] File Path: path/to/file.js (ID: file-id-123)".
**Critically, you must cite your sources for every piece of information that comes from the documents.**
To cite a context, you MUST use the exact format [Source: uniqueId]. For example, to cite a context with ID 'file-id-123', you must write [Source: file-id-123].
**Do not include any other information, formatting, or numbering in the citation.** Just the bracketed source and the unique ID.
Use a separate citation for each piece of information. For example: "The sky is blue [Source: file-id-123]. The grass is green [Source: file-id-456]."
**Do not group sources together.** For example, do not write "The sky is blue and the grass is green [Source: file-id-123, file-id-456]".
If the answer is not in the files or the conversation history, say "I could not find an answer in the provided documents."`;

interface UseChatProps {
    appSettings: AppSettings;
    files: AppFile[];
    isLoading: boolean;
    isEmbedding: boolean;
    coordinator: React.MutableRefObject<ComputeCoordinator | null> | null;
    vectorStore: React.MutableRefObject<VectorStore | null> | null;
    queryEmbeddingResolver: React.MutableRefObject<((value: number[]) => void) | null>;
    rerankPromiseResolver: React.MutableRefObject<{ resolve: (results: SearchResult[]) => void; jobId: string; taskResults: SearchResult[] } | null>;
    setRerankProgress: React.Dispatch<React.SetStateAction<JobProgress | null>>;
    apiKeys: { [key: string]: string };
    selectedProvider: string;
    selectedModel: Model;
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
    setActiveSource: React.Dispatch<React.SetStateAction<{ file: AppFile, chunks: SearchResult[] } | null>>;
    setIsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setSelectedFile: React.Dispatch<React.SetStateAction<AppFile | null>>;
}

export const useChat = ({
    appSettings,
    files,
    isLoading,
    isEmbedding,
    coordinator,
    vectorStore,
    queryEmbeddingResolver,
    rerankPromiseResolver,
    setRerankProgress,
    apiKeys,
    selectedProvider,
    selectedModel,
    setIsLoading,
    setActiveSource,
    setIsModalOpen,
    setSelectedFile,
}: UseChatProps) => {
    const initialChatHistory = useMemo(() => ([
        {
            role: 'model' as const,
            content:
                "Hello! Drop your files or a project folder on the left to get started. I'll create a knowledge base from them, and you can ask me anything about their content.",
        },
    ]), []);

    const [chatHistory, setChatHistory] = useState<ChatMessage[]>(initialChatHistory);
    const [userInput, setUserInput] = useState('');
    const [pendingQuery, setPendingQuery] = useState<string | null>(null);
    const [tokenUsage, setTokenUsage] = useState<TokenUsage>({ promptTokens: 0, completionTokens: 0 });
    const [summaries, setSummaries] = useState<Record<string, string>>({});

    useEffect(() => {
        const loadSummaries = async () => {
            const allSummaries = await summaryCache.getAll();
            setSummaries(allSummaries);
        };
        loadSummaries();

        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'summary-cache-db') {
                loadSummaries();
            }
        };

        const handleTokenUpdate = (e: import('../compute/types').TokenUsageUpdateMessage) => {
            if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [App] Received token usage update from coordinator:`, e.usage);
            setTokenUsage((prev) => ({
                promptTokens: prev.promptTokens + e.usage.promptTokens,
                completionTokens: prev.completionTokens + e.usage.completionTokens,
            }));
        };

        const currentCoordinator = coordinator?.current;
        window.addEventListener('storage', handleStorageChange);
        currentCoordinator?.on('token_usage_update', handleTokenUpdate);

        return () => {
            window.removeEventListener('storage', handleStorageChange);
            currentCoordinator?.off('token_usage_update', handleTokenUpdate);
        }
    }, [coordinator, appSettings.isLoggingEnabled]);

    const getSystemPrompt = useCallback((relevantDocIds: string[] = []) => {
        let summariesSection = '';
        const relevantSummaries = Object.entries(summaries).filter(([id]) => relevantDocIds.includes(id));

        if (relevantSummaries.length > 0) {
            const summaryList = relevantSummaries
                .map(([id, summary]) => {
                    const file = files.find(f => f.id === id);
                    const fileName = file ? file.name : id;
                    return `File: ${fileName}\nSummary: ${summary}`;
                })
                .join('\n\n');
            summariesSection = `Here is a high-level summary of the documents relevant to your query:\n\n${summaryList}\n\n`;
        }
        const docOnly = appSettings.docOnlyMode
          ? `\n\nDOC-ONLY MODE: You must answer strictly using the provided document contexts and conversation. Do not use external or general knowledge. If the documents do not contain the answer, reply exactly: "I could not find an answer in the provided documents."\n`
          : '';
        return AGENT_SYSTEM_PROMPT_TEMPLATE.replace('{summaries_section}', summariesSection + docOnly);
    }, [summaries, files, appSettings.docOnlyMode]);

    const waitForSummaries = useCallback(async (docIds: string[]) => {
        if (!coordinator?.current) return;
        const coordinatorRef = coordinator.current;

        const idsToWaitFor = docIds.filter(id => coordinatorRef.isSummaryInProgress(id));

        if (idsToWaitFor.length === 0) {
            return;
        }

        if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [App] Waiting for summaries for:`, idsToWaitFor);

        const promises = idsToWaitFor.map(id => {
            return new Promise<void>(resolve => {
                const onSummaryCompleted = (message: import('../compute/types').SummaryGenerationCompletedMessage) => {
                    if (message.docId === id) {
                        cleanUp();
                        resolve();
                    }
                };
                const onSummaryFailed = (message: import('../compute/types').SummaryGenerationFailedMessage) => {
                    if (message.docId === id) {
                        cleanUp();
                        resolve(); // Resolve even on failure to not block forever
                    }
                };
                const cleanUp = () => {
                    coordinatorRef.off('summary_generation_completed', onSummaryCompleted);
                    coordinatorRef.off('summary_generation_failed', onSummaryFailed);
                };

                coordinatorRef.on('summary_generation_completed', onSummaryCompleted);
                coordinatorRef.on('summary_generation_failed', onSummaryFailed);
            });
        });

        await Promise.all(promises);
        if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [App] All required summaries are now available.`);

    }, [coordinator, appSettings.isLoggingEnabled]);

    const submitQuery = useCallback(async (query: string, history: ChatMessage[]) => {
        if (!query.trim() || isLoading || !coordinator?.current || !vectorStore?.current) return;

        const startTime = Date.now();
        const perRequestTokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0 };

        const newHistoryWithUser: ChatMessage[] = [
            ...history,
            { role: 'user', content: query },
        ];
        setChatHistory(newHistoryWithUser);
        setIsLoading(true);

        const callGenerateContent = async (model: Model, apiKey: string, messages: ChatMessage[]): Promise<import('../api/llm-provider').LlmResponse> => {
            const response = await generateContent(model, apiKey, messages);
            perRequestTokenUsage.promptTokens += response.usage.promptTokens;
            perRequestTokenUsage.completionTokens += response.usage.completionTokens;
            return response;
        };

        try {
            const apiKey = apiKeys[selectedProvider];
            // Router Agent: Decide if RAG is needed
            const routerPrompt = `You are a router agent. Your purpose is to classify the user's query.
Based on the query and the conversation history, decide if the query can be answered with general conversation, or if it requires a search of the knowledge base.
Respond with only one of two words: "GENERAL_CONVERSATION" or "KNOWLEDGE_SEARCH".

Conversation History:
${history.map(m => `${m.role}: ${m.content}`).join('\n')}

User Query: "${query}"`;

            // Doc-first pre-retrieval gate
            let forcedDocSearch = false;
            if (appSettings.docOnlyMode && vectorStore?.current) {
                try {
                    const preEmbedPromise = new Promise<number[]>((resolve) => { if (queryEmbeddingResolver) queryEmbeddingResolver.current = resolve; });
                    if (coordinator.current) {
                        coordinator.current.addJob('Embed Query (Doc-first precheck)', [{
                            id: `precheck-${Date.now()}`,
                            priority: TaskPriority.P1_Primary,
                            payload: { type: TaskType.EmbedQuery, query }
                        }]);
                    }
                    const preEmbedding = await preEmbedPromise;
                    const preCandidates = vectorStore.current.search(preEmbedding, 5) ?? [];
                    forcedDocSearch = preCandidates.length > 0;
                    if (appSettings.isLoggingEnabled) console.log(`[Doc-first] Pre-retrieval hits: ${preCandidates.length}. ForcedDocSearch=${forcedDocSearch}`);
                } catch (e) {
                    console.warn('[Doc-first] Pre-retrieval check failed, continuing with router.', e);
                }
            }

            const routerMessages: ChatMessage[] = [{ role: 'user', content: routerPrompt }];
            const routerResponse = await callGenerateContent(selectedModel, apiKey, routerMessages);
            let decision = routerResponse.text.trim().toUpperCase();
            if (forcedDocSearch) decision = 'KNOWLEDGE_SEARCH';
            if (appSettings.enableRouterV2) {
                try {
                    const { decideRouteV2 } = await import('../agents/router_v2');
                    const embedQueryFn = async (q: string) => {
                        const p = new Promise<number[]>((resolve) => { if (queryEmbeddingResolver) queryEmbeddingResolver.current = resolve; });
                        if (coordinator.current) {
                            coordinator.current.addJob('Embed Query (RouterV2)', [{ id: `router-v2-${Date.now()}`, priority: TaskPriority.P1_Primary, payload: { type: TaskType.EmbedQuery, query: q } }]);
                        }
                        return await p;
                    };
                    const route = await decideRouteV2({
                        query,
                        history,
                        filesLoaded: files.length > 0,
                        vectorStore: vectorStore.current!,
                        model: selectedModel,
                        apiKey,
                        settings: appSettings,
                        embedQuery: embedQueryFn,
                    });
                    decision = route.mode === 'CHAT' ? 'GENERAL_CONVERSATION' : 'KNOWLEDGE_SEARCH';
                    if (appSettings.isLoggingEnabled) console.log('[RouterV2]', route);
                    // If deep analysis selected, run it now and return
                    if (route.mode.startsWith('DEEP_ANALYSIS') && appSettings.enableDeepAnalysisV1) {
                        const { runDeepAnalysis } = await import('../agents/deep_analysis');
                        const level = appSettings.deepAnalysisLevel === 3 || route.mode === 'DEEP_ANALYSIS_L3' ? 3 : 2;
                        const da = await runDeepAnalysis({
                            query,
                            history: newHistoryWithUser,
                            vectorStore: vectorStore.current!,
                            model: selectedModel,
                            apiKey,
                            settings: appSettings,
                            embedQuery: embedQueryFn,
                            // Rerank per section using the existing ML reranker if enabled
                            rerank: appSettings.isRerankingEnabled ? async (rerankQuery, docs) => {
                                const tasks: Omit<ComputeTask, 'jobId'>[] = [];
                                const docsPerBatch = Math.max(1, Math.ceil(docs.length / Math.max(1, appSettings.numMlWorkers)));
                                for (let i = 0; i < docs.length; i += docsPerBatch) {
                                    const batch = docs.slice(i, i + docsPerBatch).map(d => ({ chunk: d.chunk, id: d.id, start: d.start, end: d.end }));
                                    const payload: RerankPayload = { type: TaskType.Rerank, query: rerankQuery, documents: batch };
                                    tasks.push({ id: `da-rerank-${i}-${Date.now()}`, priority: TaskPriority.P1_Primary, payload });
                                }
                                const rerankPromise = new Promise<SearchResult[]>((resolve) => {
                                    if (rerankPromiseResolver) rerankPromiseResolver.current = { resolve, jobId: '', taskResults: [] };
                                });
                                if (coordinator.current) {
                                    const jobId = coordinator.current.addJob(`Rerank (DA): ${rerankQuery.slice(0, 24)}...`, tasks);
                                    if (rerankPromiseResolver?.current) rerankPromiseResolver.current.jobId = jobId;
                                }
                                const results = await rerankPromise;
                                return results;
                            } : undefined,
                            level,
                        });
                        const elapsedTime = Date.now() - startTime;
                        const daUsage = (da as { llmTokens?: TokenUsage }).llmTokens || { promptTokens: 0, completionTokens: 0 };
                        const messageUsage: TokenUsage = {
                            promptTokens: perRequestTokenUsage.promptTokens + daUsage.promptTokens,
                            completionTokens: perRequestTokenUsage.completionTokens + daUsage.completionTokens,
                        };
                        setTokenUsage((prev: TokenUsage) => ({
                            promptTokens: prev.promptTokens + messageUsage.promptTokens,
                            completionTokens: prev.completionTokens + messageUsage.completionTokens,
                        }));
                        setChatHistory([
                            ...newHistoryWithUser,
                            {
                                role: 'model',
                                content: `${da.finalText}<!--searchResults:${JSON.stringify(da.usedResults)}-->`,
                                tokenUsage: messageUsage,
                                elapsedTime,
                            },
                        ]);
                        setIsLoading(false);
                        return;
                    }
                } catch (e) {
                    console.warn('[RouterV2] Failed; falling back to legacy router path.', e);
                }
            }

            if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Router Agent] Decision: ${decision}`);

            if (appSettings.docOnlyMode && decision === 'GENERAL_CONVERSATION') {
                const elapsedTime = Date.now() - startTime;
                setChatHistory([...newHistoryWithUser, { role: 'model', content: 'I could not find an answer in the provided documents.', tokenUsage: perRequestTokenUsage, elapsedTime }]);
                setIsLoading(false);
                return;
            }

            if (decision === 'GENERAL_CONVERSATION') {
                const messages: ChatMessage[] = [
                    { role: 'system', content: getSystemPrompt() },
                    ...newHistoryWithUser,
                ];
                const llmResponse = await callGenerateContent(selectedModel, apiKey, messages);
                const elapsedTime = Date.now() - startTime;
                setTokenUsage((prev: TokenUsage) => ({
                    promptTokens: prev.promptTokens + perRequestTokenUsage.promptTokens,
                    completionTokens: prev.completionTokens + perRequestTokenUsage.completionTokens,
                }));
                setChatHistory([...newHistoryWithUser, { role: 'model', content: llmResponse.text, tokenUsage: perRequestTokenUsage, elapsedTime }]);
                setIsLoading(false);
                return;
            }

            // Proceed with RAG pipeline if SEARCH is decided
            const now = new Date().toISOString();
            if (appSettings.isLoggingEnabled) console.log(`[${now}] [App] Starting search process for query: "${query}"`);

            // Pre-process query
            let currentQuery = query;

            // Step 1: Language Translation (existing functionality)
            const targetFile = files[0]; // Assuming single file context for now
            const queryLang = franc(currentQuery);
            const documentLanguage = targetFile.language;
            if (documentLanguage !== 'unknown' && documentLanguage !== queryLang) {
                const translationPrompt = `The user's query is in ${queryLang} and it is: "${currentQuery}". The document is in ${documentLanguage}.
Translate the user's query to ${documentLanguage} for a more effective search.
Return only the translated query.`;
                const translationMessages: ChatMessage[] = [{ role: 'user', content: translationPrompt }];
                const translationResponse = await callGenerateContent(selectedModel, apiKey, translationMessages);
                currentQuery = translationResponse.text.trim();
                if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [App] Query translated to: "${currentQuery}"`);
            }

            // Step 2: Light Query Transformation (new functionality)
            if (appSettings.isLightQueryTransformationEnabled && !appSettings.isDeepAnalysisEnabled) {
                const transformationPrompt = `Given the user's query: "${currentQuery}", rephrase it to be more effective for a semantic search against a knowledge base. Focus on extracting key entities and concepts. Return only the rephrased query.`;
                const transformationMessages: ChatMessage[] = [{ role: 'user', content: transformationPrompt }];
                const transformationResponse = await callGenerateContent(selectedModel, apiKey, transformationMessages);
                currentQuery = transformationResponse.text.trim();
                if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [App] Light Query Transformed to: "${currentQuery}"`);
            }

            if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [App] Final query for embedding: "${currentQuery}"`);

            let queries = [currentQuery];

            if (appSettings.isDeepAnalysisEnabled) {
                // Step 1: Perform a preliminary search to find relevant documents for context
                const preliminaryEmbeddingPromise = new Promise<number[]>((resolve) => {
                    if (queryEmbeddingResolver) queryEmbeddingResolver.current = resolve;
                });
                if (coordinator.current) {
                    coordinator.current.addJob('Embed Query for Sub-questions', [{
                        id: `prelim-query-${Date.now()}`,
                        priority: TaskPriority.P1_Primary,
                        payload: { type: TaskType.EmbedQuery, query: currentQuery }
                    }]);
                }
                const preliminaryEmbedding = await preliminaryEmbeddingPromise;
                const preliminaryCandidates = vectorStore.current.search(preliminaryEmbedding, 5) ?? [];
                const relevantDocIds = Array.from(new Set(preliminaryCandidates.map(c => c.id)));
                
                await waitForSummaries(relevantDocIds);

                // Step 2: Build the context-aware prompt with summaries
                let summariesSection = 'No relevant document summaries found.';
                const relevantSummaries = Object.entries(summaries).filter(([id]) => relevantDocIds.includes(id));
                if (relevantSummaries.length > 0) {
                    const summaryList = relevantSummaries
                        .map(([id, summary]) => {
                            const file = files.find(f => f.id === id);
                            const fileName = file ? file.name : id;
                            return `File: ${fileName} (ID: ${id})\nSummary: ${summary}`;
                        })
                        .join('\n\n');
                    summariesSection = `Here is a high-level summary of the documents most relevant to the user's query:\n\n${summaryList}`;
                }

                const subQuestionPrompt = `You are an expert research assistant. Your goal is to break down a user's query into a set of specific, answerable sub-questions that can be used to search a knowledge base.
You have access to high-level summaries of the available documents. Use these summaries to understand the context and generate targeted questions.

**IMPORTANT:**
- The questions you generate are for a machine (a RAG system), not for the user.
- Do NOT ask clarifying questions like "Which Xavier are you referring to?".
- Generate questions that are likely to be answered by the content of the documents, based on their summaries.
- The questions should be self-contained and specific.

**Available Document Summaries:**
${summariesSection}

**User's Main Query:**
"${query}"

Based on the user's query and the provided summaries, generate ${appSettings.numSubQuestions} specific sub-questions to build a comprehensive profile of the character. Return the questions as a JSON array of strings: ["question 1", "question 2", ...].`;

                if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Deep Analysis] Generating sub-questions with prompt:`, subQuestionPrompt);

                const subQuestionMessages: ChatMessage[] = [{ role: 'user', content: subQuestionPrompt }];
                const subQuestionResponse = await callGenerateContent(selectedModel, apiKey, subQuestionMessages);
                try {
                    const jsonString = subQuestionResponse.text.replace(/```json\n([\s\S]*?)\n```/, '$1').trim();
                    const parsedSubQuestions = JSON.parse(jsonString);
                    queries = [query, ...parsedSubQuestions];
                    if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [Deep Analysis] Generated ${parsedSubQuestions.length} sub-questions:`, parsedSubQuestions);
                } catch (e) {
                    if (appSettings.isLoggingEnabled) console.error(`[${new Date().toISOString()}] [Deep Analysis] Failed to parse sub-questions:`, e);
                    queries = [query];
                }
            }

            const allCandidates: SearchResult[] = [];
            if (appSettings.isLoggingEnabled) console.log(`[DIAGNOSTIC] Starting search with ${queries.length} queries (Deep Analysis: ${appSettings.isDeepAnalysisEnabled}).`);
            for (const q of queries) {
                const queryEmbeddingPromise = new Promise<number[]>((resolve) => {
                    if (queryEmbeddingResolver) queryEmbeddingResolver.current = resolve;
                });
                if (coordinator.current) {
                    coordinator.current.addJob('Embed Query', [{
                        id: `query-${Date.now()}`,
                        priority: TaskPriority.P1_Primary,
                        payload: {
                            type: TaskType.EmbedQuery,
                            query: q,
                        }
                    }]);
                }
                const queryEmbedding = await queryEmbeddingPromise;
                if (appSettings.isLoggingEnabled) console.log(`[DIAGNOSTIC] Received query embedding for: "${q}"`);

                const candidatesForQuery = vectorStore.current.search(queryEmbedding, appSettings.numInitialCandidates) ?? [];
                if (appSettings.isLoggingEnabled) console.log(`[DIAGNOSTIC] Query "${q}" returned ${candidatesForQuery.length} candidates.`);
                allCandidates.push(...candidatesForQuery);
            }
            
            
            // Deduplicate candidates
            const uniqueCandidates = Array.from(new Map(allCandidates.map(c => [`${c.id}-${c.start}-${c.end}`, c])).values());
            if (appSettings.isLoggingEnabled) console.log(`[DIAGNOSTIC] Total unique candidates from all queries: ${uniqueCandidates.length}.`);

            const initialCandidates = uniqueCandidates;

            const requiredDocIds = Array.from(new Set(initialCandidates.map(c => c.id)));
            await waitForSummaries(requiredDocIds);
            if (initialCandidates.length === 0) {
                if (appSettings.docOnlyMode) {
                    const elapsedTime = Date.now() - startTime;
                    setChatHistory([...newHistoryWithUser, { role: 'model', content: 'I could not find an answer in the provided documents.', tokenUsage: perRequestTokenUsage, elapsedTime }]);
                    setIsLoading(false);
                    return;
                }
                 const messages: ChatMessage[] = [
                    { role: 'system', content: getSystemPrompt() }, // No context found
                    ...newHistoryWithUser,
                 ];
                const llmResponse = await callGenerateContent(selectedModel, apiKey, messages);
                const elapsedTime = Date.now() - startTime;
                setChatHistory([...newHistoryWithUser, { role: 'model', content: llmResponse.text, tokenUsage: perRequestTokenUsage, elapsedTime }]);
                setIsLoading(false);
                return;
            }

            let searchResults: SearchResult[];

            if (appSettings.isRerankingEnabled) {
                if (appSettings.isLoggingEnabled) console.log(`[DIAGNOSTIC] Reranking enabled. Starting parallel rerank job.`);
                
                const rerankTasks: Omit<ComputeTask, 'jobId'>[] = [];
                const batchSize = Math.ceil(initialCandidates.length / appSettings.numMlWorkers);
                if (appSettings.isLoggingEnabled) console.log(`[DIAGNOSTIC] Reranking batch size: ${batchSize} (Candidates: ${initialCandidates.length}, Workers: ${appSettings.numMlWorkers})`);

                for (let i = 0; i < appSettings.numMlWorkers; i++) {
                    const batch = initialCandidates.slice(i * batchSize, (i + 1) * batchSize);
                    if (batch.length === 0) continue;
                    if (appSettings.isLoggingEnabled) console.log(`[DIAGNOSTIC] Creating rerank task for batch ${i} with ${batch.length} candidates.`);

                    const rerankPayload: RerankPayload = {
                        type: TaskType.Rerank,
                        query: query,
                        documents: batch.map(c => ({
                            chunk: c.chunk,
                            id: c.id, // Use id instead of path
                            start: c.start,
                            end: c.end,
                        })),
                    };
                    rerankTasks.push({
                        id: `rerank-task-${i}`,
                        priority: TaskPriority.P1_Primary,
                        payload: rerankPayload,
                    });
                }

                setRerankProgress({ progress: 0, total: rerankTasks.length });

                const rerankPromise = new Promise<SearchResult[]>((resolve) => {
                    if (rerankPromiseResolver) rerankPromiseResolver.current = { resolve, jobId: '', taskResults: [] };
                });
                
                if (coordinator.current) {
                    const actualJobId = coordinator.current.addJob(`Rerank Query: ${query.slice(0, 20)}...`, rerankTasks);

                    if (actualJobId && rerankPromiseResolver?.current) {
                        rerankPromiseResolver.current.jobId = actualJobId;
                        if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [App DEBUG] Rerank job ${actualJobId} added to coordinator. Awaiting promise resolution.`);
                    }
                }

                searchResults = await rerankPromise;
                
                if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [App DEBUG] Rerank promise resolved. Received ${searchResults.length} reranked results from parallel job.`);

            } else {
                if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [App] Reranking disabled. Using initial search results.`);
                searchResults = initialCandidates;
            }

            if (appSettings.isLoggingEnabled) console.log(`[DEBUG] Found ${searchResults.length} relevant results. No filtering applied.`);

            let contextMessage = '';
            let finalSearchResults: SearchResult[] = [];
            if (searchResults.length > 0) {
                finalSearchResults = searchResults.slice(0, appSettings.numFinalContextChunks);
                console.log(`[DEBUG] Final ${finalSearchResults.length} search results for context:`, JSON.stringify(finalSearchResults, null, 2));

                const context = finalSearchResults.map((r, i) => {
                    const file = files.find(f => f.id === r.id);
                    const fileName = file ? file.name : r.id; // Fallback to ID if file not found
                    return `[${i + 1}] File: ${fileName} (ID: ${r.id})\n\n${r.chunk}`;
                }).join('\n\n---\n\n');
                contextMessage = `CONTEXT:\n---\n${context}\n---`;
                if (appSettings.isLoggingEnabled) console.log(`[DEBUG] Final context for LLM built from ${finalSearchResults.length} chunks.`);
            } else {
                if (appSettings.isLoggingEnabled) console.log(`[DEBUG] No search results after reranking. Sending query to LLM without context.`);
            }

            if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [App DEBUG] Context built. Calling LLM.`);
            
            const messages: ChatMessage[] = [
                { role: 'system', content: getSystemPrompt(requiredDocIds) },
                ...history,
                { role: 'user', content: `${contextMessage}\n\nUSER QUESTION: ${query}` }
            ];

           if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [App DEBUG] Sending messages to LLM:`, JSON.stringify(messages, null, 2));
           const llmResponse = await callGenerateContent(selectedModel, apiKey, messages);
           const elapsedTime = Date.now() - startTime;

           setTokenUsage((prev: TokenUsage) => ({
               promptTokens: prev.promptTokens + perRequestTokenUsage.promptTokens,
               completionTokens: prev.completionTokens + perRequestTokenUsage.completionTokens,
           }));
 
           const contentWithSources = `${llmResponse.text}<!--searchResults:${JSON.stringify(finalSearchResults)}-->`;
           setChatHistory([...newHistoryWithUser, { role: 'model', content: contentWithSources, tokenUsage: perRequestTokenUsage, elapsedTime }]);
        } catch (error) {
            if (appSettings.isLoggingEnabled) console.error(`[${new Date().toISOString()}] [App DEBUG] Error in submitQuery: `, error);
            console.error(error);
             const errorMessage =
                error instanceof Error ? error.message : 'An unknown error occurred.';
            setChatHistory((prev) => [
                ...prev,
                {
                    role: 'model',
                    content: `Sorry, I encountered an error: ${errorMessage}`,
                },
            ]);
        } finally {
            setIsLoading(false);
        }
    }, [isLoading, summaries, appSettings, coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver, setRerankProgress, apiKeys, selectedProvider, selectedModel, setIsLoading, setChatHistory, getSystemPrompt, waitForSummaries, files]);

    const handleRedo = useCallback(async (index: number) => {
        const messageToRedo = chatHistory[index];
        if (messageToRedo.role !== 'user' || isLoading || isEmbedding) return;

        const historyUpToRedo = chatHistory.slice(0, index);
        await submitQuery(messageToRedo.content, historyUpToRedo);
    }, [chatHistory, isLoading, isEmbedding, submitQuery]);

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (isEmbedding) {
            console.log('Query submitted during embedding, queuing:', userInput);
            setPendingQuery(userInput);
            setChatHistory((prev) => [
                ...prev,
                {
                    role: 'model',
                    content: 'Your query has been queued and will be processed once file embedding is complete. Please wait.',
                },
            ]);
            setUserInput('');
            return;
        }
        await submitQuery(userInput, chatHistory);
        setUserInput('');
    }, [userInput, chatHistory, submitQuery, isEmbedding, setPendingQuery]);

    useEffect(() => {
        if (!isEmbedding && pendingQuery) {
            console.log('Embedding finished, processing pending query:', pendingQuery);
            submitQuery(pendingQuery, chatHistory);
            setPendingQuery(null);
        }
    }, [isEmbedding, pendingQuery, submitQuery, chatHistory, setPendingQuery]);

    const createMarkup = (htmlContent: string) => ({ __html: htmlContent });

        const handleSourceClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        const overflowToggle = target.closest('.citation-overflow-toggle') as HTMLElement | null;
        if (overflowToggle) {
            const group = overflowToggle.closest('.citation-group') as HTMLElement | null;
            if (group) {
                const open = group.getAttribute('data-open') === 'true';
                group.setAttribute('data-open', open ? 'false' : 'true');
                e.preventDefault();
                return;
            }
        }
        const button = target.closest('button.source-link');
        const jump = target.closest('.jump-to-badge');
        const el = (button as HTMLElement) || (jump as HTMLElement);
        if (el) {
            const fileId = el.getAttribute('data-file-id')?.trim();
            const chunksJSON = el.getAttribute('data-chunks');
            const startAttr = el.getAttribute('data-start');
            const endAttr = el.getAttribute('data-end');
            if (fileId) {
                const file = files.find((f) => f.id === fileId);
                if (file) {
                    try {
                        let chunks: SearchResult[] = [];
                        if (chunksJSON) {
                            chunks = JSON.parse(chunksJSON);
                        } else if (startAttr && endAttr) {
                            chunks = [{ 
                                id: fileId, 
                                start: parseInt(startAttr, 10), 
                                end: parseInt(endAttr, 10),
                                chunk: '', // Default or placeholder if not provided
                                similarity: 1
                            }];
                        }
                        setActiveSource({ file, chunks });
                        setIsModalOpen(true);
                        coordinator?.current?.prioritizeLayoutForDoc(file.id);
                    } catch (error) {
                        console.error("Failed to parse source chunks:", error);
                        setSelectedFile(file);
                        setActiveSource(null);
                    }
                }
            }
        }
    }, [files, setActiveSource, setIsModalOpen, setSelectedFile, coordinator]);

    const renderModelMessage = useCallback((content: string) => {
        let searchResults: SearchResult[] = [];
        const contentWithoutResults = content.replace(/<!--searchResults:(.*?)-->/, (_, resultsJson) => {
            try {
                searchResults = JSON.parse(resultsJson);
            } catch (e) {
                console.error("Failed to parse search results from comment", e);
            }
            return '';
        });

        const rawHtml = marked.parse(contentWithoutResults, { gfm: true, breaks: true });

        // Per-document numbering plus per-fragment sub-index (letter)
        const docNumbers = new Map<string, number>();
        let nextDocNumber = 1;
        const getDocNumber = (docId: string): number => {
            let n = docNumbers.get(docId);
            if (!n) {
                n = nextDocNumber++;
                docNumbers.set(docId, n);
            }
            return n;
        };

        // Assign letters on demand per unique fragment within a doc (a, b, c, ...)
        const fragLetters = new Map<string, string>();
        const nextFragIndexByDoc = new Map<string, number>();
        const indexToLetters = (idx: number): string => {
            // 0 -> a, 1 -> b, ... 25 -> z, 26 -> aa, 27 -> ab, ...
            const alphabet = 'abcdefghijklmnopqrstuvwxyz';
            let s = '';
            let n = idx + 1; // 1-based
            while (n > 0) {
                n--; s = alphabet[n % 26] + s; n = Math.floor(n / 26);
            }
            return s;
        };
        const getFragLetter = (sr: SearchResult): string => {
            const key = `${sr.id}:${sr.start}:${sr.end}`;
            let letter = fragLetters.get(key);
            if (!letter) {
                const current = nextFragIndexByDoc.get(sr.id) ?? 0;
                letter = indexToLetters(current);
                fragLetters.set(key, letter);
                nextFragIndexByDoc.set(sr.id, current + 1);
            }
            return letter;
        };

        // Keep a cursor so repeated [Source: <id>] calls for the same doc walk through multiple fragments
        const idPickCursor: Record<string, number> = {};

        // Accept [Source: <id>] or [Source: n] or [Source: n, m] or [Source: id1, id2]
        const finalHtml = (rawHtml as string).replace(/\[Source:\s*([^\]]+)\]/g, (match: string, inside: string) => {
            const raw = inside.trim();
            // If the content is comma-separated numbers, map each number N to searchResults[N-1]
            const tokens = raw.split(',').map((t: string) => t.trim()).filter(Boolean);
            const allNumeric = tokens.length > 0 && tokens.every((t: string) => /^\d+$/.test(t));

            if (allNumeric && searchResults.length > 0) {
                const items = tokens.map((tok: string) => {
                    const nVal = parseInt(tok, 10);
                    if (Number.isNaN(nVal) || nVal < 1 || nVal > searchResults.length) return '';
                    const sr = searchResults[nVal - 1];
                    if (!sr) return '';
                    const file = files.find(f => f.id === sr.id);
                    const fileName = file ? file.name : sr.id;
                    const safeTitle = (fileName || '').replace(/"/g, '&quot;');
                    const docNo = getDocNumber(sr.id);
                    const fragLetter = getFragLetter(sr);
                    const esc = (s: string) => s.replace(/[&<>"]/g, (m: string) => (({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'} as Record<string, string>)[m]));
                    const preview = esc((sr.chunk || '').slice(0, 120).replace(/\n/g, ' '));
                    const attrs = `data-file-id="${sr.id}" data-start="${sr.start}" data-end="${sr.end}"`;
                    return `<button class="source-link citation-bubble" ${attrs} title="Doc #${docNo} — ${safeTitle} • Fragment ${fragLetter}: ${preview}"><span class="bubble-number">${docNo}</span><sup class="frag-letter">${fragLetter}</sup></button><span class="jump-to-badge" ${attrs} title="Jump to Doc #${docNo} — ${safeTitle} • Fragment ${fragLetter}: ${preview}">↦</span>`;
                }).filter(Boolean);
                const MAX_VISIBLE = 8;
                const visible = items.slice(0, MAX_VISIBLE).join('');
                const overflowCount = items.length - MAX_VISIBLE;
                let overflow = '';
                if (overflowCount > 0) {
                    const hidden = items.slice(MAX_VISIBLE).join('');
                    overflow = `<button class="citation-overflow-toggle">+${overflowCount} more</button><div class="citation-overflow-popover">${hidden}</div>`;
                }
                const group = `${visible}${overflow}`;
                return items.length ? `<span class="citation-group">${group}</span>&thinsp;` : match;
            }

            // Otherwise, treat each token as an ID and render multiple bubbles
            const idTokens = tokens.length > 0 ? tokens : [raw];
            const items = idTokens.map((tid: string) => {
                const trimmedFileId = tid;
                const matches = searchResults.filter(sr => sr.id === trimmedFileId);
                if (matches.length === 0) return '';
                const cursor = idPickCursor[trimmedFileId] ?? 0;
                const sr = matches[cursor % matches.length];
                idPickCursor[trimmedFileId] = cursor + 1;
                const file = files.find(f => f.id === trimmedFileId);
                const fileName = file ? file.name : trimmedFileId;
                const safeTitle = (fileName || '').replace(/"/g, '&quot;');
                const docNo = getDocNumber(sr.id);
                const fragLetter = getFragLetter(sr);
                const esc = (s: string) => s.replace(/[&<>"]/g, (m: string) => (({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'} as Record<string, string>)[m]));
                const preview = esc((sr.chunk || '').slice(0, 120).replace(/\n/g, ' '));
                const attrs = `data-file-id="${sr.id}" data-start="${sr.start}" data-end="${sr.end}"`;
                return `<button class="source-link citation-bubble" ${attrs} title="Doc #${docNo} — ${safeTitle} • Fragment ${fragLetter}: ${preview}"><span class="bubble-number">${docNo}</span><sup class="frag-letter">${fragLetter}</sup></button><span class="jump-to-badge" ${attrs} title="Jump to Doc #${docNo} — ${safeTitle} • Fragment ${fragLetter}: ${preview}">↦</span>`;
            }).filter(Boolean);
            const MAX_VISIBLE = 8;
            const visible = items.slice(0, MAX_VISIBLE).join('');
            const overflowCount = items.length - MAX_VISIBLE;
            let overflow = '';
            if (overflowCount > 0) {
                const hidden = items.slice(MAX_VISIBLE).join('');
                overflow = `<button class="citation-overflow-toggle">+${overflowCount} more</button><div class="citation-overflow-popover">${hidden}</div>`;
            }
            const group = `${visible}${overflow}`;
            return items.length ? `<span class="citation-group">${group}</span>&thinsp;` : match;
        });

        // As a final clean-up, strip any remaining raw [Source: ...] tags (unproductive references)
        const cleanedHtml = (finalHtml as string).replace(/\[Source:[^\]]+\]/g, '');

        return createMarkup(cleanedHtml);
    }, [files]);

    const handleClearConversation = useCallback(() => {
        if (window.confirm('Are you sure you want to clear the conversation? This will not delete your files.')) {
            setChatHistory(initialChatHistory);
            setTokenUsage({ promptTokens: 0, completionTokens: 0 });
        }
    }, [initialChatHistory, setChatHistory]);

    const handleRemoveMessage = useCallback((indexToRemove: number) => {
        setChatHistory(prev => prev.filter((_, i) => i !== indexToRemove));
    }, [setChatHistory]);

    return {
        userInput,
        setUserInput,
        chatHistory,
        setChatHistory,
        tokenUsage,
        setTokenUsage,
        handleRedo,
        handleSubmit,
        handleSourceClick,
        renderModelMessage,
        handleClearConversation,
        handleRemoveMessage,
        initialChatHistory,
        pendingQuery,
        setPendingQuery,
    };
};
