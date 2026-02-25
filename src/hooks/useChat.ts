import { useCallback, useEffect, useState, useMemo } from 'react';
import { marked } from 'marked';
import { AppFile, ChatMessage, JobProgress, Model, SearchResult, TokenUsage, SelectionComment } from '../types';
import { summaryCache } from '../cache/summaryCache';
import { ComputeTask, TaskPriority, TaskType } from '../compute/types';
import { generateContent, Tool, SchemaType, countTokens } from '../api/llm-provider';
import { ComputeCoordinator } from '../compute/coordinator';
import { VectorStore } from '../rag/pipeline';
import { useChatStore, useFileStore, useSettingsStore } from '../store';
import { useCaseFileStore } from '../store/useCaseFileStore';
import { useMapStore } from '../store/useMapStore';
import { useDossierStore } from '../store/useDossierStore';
import { searchWeb } from '../utils/search';
import { sectionizeMessage, createFuzzyRegex } from '../utils/chatUtils';
import { getDossierTools, handleDossierToolCall, DOSSIER_COMPILER_PROMPT } from '../agents/dossier';


const SEARCH_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'search_web',
        description: 'Search the internet for current information, news, or specific data not present in your training knowledge.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                query: {
                    type: SchemaType.STRING,
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
**Do not use any other formatting, brackets (like 【】), or styles.** Just the bracketed source and the unique ID.
Use a separate citation for each piece of information. For example: "The sky is blue [Source: file-id-123]. The grass is green [Source: file-id-456]."
**Do not group sources together.** For example, do not write "The sky is blue and the grass is green [Source: file-id-123, file-id-456]".
If the answer is not in the files or the conversation history, say "I could not find an answer in the provided documents."

FORMATTING RULES:
- You MUST output ONLY pure Markdown.
- DO NOT use HTML tags for formatting (e.g. no <br>, <table>, <td>).
- If creating a table, use strictly Markdown pipe syntax.
- If you need a multiline cell in a table, use a comma or semicolon instead of creating a line break.

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
7. If you use information from the provided document contexts, you MUST cite your sources using the exact format [Source: uniqueId]. **DO NOT use any other brackets like 【】 or unbracketed "Source: ID".**
8. If you use information from web search results, you MUST provide a direct link to the source using standard Markdown format: [Title](URL). Use ONLY the URLs provided in the search results; NEVER hallucinate or guess a URL.
9. NOTE: Today is indeed in the year 2026. Do not be confused if your training data only goes up to a previous year; you are currently operating in 2026 and should accept this as the current date.

{dossier_section}

