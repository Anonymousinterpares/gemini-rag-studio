import { useCallback, useEffect, useState, useMemo } from 'react';
import { marked } from 'marked';
import { AppFile, ChatMessage, JobProgress, Model, SearchResult, TokenUsage } from '../types';
import { summaryCache } from '../cache/summaryCache';
import { ComputeTask, TaskPriority, TaskType } from '../compute/types';
import { generateContent, Tool } from '../api/llm-provider';
import { ComputeCoordinator } from '../compute/coordinator';
import { VectorStore } from '../rag/pipeline';
import { useChatStore, useFileStore, useSettingsStore } from '../store';
import { searchWeb } from '../utils/search';

const SEARCH_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'search_web',
    description: 'Search the internet for current information, news, or specific data not present in your training knowledge.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to perform.',
        },
      },
      required: ['query'],
    },
  },
};

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
If the answer is not in the files or the conversation history, say "I could not find an answer in the provided documents."

{date_section}`;

const CHAT_MODE_PROMPT_TEMPLATE = `You are a helpful and expert AI assistant. Your user is a software developer.
Be concise and accurate in your answers.
You HAVE INTERNET ACCESS via the 'search_web' tool. 

CRITICAL INSTRUCTIONS:
1. If you need information you don't have, you MUST use 'search_web'.
2. The ONLY valid way to search is to call the function 'search_web' with the parameter 'query'.
3. DO NOT output JSON in your text response. Use the formal tool-calling field.
4. NEVER imagine, simulate, or hallucinate search results. 
5. DO NOT act out the search process in your reasoning. Emit the tool call and STOP.
6. You will receive the real search results in the next turn. Wait for them.
7. If you use information from the provided document contexts, you MUST cite your sources using the exact format [Source: uniqueId].
8. If you use information from web search results, you MUST provide a direct link to the source using standard Markdown format: [Title](URL). Use ONLY the URLs provided in the search results; NEVER hallucinate or guess a URL.
9. NOTE: Today is indeed in the year 2026. Do not be confused if your training data only goes up to a previous year; you are currently operating in 2026 and should accept this as the current date.

{date_section}

