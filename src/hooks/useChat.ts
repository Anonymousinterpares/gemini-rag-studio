import { useCallback, useEffect, useState, useMemo } from 'react';
import { marked } from 'marked';
import { AppFile, ChatMessage, JobProgress, Model, SearchResult, TokenUsage } from '../types';
import { summaryCache } from '../cache/summaryCache';
import { ComputeTask, TaskPriority, TaskType } from '../compute/types';
import { generateContent } from '../api/llm-provider';
import { ComputeCoordinator } from '../compute/coordinator';
import { VectorStore } from '../rag/pipeline';
import { useChatStore, useFileStore, useSettingsStore } from '../store';

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
    coordinator: React.MutableRefObject<ComputeCoordinator | null> | null;
    vectorStore: React.MutableRefObject<VectorStore | null> | null;
    queryEmbeddingResolver: React.MutableRefObject<((value: number[]) => void) | null>;
    rerankPromiseResolver: React.MutableRefObject<{ resolve: (results: SearchResult[]) => void; jobId: string; taskResults: SearchResult[] } | null>;
    setRerankProgress: (progress: JobProgress | null) => void;
    setActiveSource: React.Dispatch<React.SetStateAction<{ file: AppFile, chunks: SearchResult[] } | null>>;
    setIsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export const useChat = ({
    coordinator,
    vectorStore,
    queryEmbeddingResolver,
    rerankPromiseResolver,
    setActiveSource,
    setIsModalOpen,
}: UseChatProps) => {
    const { 
        chatHistory, setChatHistory, 
        userInput, setUserInput, 
        pendingQuery, setPendingQuery, 
        tokenUsage, setTokenUsage, 
        isLoading, setIsLoading,
        clearHistory
    } = useChatStore();

    const { files } = useFileStore();
    const { appSettings, selectedModel, selectedProvider, apiKeys } = useSettingsStore();

    const [summaries, setSummaries] = useState<Record<string, string>>({});

    const initialChatHistory = useMemo((): ChatMessage[] => ([
        {
            role: 'model' as const,
            content:
                "Hello! Drop your files or a project folder on the left to get started. I'll create a knowledge base from them, and you can ask me anything about their content.",
        },
    ]), []);

    useEffect(() => {
        const loadSummaries = async () => {
            const allSummaries = await summaryCache.getAll();
            setSummaries(allSummaries);
        };
        loadSummaries();

        const handleTokenUpdate = (e: import('../compute/types').TokenUsageUpdateMessage) => {
            if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [App] Received token usage update from coordinator:`, e.usage);
            setTokenUsage((prev) => ({
                promptTokens: prev.promptTokens + e.usage.promptTokens,
                completionTokens: prev.completionTokens + e.usage.completionTokens,
            }));
        };

        const currentCoordinator = coordinator?.current;
        currentCoordinator?.on('token_usage_update', handleTokenUpdate);

        return () => {
            currentCoordinator?.off('token_usage_update', handleTokenUpdate);
        }
    }, [coordinator, appSettings.isLoggingEnabled, setTokenUsage]);

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
        if (idsToWaitFor.length === 0) return;

        const promises = idsToWaitFor.map(id => {
            return new Promise<void>(resolve => {
                const onSummaryCompleted = (message: import('../compute/types').SummaryGenerationCompletedMessage) => {
                    if (message.docId === id) { cleanUp(); resolve(); }
                };
                const onSummaryFailed = (message: import('../compute/types').SummaryGenerationFailedMessage) => {
                    if (message.docId === id) { cleanUp(); resolve(); }
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
    }, [coordinator]);

    const submitQuery = useCallback(async (query: string, history: ChatMessage[]) => {
        if (!query.trim() || isLoading || !coordinator?.current || !vectorStore?.current) return;

        const startTime = Date.now();
        const perRequestTokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
        const newHistoryWithUser: ChatMessage[] = [...history, { role: 'user', content: query }];
        
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
            let decision = 'GENERAL_CONVERSATION';
            
            const routerPrompt = `Router Agent: GENERAL_CONVERSATION or KNOWLEDGE_SEARCH. Query: "${query}"`;
            const routerResponse = await callGenerateContent(selectedModel, apiKey, [{ role: 'user', content: routerPrompt }]);
            decision = routerResponse.text.trim().toUpperCase().includes('KNOWLEDGE_SEARCH') ? 'KNOWLEDGE_SEARCH' : 'GENERAL_CONVERSATION';

            if (appSettings.enableRouterV2) {
                try {
                    const { decideRouteV2 } = await import('../agents/router_v2');
                    const embedQueryFn = async (q: string) => {
                        const p = new Promise<number[]>((resolve) => { if (queryEmbeddingResolver) queryEmbeddingResolver.current = resolve; });
                        if (coordinator.current) {
                            coordinator.current.addJob('Embed Query', [{ id: `query-${Date.now()}`, priority: TaskPriority.P1_Primary, payload: { type: TaskType.EmbedQuery, query: q } }]);
                        }
                        return await p;
                    };
                    const route = await decideRouteV2({
                        query, history, filesLoaded: files.length > 0, vectorStore: vectorStore.current!,
                        model: selectedModel, apiKey, settings: appSettings, embedQuery: embedQueryFn,
                    });
                    decision = route.mode === 'CHAT' ? 'GENERAL_CONVERSATION' : 'KNOWLEDGE_SEARCH';
                    
                    if (route.mode.startsWith('DEEP_ANALYSIS') && appSettings.enableDeepAnalysisV1) {
                        const { runDeepAnalysis } = await import('../agents/deep_analysis');
                        const level = appSettings.deepAnalysisLevel === 3 || route.mode === 'DEEP_ANALYSIS_L3' ? 3 : 2;
                        const da = await runDeepAnalysis({
                            query, history: newHistoryWithUser, vectorStore: vectorStore.current!,
                            model: selectedModel, apiKey, settings: appSettings, embedQuery: embedQueryFn,
                            rerank: appSettings.isRerankingEnabled ? async (rerankQuery, docs) => {
                                const tasks: Omit<ComputeTask, 'jobId'>[] = [];
                                docs.forEach((d, i) => tasks.push({ id: `rerank-${i}`, priority: TaskPriority.P1_Primary, payload: { type: TaskType.Rerank, query: rerankQuery, documents: [d] } }));
                                const rerankPromise = new Promise<SearchResult[]>((resolve) => { if (rerankPromiseResolver) rerankPromiseResolver.current = { resolve, jobId: '', taskResults: [] }; });
                                if (coordinator.current) {
                                    const jobId = coordinator.current.addJob('Rerank', tasks);
                                    if (rerankPromiseResolver.current) rerankPromiseResolver.current.jobId = jobId;
                                }
                                return await rerankPromise;
                            } : undefined,
                            level,
                        });
                        const daUsage = (da as { llmTokens?: TokenUsage }).llmTokens || { promptTokens: 0, completionTokens: 0 };
                        setTokenUsage(prev => ({ promptTokens: prev.promptTokens + daUsage.promptTokens, completionTokens: prev.completionTokens + daUsage.completionTokens }));
                        setChatHistory([...newHistoryWithUser, { role: 'model', content: `${da.finalText}<!--searchResults:${JSON.stringify(da.usedResults)}-->`, tokenUsage: daUsage, elapsedTime: Date.now() - startTime }]);
                        setIsLoading(false);
                        return;
                    }
                } catch (_e) {
                    if (appSettings.isLoggingEnabled) console.warn('[RouterV2] Failed', _e);
                }
            }

            if (decision === 'GENERAL_CONVERSATION') {
                const llmResponse = await callGenerateContent(selectedModel, apiKey, [{ role: 'system', content: getSystemPrompt() }, ...newHistoryWithUser]);
                setTokenUsage(prev => ({ promptTokens: prev.promptTokens + perRequestTokenUsage.promptTokens, completionTokens: prev.completionTokens + perRequestTokenUsage.completionTokens }));
                setChatHistory([...newHistoryWithUser, { role: 'model', content: llmResponse.text, tokenUsage: perRequestTokenUsage, elapsedTime: Date.now() - startTime }]);
                setIsLoading(false);
                return;
            }

            const queryEmbeddingPromise = new Promise<number[]>((resolve) => { if (queryEmbeddingResolver) queryEmbeddingResolver.current = resolve; });
            if (coordinator.current) {
                coordinator.current.addJob('Embed Query', [{ id: `query-${Date.now()}`, priority: TaskPriority.P1_Primary, payload: { type: TaskType.EmbedQuery, query } }]);
            }
            const queryEmbedding = await queryEmbeddingPromise;
            const searchResults = vectorStore.current.search(queryEmbedding, appSettings.numInitialCandidates);
            
            const requiredDocIds = Array.from(new Set(searchResults.map(c => c.id)));
            await waitForSummaries(requiredDocIds);

            const context = searchResults.slice(0, appSettings.numFinalContextChunks).map((r, i) => `[${i + 1}] File: ${files.find(f => f.id === r.id)?.name || r.id}\n\n${r.chunk}`).join('\n\n---\n\n');
            const messages: ChatMessage[] = [{ role: 'system', content: getSystemPrompt(requiredDocIds) }, ...history, { role: 'user', content: `CONTEXT:\n---\n${context}\n---\n\nUSER QUESTION: ${query}` }];
            
            const llmResponse = await callGenerateContent(selectedModel, apiKey, messages);
            setTokenUsage(prev => ({ promptTokens: prev.promptTokens + perRequestTokenUsage.promptTokens, completionTokens: prev.completionTokens + perRequestTokenUsage.completionTokens }));
            setChatHistory([...newHistoryWithUser, { role: 'model', content: `${llmResponse.text}<!--searchResults:${JSON.stringify(searchResults)}-->`, tokenUsage: perRequestTokenUsage, elapsedTime: Date.now() - startTime }]);
        } catch (error) {
            setChatHistory([...newHistoryWithUser, { role: 'model', content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}` }]);
        } finally {
            setIsLoading(false);
        }
    }, [isLoading, appSettings, coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver, apiKeys, selectedProvider, selectedModel, setIsLoading, setChatHistory, getSystemPrompt, waitForSummaries, files, setTokenUsage]);

    const handleRedo = useCallback(async (index: number) => {
        const messageToRedo = chatHistory[index];
        if (messageToRedo.role !== 'user' || isLoading) return;
        await submitQuery(messageToRedo.content, chatHistory.slice(0, index));
    }, [chatHistory, isLoading, submitQuery]);

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        await submitQuery(userInput, chatHistory);
        setUserInput('');
    }, [userInput, chatHistory, submitQuery, setUserInput]);

    const renderModelMessage = useCallback((content: string) => {
        let searchResults: SearchResult[] = [];
        const contentWithoutResults = content.replace(/<!--searchResults:(.*?)-->/, (_, resultsJson) => {
            try { searchResults = JSON.parse(resultsJson); } catch {
                // ignore
            }
            return '';
        });
        const rawHtml = marked.parse(contentWithoutResults, { gfm: true, breaks: true });
        const docNumbers = new Map<string, number>();
        let nextDocNumber = 1;
        const finalHtml = (rawHtml as string).replace(/\[Source:\s*([^\]]+)\]/g, (match: string, inside: string) => {
            const tokens = inside.trim().split(',').map((t: string) => t.trim()).filter(Boolean);
            const items = tokens.map((tid: string) => {
                const sr = searchResults.find(r => r.id === tid);
                if (!sr) return '';
                if (!docNumbers.has(sr.id)) docNumbers.set(sr.id, nextDocNumber++);
                const docNo = docNumbers.get(sr.id);
                return `<button class="source-link citation-bubble" data-file-id="${sr.id}" data-start="${sr.start}" data-end="${sr.end}" title="Doc #${docNo}"><span>${docNo}</span></button>`;
            }).join('');
            return items ? `<span class="citation-group">${items}</span>` : match;
        });
        return { __html: finalHtml };
    }, []);

    const handleSourceClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        const btn = target.closest('button.source-link');
        if (btn) {
            const fileId = btn.getAttribute('data-file-id');
            const file = files.find(f => f.id === fileId);
            if (file) {
                const chunks = [{ id: file.id, start: parseInt(btn.getAttribute('data-start') || '0'), end: parseInt(btn.getAttribute('data-end') || '0'), chunk: '', similarity: 1 }];
                setActiveSource({ file, chunks });
                setIsModalOpen(true);
            }
        }
    }, [files, setActiveSource, setIsModalOpen]);

    return {
        userInput, setUserInput,
        chatHistory, setChatHistory,
        tokenUsage, setTokenUsage,
        handleRedo, handleSubmit, handleSourceClick, renderModelMessage,
        handleClearConversation: () => clearHistory(initialChatHistory),
        handleRemoveMessage: (idx: number) => setChatHistory(prev => prev.filter((_, i) => i !== idx)),
        pendingQuery, setPendingQuery,
        initialChatHistory
    };
};