FORMATTING RULES:
- You MUST output ONLY pure Markdown.
- DO NOT use HTML tags for formatting (e.g. no <br>, <table>, <td>).
- If creating a table, use strictly Markdown pipe syntax.
- If you need a multiline cell in a table, use a comma or semicolon instead of creating a line break.

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
        undo, historyStack,
        userInput, setUserInput,
        pendingQuery, setPendingQuery,
        tokenUsage, setTokenUsage,
        currentContextTokens, setCurrentContextTokens,
        isLoading, setIsLoading,
        abortController, setAbortController,
        clearHistory, updateMessage, truncateHistory,
        saveAndRerun,
        caseFileState, setCaseFileState
    } = useChatStore();

    const { files } = useFileStore();
    const { appSettings, selectedModel, selectedProvider, apiKeys } = useSettingsStore();

    const [summaries, setSummaries] = useState<Record<string, string>>({});
    const [hoveredSelectionId, setHoveredSelectionId] = useState<string | null>(null);

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

        // Inject active dossier info
        const activeDossierId = useDossierStore.getState().activeDossierId;
        const activeDossier = useDossierStore.getState().dossiers.find(d => d.id === activeDossierId);

        if (activeDossier && appSettings.isChatModeEnabled) {
            const caseFileStore = useCaseFileStore.getState();
            let cfContext = '';
            if (caseFileStore.caseFile) {
                cfContext = `\n\n--- CASE FILE CONTEXT ---\n${caseFileStore.caseFile.sections.map((s: any) => `## ${s.title}\n${s.content}`).join('\n\n')}\n--- END CASE FILE ---`;
            }

            const mapStore = useMapStore.getState();
            let mapContext = '';
            if (mapStore.nodes.length > 0 || mapStore.edges.length > 0) {
                mapContext = `\n\n--- INVESTIGATION MAP CONTEXT ---\nThe global map currently tracks ${mapStore.nodes.length} entity nodes and ${mapStore.edges.length} relationship edges.\n--- END MAP ---`;
            }

            const dossierContext = `\n${DOSSIER_COMPILER_PROMPT}\n\nCURRENT ACTIVE DOSSIER ID: ${activeDossier.id}\nDOSSIER SUBJECT: ${activeDossier.title} (${activeDossier.dossierType})${cfContext}${mapContext}`;
            finalPrompt = finalPrompt.replace('{dossier_section}', dossierContext);
        } else {
            finalPrompt = finalPrompt.replace('{dossier_section}', '');
        }

        return finalPrompt;
    }, [summaries, files, appSettings.docOnlyMode, appSettings.isChatModeEnabled]);

    // Update current context tokens
    useEffect(() => {
        const calculateContextTokens = async () => {
            const systemPrompt = getSystemPrompt();
            const apiKey = apiKeys[selectedProvider];

            const messages: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                ...chatHistory,
                { role: 'user', content: userInput || ' ' }
            ];

            const tokens = await countTokens(selectedModel, apiKey, messages);
            setCurrentContextTokens(tokens);
        };

        const timeoutId = setTimeout(calculateContextTokens, 1000); // 1s debounce
        return () => clearTimeout(timeoutId);
    }, [chatHistory, userInput, files, summaries, selectedModel, apiKeys, selectedProvider, getSystemPrompt, setCurrentContextTokens]);

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

    const submitQuery = useCallback(async (query: string, history: ChatMessage[], forceCaseFile: boolean = false, updateIndex?: number) => {
        if (!query.trim() || isLoading || !coordinator?.current) return;
        // If not in chat mode, we MUST have a vector store
        if (!appSettings.isChatModeEnabled && !vectorStore?.current) return;

        const startTime = Date.now();
        const perRequestTokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0 };

        let newHistory: ChatMessage[];
        if (updateIndex !== undefined) {
            newHistory = [...history];
            // We don't add a new user message if we are rewriting
        } else {
            newHistory = [...history, { role: 'user', content: query }];
            setChatHistory(newHistory);
        }

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

            // Prioritize explicit Case File requests
            let isCaseFileMode = forceCaseFile;

            // Handle Case File Feedback Step
            if (caseFileState.isAwaitingFeedback && caseFileState.metadata) {
                const { generateCaseFile, filterVisibleHistory } = await import('../agents/case_file');
                const embedQueryFn = async (q: string) => {
                    const p = new Promise<number[]>((resolve) => { if (queryEmbeddingResolver) queryEmbeddingResolver.current = resolve; });
                    if (coordinator.current) {
                        coordinator.current.addJob('Embed Query', [{ id: `query-${Date.now()}`, priority: TaskPriority.P1_Primary, payload: { type: TaskType.EmbedQuery, query: q } }]);
                    }
                    return await p;
                };

                const da = await generateCaseFile({
                    userFeedback: query,
                    caseFileContext: {
                        initialAnalysis: caseFileState.metadata.initialAnalysis,
                        suggestedQuestions: caseFileState.metadata.suggestedQuestions,
                        visibleHistory: filterVisibleHistory(history)
                    },
                    vectorStore: vectorStore?.current ?? null,
                    model: selectedModel,
                    apiKey,
                    settings: appSettings,
                    embedQuery: embedQueryFn,
                    onTokenUsage: (usage) => {
                        perRequestTokenUsage.promptTokens += usage.promptTokens;
                        perRequestTokenUsage.completionTokens += usage.completionTokens;
                        setTokenUsage(prev => ({
                            promptTokens: prev.promptTokens + usage.promptTokens,
                            completionTokens: prev.completionTokens + usage.completionTokens
                        }));
                    }
                });

                setCaseFileState({ isAwaitingFeedback: false, metadata: undefined });
                setChatHistory([...newHistory, {
                    role: 'model',
                    content: `${da.finalText}<!--searchResults:${JSON.stringify(da.usedResults)}-->`,
                    type: 'case_file_report',
                    tokenUsage: perRequestTokenUsage,
                    elapsedTime: Date.now() - startTime
                }]);
                setIsLoading(false);
                return;
            }

            // If Chat Mode is ON, enable search capabilities (UNLESS we are in Case File mode)
            if (appSettings.isChatModeEnabled && !isCaseFileMode) {
                const currentHistory = [...newHistory];
                const tools = [SEARCH_TOOL, ...getDossierTools()];
                let loopCount = 0;
                const MAX_LOOPS = appSettings.maxSearchLoops;

                while (loopCount < MAX_LOOPS) {
                    if (controller.signal.aborted) return;

                    // Inject warning when near the limit - add to currentHistory so it persists
                    if (loopCount === MAX_LOOPS - 2 && MAX_LOOPS > 2) {
                        currentHistory.push({
                            role: 'system',
                            content: "ATTENTION: You have only 2 search calls remaining. Please make your final searches now if needed, then gather all information and provide your final answer to the user.",
                            isInternal: true
                        });
                    } else if (loopCount === MAX_LOOPS - 1) {
                        currentHistory.push({
                            role: 'system',
                            content: "ATTENTION: This is your LAST search call. After this, you MUST provide your final answer based on all gathered information.",
                            isInternal: true
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
                        const finalMsg: ChatMessage = {
                            role: 'model',
                            content: cleanResponseText,
                            tokenUsage: perRequestTokenUsage,
                            elapsedTime: Date.now() - startTime
                        };
                        if (updateIndex !== undefined) {
                            updateMessage(updateIndex, finalMsg);
                        } else {
                            setChatHistory([...currentHistory, finalMsg]);
                        }
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

                                // ── Map Update Queue ───────────────────────────────────────────────
                                // Forward results to the map's update queue (fire-and-forget; map
                                // may not be open, queue will drain lazily via useMapAI).
                                try {
                                    const { useMapUpdateQueue } = await import('../store/useMapUpdateQueue');
                                    const resultArray = Array.isArray(results) ? results : [results];
                                    if (resultArray.length > 0) {
                                        useMapUpdateQueue.getState().enqueueUpdate(resultArray);
                                    }
                                } catch { /* map store not available – non-fatal */ }
                                // ───────────────────────────────────────────────────────────────────

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
                        } else if (toolCall.function.name === 'update_dossier') {
                            try {
                                const args = JSON.parse(toolCall.function.arguments);
                                console.log(`[Chat] Executing update_dossier for section: "${args.sectionTitle}"`);
                                const result = await handleDossierToolCall(toolCall.function.name, args);
                                const toolOutput = {
                                    role: 'tool' as const,
                                    tool_call_id: toolCall.id,
                                    name: toolCall.function.name,
                                    content: JSON.stringify(result)
                                };
                                currentHistory.push(toolOutput);
                            } catch (_e) {
                                console.error('[Chat] Dossier tool error:', _e);
                                currentHistory.push({
                                    role: 'tool' as const,
                                    tool_call_id: toolCall.id,
                                    name: toolCall.function.name,
                                    content: JSON.stringify({ error: _e instanceof Error ? _e.message : "Dossier update failed" })
                                });
                            }
                        }
                    }

                    loopCount++;
                }

                // Final attempt after reaching limit
                const finalPrompt = "SYSTEM: You have reached the maximum number of searches allowed for this turn. Please synthesize all the information gathered so far (including the web search results above) and provide your final comprehensive answer to the user now.";
                const finalResponse = await callGenerateContent(selectedModel, apiKey, [{ role: 'system' as const, content: getSystemPrompt() }, ...currentHistory, { role: 'user', content: finalPrompt }], []);

                const finalMsg: ChatMessage = {
                    role: 'model',
                    content: finalResponse.text || "I reached my search limit without a final answer.",
                    tokenUsage: perRequestTokenUsage,
                    elapsedTime: Date.now() - startTime
                };
                if (updateIndex !== undefined) {
                    updateMessage(updateIndex, finalMsg);
                } else {
                    setChatHistory([...currentHistory, finalMsg]);
                }
                setIsLoading(false);
                setAbortController(null);
                return;
            }

            let decision = 'GENERAL_CONVERSATION';
            let complexity: 'factoid' | 'overview' | 'synthesis' | 'comparison' | 'reasoning' | 'case_file' | 'unknown' = 'unknown';

            if (!isCaseFileMode) {
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
                        complexity = route.complexity || 'unknown';

                        if (route.mode === 'CASE_FILE') {
                            isCaseFileMode = true;
                        }

                        if (route.mode.startsWith('DEEP_ANALYSIS') && appSettings.enableDeepAnalysisV1) {
                            const { runDeepAnalysis } = await import('../agents/deep_analysis');
                            const level = appSettings.deepAnalysisLevel === 3 || route.mode === 'DEEP_ANALYSIS_L3' ? 3 : 2;
                            const da = await runDeepAnalysis({
                                query, history: newHistory, vectorStore: vectorStore.current,
                                model: selectedModel, apiKey, settings: appSettings, embedQuery: embedQueryFn,
                                rerank: appSettings.isRerankingEnabled ? async (rerankQuery, docs) => {
                                    const tasks: Omit<ComputeTask, 'jobId'>[] = [];
                                    docs.forEach((d, i) => tasks.push({
                                        id: `rerank-${i}`,
                                        priority: TaskPriority.P1_Primary,
                                        payload: {
                                            type: TaskType.Rerank,
                                            query: rerankQuery,
                                            documents: [{ ...d, parentChunkIndex: (d as SearchResult).parentChunkIndex ?? -1 }]
                                        }
                                    }));
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
                            const finalMsg: ChatMessage = { role: 'model', content: `${da.finalText}<!--searchResults:${JSON.stringify(da.usedResults)}-->`, type: 'case_file_report', tokenUsage: perRequestTokenUsage, elapsedTime: Date.now() - startTime };
                            if (updateIndex !== undefined) {
                                updateMessage(updateIndex, finalMsg);
                            } else {
                                setChatHistory([...newHistory, finalMsg]);
                            }
                            setIsLoading(false);
                            return;
                        }
                    } catch (_e) {
                        if (appSettings.isLoggingEnabled) console.warn('[RouterV2] Failed', _e);
                    }
                }

            }

            if (isCaseFileMode) {
                const { analyzeChatForCaseFile } = await import('../agents/case_file');
                const analysis = await analyzeChatForCaseFile({
                    history: newHistory,
                    model: selectedModel,
                    apiKey,
                    onTokenUsage: (usage) => {
                        perRequestTokenUsage.promptTokens += usage.promptTokens;
                        perRequestTokenUsage.completionTokens += usage.completionTokens;
                        setTokenUsage(prev => ({
                            promptTokens: prev.promptTokens + usage.promptTokens,
                            completionTokens: prev.completionTokens + usage.completionTokens
                        }));
                    }
                });

                setCaseFileState({
                    isAwaitingFeedback: true,
                    metadata: {
                        initialAnalysis: analysis.initialAnalysis,
                        suggestedQuestions: analysis.suggestedQuestions
                    }
                });

                const responseText = `I've analyzed our conversation and I'm ready to build an extensive Case File (report) for you.

**Initial Analysis:**
${analysis.initialAnalysis}

To make the report as robust and relevant as possible, please let me know:
${analysis.suggestedQuestions.map(q => `- ${q}`).join('\n')}

Or just tell me what specific aspects you'd like me to focus on.`;

                const finalMsg: ChatMessage = {
                    role: 'model',
                    content: responseText,
                    type: 'case_file_analysis',
                    tokenUsage: perRequestTokenUsage,
                    elapsedTime: Date.now() - startTime
                };
                if (updateIndex !== undefined) {
                    updateMessage(updateIndex, finalMsg);
                } else {
                    setChatHistory([...newHistory, finalMsg]);
                }
                setIsLoading(false);
                return;
            }

            if (decision === 'GENERAL_CONVERSATION') {
                const llmResponse = await callGenerateContent(selectedModel, apiKey, [{ role: 'system', content: getSystemPrompt() }, ...newHistory]);
                const finalMsg: ChatMessage = { role: 'model', content: llmResponse.text || '', tokenUsage: perRequestTokenUsage, elapsedTime: Date.now() - startTime };
                if (updateIndex !== undefined) {
                    updateMessage(updateIndex, finalMsg);
                } else {
                    setChatHistory([...newHistory, finalMsg]);
                }
                setIsLoading(false);
                return;
            }

            const queryEmbeddingPromise = new Promise<number[]>((resolve) => { if (queryEmbeddingResolver) queryEmbeddingResolver.current = resolve; });
            if (coordinator.current) {
                coordinator.current.addJob('Embed Query', [{ id: `query-${Date.now()}`, priority: TaskPriority.P1_Primary, payload: { type: TaskType.EmbedQuery, query } }]);
            }
            const queryEmbedding = await queryEmbeddingPromise;

            if (!vectorStore?.current) throw new Error("Vector store not initialized.");

            // DIAGNOSTIC LOGGING & DYNAMIC WINDOW
            const initialCandidates = vectorStore.current.search(queryEmbedding, appSettings.numInitialCandidates);

            let finalChunkCount = appSettings.numFinalContextChunks;
            if (complexity === 'overview' || complexity === 'synthesis') {
                finalChunkCount = Math.min(20, finalChunkCount * 2);
            }

            const searchResults = initialCandidates.slice(0, finalChunkCount);

            if (appSettings.isLoggingEnabled) {
                const maxSim = searchResults.length > 0 ? searchResults[0].similarity : 0;
                console.log(`[RAG DEBUG] Complexity: ${complexity}, Chunks Requested: ${finalChunkCount}, Chunks Found: ${searchResults.length}, Max Similarity: ${maxSim.toFixed(4)}`);
            }

            if (searchResults.length === 0 && files.length > 0) {
                const finalMsg: ChatMessage = {
                    role: 'model',
                    content: `I couldn't find any relevant information in your documents for this query. The search threshold might be too restrictive, or the documents may not contain the answer.`,
                    tokenUsage: perRequestTokenUsage,
                    elapsedTime: Date.now() - startTime
                };
                if (updateIndex !== undefined) {
                    updateMessage(updateIndex, finalMsg);
                } else {
                    setChatHistory([...newHistory, finalMsg]);
                }
                setIsLoading(false);
                return;
            }

            const requiredDocIds = Array.from(new Set(searchResults.map(c => c.id)));
            await waitForSummaries(requiredDocIds);

            const context = searchResults.map((r, i) => `[${i + 1}] File: ${files.find(f => f.id === r.id)?.name || r.id} (ID: ${r.id})\n\n${r.chunk}`).join('\n\n---\n\n');
            const messages: ChatMessage[] = [{ role: 'system', content: getSystemPrompt(requiredDocIds) }, ...history, { role: 'user', content: `CONTEXT:\n---\n${context}\n---\n\nUSER QUESTION: ${query}` }];

            const llmResponse = await callGenerateContent(selectedModel, apiKey, messages);
            const finalMsg: ChatMessage = { role: 'model', content: `${llmResponse.text || ''}<!--searchResults:${JSON.stringify(searchResults)}-->`, tokenUsage: perRequestTokenUsage, elapsedTime: Date.now() - startTime };
            if (updateIndex !== undefined) {
                updateMessage(updateIndex, finalMsg);
            } else {
                setChatHistory([...newHistory, finalMsg]);
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('[Chat] Generation aborted by user.');
            } else {
                const errorMsg: ChatMessage = { role: 'model', content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}` };
                if (updateIndex !== undefined) {
                    updateMessage(updateIndex, errorMsg);
                } else {
                    setChatHistory([...newHistory, errorMsg]);
                }
            }
        } finally {
            setIsLoading(false);
            setAbortController(null);
        }
    }, [isLoading, appSettings, coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver, apiKeys, selectedProvider, selectedModel, setIsLoading, setChatHistory, getSystemPrompt, waitForSummaries, files, setTokenUsage, setAbortController, caseFileState, setCaseFileState, updateMessage]);

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

    const renderModelMessage = useCallback((content: string | null, fullContent?: string | null, selectionComments?: SelectionComment[], hoveredSelectionId?: string | null) => {
        if (!content) return { __html: '' };
        let searchResults: SearchResult[] = [];

        // Use full content to extract search results if available
        const contextForResults = fullContent || content;
        contextForResults.replace(/<!--searchResults:(.*?)-->/, (_, resultsJson) => {
            try { searchResults = JSON.parse(resultsJson); } catch {
                // ignore
            }
            return '';
        });

        // Strip results from current content if they are there
        const contentWithoutResults = content.replace(/<!--searchResults:(.*?)-->/, '');

        const renderer = new marked.Renderer();
        const originalLink = renderer.link.bind(renderer);
        renderer.link = (href, title, text) => {
            const html = originalLink(href, title, text);
            return html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
        };

        const rawHtml = marked.parse(contentWithoutResults, { renderer, gfm: true, breaks: true }) as string;
        const docNumbers = new Map<string, number>();
        let nextDocNumber = 1;

        // Robust regex to handle variations: [Source: ID], [ID], 【Source: ID】, 【ID】, and unbracketed Source: ID
        const citationRegex = /\[Source:\s*([^\]]+)\]|\[(\d+)\]|【Source:\s*([^】]+)】|【(\d+)】|\bSource:\s*([\w.-]+_\d+_\d+)\b/gi;

        let finalHtml = rawHtml.replace(citationRegex, (match, g1, g2, g3, g4, g5) => {
            const inside = (g1 || g2 || g3 || g4 || g5) as string;
            if (!inside) return match;

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
                return `<button class="source-link citation-bubble" data-file-id="${sr.id}" data-start="${sr.start}" data-end="${sr.end}" data-parent-index="${sr.parentChunkIndex}" data-chunk="${chunkEscaped}" title="Doc #${docNo}"><span>${docNo}</span></button>`;
            }).join('');
            return items ? `<span class="citation-group">${items}</span>` : match;
        });

        // Handle selection highlights (Surgical approach: replace text with <mark> if it doesn't break HTML tags)
        if (selectionComments && selectionComments.length > 0) {
            selectionComments.forEach(sc => {
                if (!sc.text) return;
                const isHovered = hoveredSelectionId === sc.id;

                try {
                    const regex = createFuzzyRegex(sc.text, 'html');
                    finalHtml = finalHtml.replace(regex, (match) => {
                        let processedCount = 0;
                        return match.replace(/(^|>)([^<]+)(<|$)/g, (m, p1, text, p3) => {
                            if (!text.trim()) return m; // don't wrap whitespace outside tags
                            const isFirst = processedCount === 0;
                            processedCount++;
                            const tooltipHtml = isFirst ? `<span class="inline-review-tooltip"><div class="inline-review-header">Selection Review:</div>${sc.comment}</span>` : '';
                            return `${p1}<mark class="inline-review-mark ${isHovered ? 'active-hover' : ''}" data-selection-id="${sc.id}" data-comment-id="${sc.id}">${text}${tooltipHtml}</mark>${p3}`;
                        });
                    });
                } catch (e) {
                    console.error("Fuzzy highlight regex failed for text:", sc.text, e);
                }
            });
        }

        return { __html: finalHtml };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hoveredSelectionId]);

    const handleSourceClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        const btn = target.closest('button.source-link');
        if (btn) {
            const fileId = btn.getAttribute('data-file-id');
            const start = parseInt(btn.getAttribute('data-start') || '0');
            const end = parseInt(btn.getAttribute('data-end') || '0');
            const parentIndex = parseInt(btn.getAttribute('data-parent-index') || '-1');
            const chunkText = btn.getAttribute('data-chunk') || '';

            const file = files.find(f => f.id === fileId);
            if (file) {
                // By default use the clicked chunk
                let allRelevantChunks: SearchResult[] = [{ id: fileId!, start, end, parentChunkIndex: parentIndex, chunk: chunkText, similarity: 1 }];

                // Find all chunks from the same file in the same message
                const messageContainer = btn.closest('.message-container');
                if (messageContainer) {
                    const messageDocLinks = messageContainer.querySelectorAll(`.source-link[data-file-id="${fileId}"]`);
                    const otherChunks: SearchResult[] = [];
                    messageDocLinks.forEach(link => {
                        const lStart = parseInt(link.getAttribute('data-start') || '0');
                        const lEnd = parseInt(link.getAttribute('data-end') || '0');
                        const lParentIndex = parseInt(link.getAttribute('data-parent-index') || '-1');
                        const lChunk = link.getAttribute('data-chunk') || '';
                        // Avoid duplication of the clicked chunk
                        if (lStart !== start) {
                            otherChunks.push({ id: fileId!, start: lStart, end: lEnd, parentChunkIndex: lParentIndex, chunk: lChunk, similarity: 1 });
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

    const resendWithComments = useCallback(async (index: number) => {
        const msg = chatHistory[index];
        if (!msg || isLoading || !coordinator?.current) return;

        const sections = msg.sections || sectionizeMessage(msg.content || '');

        // ── Build comment blocks ─────────────────────────────────────────────

        const sectionCommentBlocks = sections
            .filter(s => s.comment)
            .map(s => `Section Comment (ID: ${s.id}): ${s.comment}`)
            .join('\n');

        const selectionCommentBlocks = (msg.selectionComments || []).map(sc => {
            const section = sections.find(s => s.id === sc.sectionId);
            const sectionContent = section?.content ?? '';

            return [
                `SELECTION COMMENT (sectionId: ${sc.sectionId}):`,
                `The user highlighted this text in the section:`,
                `"${sc.text.trim()}"`,
                `Comment: ${sc.comment}`,
                `Full current section content (for reference):`,
                '```',
                sectionContent,
                '```'
            ].join('\n');
        }).join('\n\n');

        const allComments = [sectionCommentBlocks, selectionCommentBlocks].filter(Boolean).join('\n\n');
        if (!allComments) return;

        setIsLoading(true);
        const apiKey = apiKeys[selectedProvider];
        const controller = new AbortController();
        setAbortController(controller);

        try {
            const systemPrompt = `You are editing your previous response based on specific user comments.
The previous message has been split into [Section ID: sec-N] blocks for reference.

EDITING PROTOCOL:
Return ONLY a JSON array of edit objects. No prose, no markdown fences around the outer array.

For EVERY comment (whether it is a section-level comment or a selection comment about a highlighted fragment):
  {"sectionId":"sec-N","newContent":"...COMPLETE rewritten section text..."}

CRITICAL RULES:
- "newContent" MUST contain the ENTIRE rewritten section — not just the changed fragment.
- When a comment references a highlighted selection, use that as context to know WHAT to change,
  but output the FULL rewritten section in "newContent".
- Output ONLY pure Markdown in newContent values.
- No HTML tags. Tables must use | pipe syntax.
- If a table cell needs multiple lines of content, use <br> to separate them within the cell.`;

            const formattedContent = sections.map(s => `[Section ID: ${s.id}]\n${s.content}`).join('\n\n');
            const userPrompt = `Here are my remarks:\n\n${allComments}\n\nReturn the JSON edit array.`;

            const messages: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                ...chatHistory.slice(0, index),
                { role: 'model', content: formattedContent },
                { role: 'user', content: userPrompt }
            ];

            const response = await generateContent(selectedModel, apiKey, messages, [], controller.signal);
            const text = response.text || '';

            if (text.startsWith('FULL_REWRITE_REQUEST:')) {
                updateMessage(index, {
                    pendingEdits: [{ sectionId: 'REWRITE', newContent: text.replace('FULL_REWRITE_REQUEST:', '').trim() }]
                });
            } else {
                const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
                if (jsonMatch) {
                    const diffs = JSON.parse(jsonMatch[0]);
                    updateMessage(index, { pendingEdits: diffs });
                } else {
                    console.error('[resendWithComments] Could not parse JSON diffs from response:', text);
                }
            }
        } catch (error) {
            console.error('[resendWithComments] Failed:', error);
        } finally {
            setIsLoading(false);
            setAbortController(null);
        }
    }, [chatHistory, isLoading, coordinator, apiKeys, selectedProvider, selectedModel, setIsLoading, setAbortController, updateMessage]);

    /**
     * Resolves a case file comment using the LLM.
     * - Assembles context: full chat history + full case file text + the comment instruction.
     * - Respects isChatModeEnabled / caseFileInternetSearch for web search.
     * - On success: calls resolveCommentFn(sectionId, newContent) to update the case file.
     * - On failure (bad parse / bad sectionId): appends the raw LLM response to chat.
     */
    const submitCaseFileComment = useCallback(async (
        caseFile: import('../types').CaseFile,
        sectionId: string,
        comment: import('../types').CaseFileComment,
        resolveCommentFn: (sId: string, commentId: string, newContent: string) => void
    ) => {
        if (!coordinator?.current) return;

        const apiKey = apiKeys[selectedProvider];
        setIsLoading(true);
        const controller = new AbortController();
        setAbortController(controller);
        const perRequestTokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0 };

        const callGen = async (messages: ChatMessage[], tools?: Tool[]) => {
            const response = await generateContent(selectedModel, apiKey, messages, tools, controller.signal);
            const { promptTokens, completionTokens } = response.usage;
            perRequestTokenUsage.promptTokens += promptTokens;
            perRequestTokenUsage.completionTokens += completionTokens;
            setTokenUsage(prev => ({
                promptTokens: prev.promptTokens + promptTokens,
                completionTokens: prev.completionTokens + completionTokens
            }));
            return response;
        };

        // ── Build case file context ──────────────────────────────────────────
        const caseFileText = caseFile.sections
            .map(s => `[Section ID: ${s.id}]${s.title ? ` (${s.title})` : ''}\n${s.content}`)
            .join('\n\n');

        const systemPrompt = `You are editing a Case File document based on a user comment.

CASE FILE CONTENT:
${caseFileText}

EDITING PROTOCOL:
Return ONLY a JSON object with this exact shape (no prose, no fences):
{"sectionId":"<id>","newContent":"<complete rewritten section markdown>"}

CRITICAL RULES:
- "newContent" MUST contain the ENTIRE rewritten section — not just the changed fragment.
- The highlighted selection is context to understand WHAT to change, but output the FULL section.
- Output ONLY pure Markdown in newContent values. No HTML tags.
- If you need to search the web for additional information, you MAY use the search_web tool.
- Return the JSON when you have all the information you need.`;

        const userPrompt = `Rewrite section "${sectionId}" of the case file.\nUser highlighted: "${comment.selectedText}"\nInstruction: ${comment.instruction}\n\nReturn the JSON.`;

        const visibleHistory = chatHistory.filter(m => !m.isInternal);
        const messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            ...visibleHistory,
            { role: 'user', content: userPrompt }
        ];

        try {
            const useSearch = appSettings.caseFileInternetSearch && appSettings.isChatModeEnabled;
            const tools = useSearch ? [SEARCH_TOOL] : [];
            const currentMessages = [...messages];
            let loopCount = 0;
            const MAX_LOOPS = useSearch ? appSettings.maxSearchLoops : 1;
            let finalText = '';

            while (loopCount < MAX_LOOPS) {
                if (controller.signal.aborted) return;

                const response = await callGen(currentMessages, useSearch ? tools : []);
                const toolCalls = response.toolCalls || [];
                const responseText = response.text || '';

                // If no tool calls → this is the final answer
                if (toolCalls.length === 0) {
                    finalText = responseText;
                    break;
                }

                // Handle search tool calls
                const assistantMsg: ChatMessage = { role: 'model', content: responseText || null, tool_calls: toolCalls };
                currentMessages.push(assistantMsg);

                for (const tc of toolCalls) {
                    if (controller.signal.aborted) return;
                    if (tc.function.name === 'search_web') {
                        try {
                            const args = JSON.parse(tc.function.arguments);
                            const results = await searchWeb(args.query || args.search || tc.function.arguments);
                            currentMessages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(results) });
                        } catch {
                            currentMessages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify({ error: 'Search failed' }) });
                        }
                    }
                }
                loopCount++;
            }

            // If loop ended without a text answer, do a final synthesis call
            if (!finalText && loopCount >= MAX_LOOPS) {
                const synthResponse = await callGen([
                    ...currentMessages,
                    { role: 'user', content: 'Now return the final JSON with the rewritten section.' }
                ], []);
                finalText = synthResponse.text || '';
            }

            // ── Parse the JSON envelope ─────────────────────────────────────
            const { tryReplaceSection } = await import('../utils/caseFileUtils');
            let parsed: { sectionId: string; newContent: string } | null = null;

            // Strip potential markdown fences
            const stripped = finalText.replace(/^```[\w]*\n?|\n?```$/g, '').trim();

            const jsonMatch = stripped.match(/\{[\s\S]*"sectionId"[\s\S]*\}/);
            if (jsonMatch) {
                try { parsed = JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
            }

            if (parsed && parsed.sectionId && parsed.newContent) {
                const result = tryReplaceSection(caseFile, parsed.sectionId, parsed.newContent);
                if (result.ok) {
                    resolveCommentFn(parsed.sectionId, comment.id, parsed.newContent);
                } else {
                    // Section ID mismatch → append to chat
                    setChatHistory(prev => [...prev, {
                        role: 'model',
                        content: `⚠️ **Case File replacement failed** (section not found).\n\nThe LLM produced the following content (not lost):\n\n${parsed!.newContent}`,
                        tokenUsage: perRequestTokenUsage
                    }]);
                }
            } else {
                // Could not parse JSON → append raw response to chat
                setChatHistory(prev => [...prev, {
                    role: 'model',
                    content: `⚠️ **Case File comment could not be applied** — LLM returned unstructured content (appended here so it is not lost):\n\n${finalText}`,
                    tokenUsage: perRequestTokenUsage
                }]);
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('[CaseFile] LLM aborted.');
            } else {
                setChatHistory(prev => [...prev, {
                    role: 'model',
                    content: `Sorry, an error occurred while resolving the case file comment: ${error instanceof Error ? error.message : 'Unknown error'}`
                }]);
            }
        } finally {
            setIsLoading(false);
            setAbortController(null);
        }
    }, [chatHistory, appSettings, coordinator, apiKeys, selectedProvider, selectedModel, setIsLoading, setChatHistory, setTokenUsage, setAbortController]);

    return {
        userInput, setUserInput,
        chatHistory, setChatHistory,
        undo, historyStack,
        tokenUsage, setTokenUsage,
        currentContextTokens, setCurrentContextTokens,
        isLoading, setIsLoading,
        submitQuery, resendWithComments, submitCaseFileComment,
        handleRedo, handleSubmit, handleSourceClick, renderModelMessage,
        stopGeneration,
        handleClearConversation: () => clearHistory(initialChatHistory),
        handleRemoveMessage: (idx: number) => setChatHistory(prev => prev.filter((_, i) => i !== idx)),
        handleUpdateMessage: updateMessage,
        handleTruncateHistory: truncateHistory,
        handleSaveAndRerun: saveAndRerun,
        pendingQuery, setPendingQuery,
        initialChatHistory,
        caseFileState, setCaseFileState,
        hoveredSelectionId, setHoveredSelectionId
    };
};