{summaries_section}`;

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
        abortController, setAbortController,
        clearHistory
    } = useChatStore();

    const { files } = useFileStore();
    const { appSettings, selectedModel, selectedProvider, apiKeys } = useSettingsStore();

    const [summaries, setSummaries] = useState<Record<string, string>>({});

    const stopGeneration = useCallback(() => {
        if (abortController) {
            abortController.abort();
            setAbortController(null);
        }
        setIsLoading(false);
    }, [abortController, setAbortController, setIsLoading]);

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

        const template = appSettings.isChatModeEnabled ? CHAT_MODE_PROMPT_TEMPLATE : AGENT_SYSTEM_PROMPT_TEMPLATE;
        const docOnly = (appSettings.docOnlyMode && !appSettings.isChatModeEnabled)
          ? `\n\nDOC-ONLY MODE: You must answer strictly using the provided document contexts and conversation. Do not use external or general knowledge. If the documents do not contain the answer, reply exactly: "I could not find an answer in the provided documents."\n`
          : '';
        
        let finalPrompt = template.replace('{summaries_section}', summariesSection + docOnly);
        
        if (appSettings.isChatModeEnabled) {
            const now = new Date();
            const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const dateSection = `\n[SYSTEM_CONTEXT: TODAY IS ${dateStr}, ${timeStr}]\n`;
            finalPrompt = finalPrompt.replace('{date_section}', dateSection);
        } else {
            finalPrompt = finalPrompt.replace('{date_section}', '');
        }
        
        return finalPrompt;
    }, [summaries, files, appSettings.docOnlyMode, appSettings.isChatModeEnabled]);

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
        if (!query.trim() || isLoading || !coordinator?.current) return;
        // If not in chat mode, we MUST have a vector store
        if (!appSettings.isChatModeEnabled && !vectorStore?.current) return;

        const startTime = Date.now();
        const perRequestTokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
        const newHistoryWithUser: ChatMessage[] = [...history, { role: 'user', content: query }];
        
        setChatHistory(newHistoryWithUser);
        setIsLoading(true);

        const controller = new AbortController();
        setAbortController(controller);

        const callGenerateContent = async (model: Model, apiKey: string, messages: ChatMessage[], tools?: Tool[]): Promise<import('../api/llm-provider').LlmResponse> => {
            const response = await generateContent(model, apiKey, messages, tools, controller.signal);
            const { promptTokens, completionTokens } = response.usage;
            perRequestTokenUsage.promptTokens += promptTokens;
            perRequestTokenUsage.completionTokens += completionTokens;
            
            // Immediate, gradual update
            setTokenUsage(prev => ({ 
                promptTokens: prev.promptTokens + promptTokens, 
                completionTokens: prev.completionTokens + completionTokens 
            }));

            return response;
        };

        try {
            const apiKey = apiKeys[selectedProvider];

            // If Chat Mode is ON, enable search capabilities
            if (appSettings.isChatModeEnabled) {
                const currentHistory = [...newHistoryWithUser];
                const tools = [SEARCH_TOOL];
                let loopCount = 0;
                const MAX_LOOPS = appSettings.maxSearchLoops;

                while (loopCount < MAX_LOOPS) {
                    if (controller.signal.aborted) return;
                    
                    // Inject warning when near the limit - add to currentHistory so it persists
                    if (loopCount === MAX_LOOPS - 2 && MAX_LOOPS > 2) {
                        currentHistory.push({
                            role: 'system',
                            content: "ATTENTION: You have only 2 search calls remaining. Please make your final searches now if needed, then gather all information and provide your final answer to the user."
                        });
                    } else if (loopCount === MAX_LOOPS - 1) {
                        currentHistory.push({
                            role: 'system',
                            content: "ATTENTION: This is your LAST search call. After this, you MUST provide your final answer based on all gathered information."
                        });
                    }

                    const messagesToSend = [{ role: 'system' as const, content: getSystemPrompt() }, ...currentHistory];

                    const response = await callGenerateContent(selectedModel, apiKey, messagesToSend, tools);
                    
                    let toolCalls = response.toolCalls || [];
                    let cleanResponseText = response.text || '';

                    // Universal Interceptor: Catch models that invent their own search syntax
                    if (toolCalls.length === 0 && cleanResponseText) {
                        // ... Match Logic ...
                        // 1. Match XML-style: <search_web>query</search_web>
                        const xmlMatch = cleanResponseText.match(/<search_web>([\s\S]*?)<\/search_web>/i);
                        
                        // 2. Match Square-style: [search_web: query]
                        const bracketMatch = cleanResponseText.match(/\[search_web:?\s*([\s\S]*?)\]/i);

                        // 3. Match Complex XML: <invoke name="search_web"><parameter name="query">...</parameter></invoke>
                        const invokeMatch = cleanResponseText.match(/<invoke name="search_web">[\s\S]*?<parameter name="query">([\s\S]*?)<\/parameter>[\s\S]*?<\/invoke>/i);

                        // 4. Match Markdown Table: | tool | search_web | ... | query | ... |
                        const tableMatch = cleanResponseText.match(/\|\s*tool\s*\|\s*search_web\s*\|[\s\S]*?\|\s*query\s*\|\s*([\s\S]*?)\s*\|/i);

                        // 5. Match JSON-style anywhere in text
                        const jsonMatch = cleanResponseText.match(/\{[\s\S]*?"query"[\s\S]*?\}/i) || cleanResponseText.match(/\{[\s\S]*?"search"[\s\S]*?\}/i);

                        let extractedQuery = '';
                        let matchedText = '';

                        if (xmlMatch) {
                            extractedQuery = xmlMatch[1].trim();
                            matchedText = xmlMatch[0];
                        } else if (bracketMatch) {
                            extractedQuery = bracketMatch[1].trim();
                            matchedText = bracketMatch[0];
                        } else if (invokeMatch) {
                            extractedQuery = invokeMatch[1].trim();
                            matchedText = invokeMatch[0];
                        } else if (tableMatch) {
                            extractedQuery = tableMatch[1].trim();
                            matchedText = tableMatch[0];
                        } else if (jsonMatch) {
                            try {
                                const parsed = JSON.parse(jsonMatch[0].replace(/```json|```/g, '').trim());
                                extractedQuery = parsed.query || parsed.search || (parsed.parameters?.query);
                                if (extractedQuery) matchedText = jsonMatch[0];
                            } catch { /* ignore */ }
                        }

                        if (extractedQuery) {
                            console.log('[Chat] Intercepted non-standard tool call:', extractedQuery);
                            toolCalls = [{
                                id: `intercepted_${Date.now()}`,
                                type: 'function',
                                function: { name: 'search_web', arguments: JSON.stringify({ query: extractedQuery }) }
                            }];
                            // Clean the text response so the user doesn't see the raw command
                            cleanResponseText = cleanResponseText.replace(matchedText, '').trim();
                        }
                    }

                    // If no tool calls (and no fallback detected), we are done.
                    if (toolCalls.length === 0) {
                        setChatHistory([...currentHistory, { 
                            role: 'model', 
                            content: cleanResponseText, 
                            tokenUsage: perRequestTokenUsage, 
                            elapsedTime: Date.now() - startTime 
                        }]);
                        setIsLoading(false);
                        setAbortController(null);
                        return;
                    }

                    // Handle tool calls
                    const assistantMessage: ChatMessage = {
                        role: 'model',
                        content: cleanResponseText || null,
                        tool_calls: toolCalls
                    };
                    currentHistory.push(assistantMessage);

                    // Execute tools
                    for (const toolCall of toolCalls) {
                        if (controller.signal.aborted) return;
                        if (toolCall.function.name === 'search_web') {
                            try {
                                const args = JSON.parse(toolCall.function.arguments);
                                const searchQuery = args.query || args.search || toolCall.function.arguments;
                                console.log(`[Chat] Executing search_web with query: "${searchQuery}"`);
                                
                                const results = await searchWeb(searchQuery);
                                const toolOutput = {
                                    role: 'tool' as const,
                                    tool_call_id: toolCall.id,
                                    name: toolCall.function.name,
                                    content: JSON.stringify(results)
                                };
                                currentHistory.push(toolOutput);
                            } catch (_e) {
                                console.error('[Chat] Search tool error:', _e);
                                currentHistory.push({
                                    role: 'tool' as const,
                                    tool_call_id: toolCall.id,
                                    name: toolCall.function.name,
                                    content: JSON.stringify({ error: _e instanceof Error ? _e.message : "Search failed" })
                                });
                            }
                        }
                    }

                    loopCount++;
                }
                
                // Final attempt after reaching limit
                const finalPrompt = "SYSTEM: You have reached the maximum number of searches allowed for this turn. Please synthesize all the information gathered so far (including the web search results above) and provide your final comprehensive answer to the user now.";
                const finalResponse = await callGenerateContent(selectedModel, apiKey, [{ role: 'system' as const, content: getSystemPrompt() }, ...currentHistory, { role: 'user', content: finalPrompt }], []);

                setChatHistory([...currentHistory, { 
                    role: 'model', 
                    content: finalResponse.text || "I reached my search limit without a final answer.", 
                    tokenUsage: perRequestTokenUsage, 
                    elapsedTime: Date.now() - startTime 
                }]);
                setIsLoading(false);
                setAbortController(null);
                return;
            }

            let decision = 'GENERAL_CONVERSATION';
            
            const routerPrompt = `Router Agent: GENERAL_CONVERSATION or KNOWLEDGE_SEARCH. Query: "${query}"`;
            const routerResponse = await callGenerateContent(selectedModel, apiKey, [{ role: 'user', content: routerPrompt }]);
            decision = (routerResponse.text || '').trim().toUpperCase().includes('KNOWLEDGE_SEARCH') ? 'KNOWLEDGE_SEARCH' : 'GENERAL_CONVERSATION';

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
                    
                    if (!vectorStore?.current) throw new Error("Vector store not initialized.");

                    const route = await decideRouteV2({
                        query, history, filesLoaded: files.length > 0, vectorStore: vectorStore.current,
                        model: selectedModel, apiKey, settings: appSettings, embedQuery: embedQueryFn,
                        onTokenUsage: (usage) => {
                            perRequestTokenUsage.promptTokens += usage.promptTokens;
                            perRequestTokenUsage.completionTokens += usage.completionTokens;
                            setTokenUsage(prev => ({
                                promptTokens: prev.promptTokens + usage.promptTokens,
                                completionTokens: prev.completionTokens + usage.completionTokens
                            }));
                        }
                    });
                    decision = route.mode === 'CHAT' ? 'GENERAL_CONVERSATION' : 'KNOWLEDGE_SEARCH';
                    
                    if (route.mode.startsWith('DEEP_ANALYSIS') && appSettings.enableDeepAnalysisV1) {
                        const { runDeepAnalysis } = await import('../agents/deep_analysis');
                        const level = appSettings.deepAnalysisLevel === 3 || route.mode === 'DEEP_ANALYSIS_L3' ? 3 : 2;
                        const da = await runDeepAnalysis({
                            query, history: newHistoryWithUser, vectorStore: vectorStore.current,
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
                            onTokenUsage: (usage) => {
                                perRequestTokenUsage.promptTokens += usage.promptTokens;
                                perRequestTokenUsage.completionTokens += usage.completionTokens;
                                setTokenUsage(prev => ({
                                    promptTokens: prev.promptTokens + usage.promptTokens,
                                    completionTokens: prev.completionTokens + usage.completionTokens
                                }));
                            }
                        });
                        setChatHistory([...newHistoryWithUser, { role: 'model', content: `${da.finalText}<!--searchResults:${JSON.stringify(da.usedResults)}-->`, tokenUsage: perRequestTokenUsage, elapsedTime: Date.now() - startTime }]);
                        setIsLoading(false);
                        return;
                    }
                } catch (_e) {
                    if (appSettings.isLoggingEnabled) console.warn('[RouterV2] Failed', _e);
                }
            }

            if (decision === 'GENERAL_CONVERSATION') {
                const llmResponse = await callGenerateContent(selectedModel, apiKey, [{ role: 'system', content: getSystemPrompt() }, ...newHistoryWithUser]);
                setChatHistory([...newHistoryWithUser, { role: 'model', content: llmResponse.text || '', tokenUsage: perRequestTokenUsage, elapsedTime: Date.now() - startTime }]);
                setIsLoading(false);
                return;
            }

            const queryEmbeddingPromise = new Promise<number[]>((resolve) => { if (queryEmbeddingResolver) queryEmbeddingResolver.current = resolve; });
            if (coordinator.current) {
                coordinator.current.addJob('Embed Query', [{ id: `query-${Date.now()}`, priority: TaskPriority.P1_Primary, payload: { type: TaskType.EmbedQuery, query } }]);
            }
            const queryEmbedding = await queryEmbeddingPromise;
            
            if (!vectorStore?.current) throw new Error("Vector store not initialized.");
            const searchResults = vectorStore.current.search(queryEmbedding, appSettings.numInitialCandidates);
            
            const requiredDocIds = Array.from(new Set(searchResults.map(c => c.id)));
            await waitForSummaries(requiredDocIds);

            const context = searchResults.slice(0, appSettings.numFinalContextChunks).map((r, i) => `[${i + 1}] File: ${files.find(f => f.id === r.id)?.name || r.id} (ID: ${r.id})\n\n${r.chunk}`).join('\n\n---\n\n');
            const messages: ChatMessage[] = [{ role: 'system', content: getSystemPrompt(requiredDocIds) }, ...history, { role: 'user', content: `CONTEXT:\n---\n${context}\n---\n\nUSER QUESTION: ${query}` }];
            
            const llmResponse = await callGenerateContent(selectedModel, apiKey, messages);
            setChatHistory([...newHistoryWithUser, { role: 'model', content: `${llmResponse.text || ''}<!--searchResults:${JSON.stringify(searchResults)}-->`, tokenUsage: perRequestTokenUsage, elapsedTime: Date.now() - startTime }]);
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('[Chat] Generation aborted by user.');
            } else {
                setChatHistory([...newHistoryWithUser, { role: 'model', content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}` }]);
            }
        } finally {
            setIsLoading(false);
            setAbortController(null);
        }
    }, [isLoading, appSettings, coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver, apiKeys, selectedProvider, selectedModel, setIsLoading, setChatHistory, getSystemPrompt, waitForSummaries, files, setTokenUsage, setAbortController]);

    const handleRedo = useCallback(async (index: number) => {
        const messageToRedo = chatHistory[index];
        if (messageToRedo.role !== 'user' || isLoading || messageToRedo.content === null) return;
        await submitQuery(messageToRedo.content, chatHistory.slice(0, index));
    }, [chatHistory, isLoading, submitQuery]);

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        await submitQuery(userInput, chatHistory);
        setUserInput('');
    }, [userInput, chatHistory, submitQuery, setUserInput]);

    const renderModelMessage = useCallback((content: string | null) => {
        if (!content) return { __html: '' };
        let searchResults: SearchResult[] = [];
        const contentWithoutResults = content.replace(/<!--searchResults:(.*?)-->/, (_, resultsJson) => {
            try { searchResults = JSON.parse(resultsJson); } catch {
                // ignore
            }
            return '';
        });

        const renderer = new marked.Renderer();
        const originalLink = renderer.link.bind(renderer);
        renderer.link = (href, title, text) => {
            const html = originalLink(href, title, text);
            return html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
        };

        const rawHtml = marked.parse(contentWithoutResults, { renderer, gfm: true, breaks: true });
        const docNumbers = new Map<string, number>();
        let nextDocNumber = 1;
        const citationRegex = /\[Source:\s*([^\]]+)\]|\[(\d+)\]/g;
        const finalHtml = (rawHtml as string).replace(citationRegex, (match: string, sourceInside: string, standaloneIndex: string) => {
            const inside = sourceInside || standaloneIndex;
            const tokens = inside.trim().split(',').map((t: string) => t.trim()).filter(Boolean);
            const items = tokens.map((tid: string) => {
                const index = parseInt(tid, 10);
                let sr = (!isNaN(index) && index > 0 && index <= searchResults.length) 
                    ? searchResults[index - 1] 
                    : undefined;
                
                if (!sr) {
                    sr = searchResults.find(r => r.id === tid);
                }

                if (!sr) return `[${tid}]`; // Return original bracketed text if no match found
                if (!docNumbers.has(sr.id)) docNumbers.set(sr.id, nextDocNumber++);
                const docNo = docNumbers.get(sr.id);
                // Store chunk text (escaped) in data-chunk attribute for quick view
                const chunkEscaped = sr.chunk.replace(/"/g, '&quot;');
                return `<button class="source-link citation-bubble" data-file-id="${sr.id}" data-start="${sr.start}" data-end="${sr.end}" data-chunk="${chunkEscaped}" title="Doc #${docNo}"><span>${docNo}</span></button>`;
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
            const start = parseInt(btn.getAttribute('data-start') || '0');
            const end = parseInt(btn.getAttribute('data-end') || '0');
            const chunkText = btn.getAttribute('data-chunk') || '';
            
            const file = files.find(f => f.id === fileId);
            if (file) {
                // By default use the clicked chunk
                let allRelevantChunks: SearchResult[] = [{ id: fileId!, start, end, chunk: chunkText, similarity: 1 }];

                // Find all chunks from the same file in the same message
                const messageContainer = btn.closest('.message-container');
                if (messageContainer) {
                    const messageDocLinks = messageContainer.querySelectorAll(`.source-link[data-file-id="${fileId}"]`);
                    const otherChunks: SearchResult[] = [];
                    messageDocLinks.forEach(link => {
                        const lStart = parseInt(link.getAttribute('data-start') || '0');
                        const lEnd = parseInt(link.getAttribute('data-end') || '0');
                        // Avoid duplication of the clicked chunk
                        if (lStart !== start) {
                            otherChunks.push({ id: fileId!, start: lStart, end: lEnd, chunk: link.getAttribute('data-chunk') || '', similarity: 1 });
                        }
                    });
                    
                    // Sort combined chunks by their document position
                    allRelevantChunks = [...allRelevantChunks, ...otherChunks].sort((a, b) => a.start - b.start);
                }

                setActiveSource({ file, chunks: allRelevantChunks });
                setIsModalOpen(true);
            }
        }
    }, [files, setActiveSource, setIsModalOpen]);

    return {
        userInput, setUserInput,
        chatHistory, setChatHistory,
        tokenUsage, setTokenUsage,
        isLoading, setIsLoading,
        handleRedo, handleSubmit, handleSourceClick, renderModelMessage,
        stopGeneration,
        handleClearConversation: () => clearHistory(initialChatHistory),
        handleRemoveMessage: (idx: number) => setChatHistory(prev => prev.filter((_, i) => i !== idx)),
        pendingQuery, setPendingQuery,
        initialChatHistory
    };
};
