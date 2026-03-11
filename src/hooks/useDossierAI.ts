// src/hooks/useDossierAI.ts
// KB update pipeline: RAG search + paged chat context + optional web search follow-up.

import { useCallback } from 'react';
import { useSettingsStore } from '../store';
import { useDossierStore } from '../store/useDossierStore';
import { useMapStore } from '../store/useMapStore';
import { useToastStore } from '../store/useToastStore';
import { generateContent, Tool, SchemaType } from '../api/llm-provider';
import { getDossierTools, handleDossierToolCall, DOSSIER_COMPILER_PROMPT } from '../agents/dossier';
import { VectorStore } from '../rag/pipeline';
import { ComputeCoordinator } from '../compute/coordinator';
import { TaskPriority, TaskType } from '../compute/types';
import { ChatMessage } from '../types';
import { getPagedChatContext, formatChatContextBlock } from '../utils/chatContext';
import { searchWeb } from '../utils/search';

// ── Constants ─────────────────────────────────────────────────────────────────
const KB_PAGE_SIZE = 20;  // bubbles per chat context page
const KB_MAX_PAGES = 3;   // look back up to 3 pages if first page has few results
const KB_RAG_K = 12;      // top-K chunks to retrieve from embedded docs
const KB_MAX_WEB_LOOPS = 3; // max web-search rounds when kbWebSearchEnabled

const WEB_SEARCH_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'search_web',
        description: 'Search the internet for supplementary facts. Use ONLY after exhausting the provided embedded document and chat context. Never use this as a primary source.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                query: {
                    type: SchemaType.STRING,
                    description: 'The specific, targeted verification query to perform.',
                },
            },
            required: ['query'],
        },
    },
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface DossierAIRefs {
    vectorStore: React.MutableRefObject<VectorStore | null> | null;
    coordinator: React.MutableRefObject<ComputeCoordinator | null> | null;
    queryEmbeddingResolver: React.MutableRefObject<((value: number[]) => void) | null>;
    chatHistory: ChatMessage[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Embeds a query string using the coordinator's embedding pipeline.
 * Returns null if the coordinator or resolver is not available.
 */
async function embedQuery(
    query: string,
    coordinator: ComputeCoordinator,
    queryEmbeddingResolver: React.MutableRefObject<((value: number[]) => void) | null>
): Promise<number[] | null> {
    try {
        const promise = new Promise<number[]>((resolve) => {
            queryEmbeddingResolver.current = resolve;
        });
        coordinator.addJob('KB Embed Query', [{
            id: `kb-query-${Date.now()}`,
            priority: TaskPriority.P1_Primary,
            payload: { type: TaskType.EmbedQuery, query }
        }]);
        return await promise;
    } catch {
        return null;
    }
}

/**
 * Retrieves RAG context from the vector store for a given subject.
 * Returns a formatted string block ready for injection into the system prompt.
 */
async function buildRagContext(
    subject: string,
    vectorStore: VectorStore,
    coordinator: ComputeCoordinator,
    queryEmbeddingResolver: React.MutableRefObject<((value: number[]) => void) | null>
): Promise<{ contextBlock: string; docIds: string[]; results: import('../types').SearchResult[] }> {
    const embedding = await embedQuery(subject, coordinator, queryEmbeddingResolver);
    if (!embedding) return { contextBlock: '', docIds: [], results: [] };

    const results = vectorStore.search(embedding, KB_RAG_K);
    if (results.length === 0) return { contextBlock: '', docIds: [], results: [] };

    const docIds = Array.from(new Set(results.map(r => r.id)));
    const contextBlock = results
        .map((r, i) => `[#${i + 1}] id:${r.id}\n${r.chunk}`)
        .join('\n\n---\n\n');

    return { contextBlock, docIds, results };
}

/**
 * Builds paged chat context by scanning backwards through pages.
 * Always scans all configured pages (KB_MAX_PAGES) to ensure that
 * case file reports further back in history are not missed.
 */
function buildChatContext(history: ChatMessage[], loggingEnabled = false): string {
    let combinedMessages: ChatMessage[] = [];

    for (let page = 0; page < KB_MAX_PAGES; page++) {
        const pageMessages = getPagedChatContext(history, KB_PAGE_SIZE, page);
        if (pageMessages.length === 0) break;
        // Prepend each older page so result is in chronological order
        combinedMessages = [...pageMessages, ...combinedMessages];
    }

    if (loggingEnabled) {
        const priorityCount = combinedMessages.filter(
            m => m.type === 'case_file_report' || m.type === 'case_file_analysis'
        ).length;
        console.log(`[DossierAI] buildChatContext: ${combinedMessages.length} messages collected, ${priorityCount} case file report(s) found`);
    }

    return formatChatContextBlock(combinedMessages);
}


/**
 * Assembles the full system prompt for a KB (dossier) update, injecting
 * RAG results and chat context ahead of the standard DOSSIER_COMPILER_PROMPT.
 */
function buildKbSystemPrompt(opts: {
    dossierId: string;
    subject: string;
    ragContextBlock: string;
    chatContextBlock: string;
    mapContext: string;
    kbWebSearchEnabled: boolean;
    existingContent?: string;
}): string {
    const { dossierId, subject, ragContextBlock, chatContextBlock, mapContext, kbWebSearchEnabled, existingContent } = opts;

    const ragSection = ragContextBlock
        ? `\n\n--- EMBEDDED DOC CONTEXT (from knowledge base) ---\n${ragContextBlock}\n--- END EMBEDDED DOC CONTEXT ---`
        : '\n\n[No embedded documents found for this subject in the knowledge base.]';

    const chatSection = chatContextBlock
        ? `\n\n--- RECENT CHAT CONTEXT (last conversation turns, including case files) ---\n${chatContextBlock}\n--- END CHAT CONTEXT ---`
        : '\n\n[No relevant chat context found.]';

    const existingSection = existingContent
        ? `\n\n--- CURRENT DOSSIER CONTENT (to update/extend, not replace blindly) ---\n${existingContent}\n--- END CURRENT DOSSIER CONTENT ---`
        : '';

    const webSearchNote = kbWebSearchEnabled
        ? '\n\nWEB SEARCH: You have access to \'search_web\'. Use it ONLY as a follow-up to verify specific gaps — AFTER exhausting the embedded documents and chat context above. Never use it as a primary research source.'
        : '\n\nWEB SEARCH: DISABLED. You must answer strictly from the EMBEDDED DOC CONTEXT and RECENT CHAT CONTEXT provided above. Do not use training knowledge to fill gaps.';

    return `${DOSSIER_COMPILER_PROMPT}

CURRENT ACTIVE DOSSIER ID: ${dossierId}
DOSSIER SUBJECT: ${subject}
${webSearchNote}${ragSection}${chatSection}${existingSection}${mapContext}

INSTRUCTION: Use 'update_dossier' to populate dossier sections. Base all content on the EMBEDDED DOC CONTEXT and RECENT CHAT CONTEXT above. DO NOT use general training knowledge to fill gaps — if context is missing, say so explicitly in the section content.`;
}

// ── Main Hook ─────────────────────────────────────────────────────────────────

export const useDossierAI = (refs?: DossierAIRefs) => {
    const { selectedModel, selectedProvider, apiKeys, appSettings } = useSettingsStore();
    const { addToast } = useToastStore();

    /**
     * Generates or regenerates a contextual dossier for a given subject.
     * Uses RAG + paged chat context as primary sources. Web search is optional follow-up.
     */
    const generateContextualDossier = useCallback(async (subject: string, existingDossierId?: string, linkedMapNodeId?: string) => {
        if (!subject.trim()) {
            addToast("Dossier creation request unsuccessful - no text selected", "error", 1500);
            return;
        }

        const apiKey = apiKeys[selectedProvider];
        if (!apiKey) {
            addToast("Dossier creation failed: No API key set.", "error", 2000);
            return;
        }

        // ── Map context ───────────────────────────────────────────────────────
        const mapStore = useMapStore.getState();
        let mapContext = '';
        if (mapStore.nodes.length > 0 || mapStore.edges.length > 0) {
            mapContext = `\n\n--- INVESTIGATION MAP CONTEXT ---\nThe global map currently tracks ${mapStore.nodes.length} entity nodes and ${mapStore.edges.length} relationship edges.\n--- END MAP ---`;
        }

        // ── Determine dossier title ───────────────────────────────────────────
        let dossierTitle = subject;
        if (subject.length > 30) {
            try {
                const titleResponse = await generateContent(selectedModel, apiKey, [
                    { role: 'system', content: 'You are a highly concise assistant. Extract a brief 3-5 word title for the provided text. Return ONLY the title.' },
                    { role: 'user', content: subject }
                ]);
                if (titleResponse.text?.trim()) {
                    dossierTitle = titleResponse.text.replace(/['"]/g, '').trim();
                } else {
                    dossierTitle = subject.substring(0, 30) + '...';
                }
            } catch {
                dossierTitle = subject.substring(0, 30) + '...';
            }
        }

        // ── Mint dossier ──────────────────────────────────────────────────────
        const store = useDossierStore.getState();
        let newDossierId = existingDossierId;
        if (!newDossierId) {
            newDossierId = store.createDossier(dossierTitle, 'custom');
        } else {
            store.clearDossierSections(newDossierId);
        }

        if (linkedMapNodeId) {
            store.linkDossierToMapNode(newDossierId, linkedMapNodeId);
        }

        addToast(`Dossier for "${dossierTitle}" under creation`, "info", 1500);

        try {
            // ── Phase 1: Build RAG context from embedded documents ────────────
            let ragContextBlock = '';
            let docIds: string[] = [];
            let ragResults: import('../types').SearchResult[] = [];
            if (refs?.vectorStore?.current && refs.coordinator?.current && refs.queryEmbeddingResolver) {
                const rag = await buildRagContext(subject, refs.vectorStore.current, refs.coordinator.current, refs.queryEmbeddingResolver);
                ragContextBlock = rag.contextBlock;
                docIds = rag.docIds;
                ragResults = rag.results;
                if (appSettings.isLoggingEnabled) {
                    console.log(`[DossierAI] RAG retrieved ${docIds.length} unique docs for "${subject}"`);
                }
            }

            // ── Phase 2: Build paged chat context ─────────────────────────────
            const chatContextBlock = refs?.chatHistory?.length
                ? buildChatContext(refs.chatHistory, appSettings.isLoggingEnabled)
                : '';

            if (appSettings.isLoggingEnabled) {
                console.log(`[DossierAI] Chat context: ${chatContextBlock.length} chars, RAG context: ${ragContextBlock.length} chars`);
            }

            // ── Phase 3: Build system prompt ──────────────────────────────────
            const systemPrompt = buildKbSystemPrompt({
                dossierId: newDossierId,
                subject,
                ragContextBlock,
                chatContextBlock,
                mapContext,
                kbWebSearchEnabled: appSettings.kbWebSearchEnabled,
            });

            // ── Phase 4: Tool setup ───────────────────────────────────────────
            const tools: Tool[] = [
                ...getDossierTools(),
                ...(appSettings.kbWebSearchEnabled ? [WEB_SEARCH_TOOL] : [])
            ];

            // ── Phase 5: Agentic loop (tool calls + optional web search) ──────
            const currentHistory: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Create a comprehensive dossier for "${subject}".` }
            ];

            let loopCount = 0;
            const MAX_LOOPS = appSettings.kbWebSearchEnabled ? KB_MAX_WEB_LOOPS + 1 : 2;
            let toolCallsMade = false;

            while (loopCount < MAX_LOOPS) {
                const response = await generateContent(selectedModel, apiKey, currentHistory, tools);

                const toolCalls = response.toolCalls || [];

                // No tool calls → LLM gave a text response, stop
                if (toolCalls.length === 0) break;

                // Push assistant turn
                currentHistory.push({
                    role: 'model',
                    content: response.text || null,
                    tool_calls: toolCalls
                });

                // Execute each tool call
                for (const tc of toolCalls) {
                    if (tc.function.name === 'update_dossier') {
                        const args = JSON.parse(tc.function.arguments);

                        // ── Auto-Attach Missing Sources ───────────────────────
                        // If the LLM uses [1], [2] in content but misses sources, auto-fill them.
                        const citedIndices = Array.from(args.content.matchAll(/\[(\d+)\]/g))
                            .map(m => parseInt((m as any)[1], 10))
                            .filter(idx => idx > 0 && idx <= ragResults.length);
                        
                        const normalizedSources: import('../types').DossierSource[] = args.sources ? args.sources : [];
                        for (const idx of citedIndices) {
                            const res = ragResults[idx - 1];
                            const alreadyExists = normalizedSources.some(s => s.fileId === res.id);
                            if (!alreadyExists) {
                                normalizedSources.push({
                                    type: 'document',
                                    label: res.id.split('/').pop() || res.id,
                                    fileId: res.id,
                                    snippet: res.chunk
                                });
                            }
                        }
                        args.sources = normalizedSources;

                        await handleDossierToolCall(tc.function.name, args);
                        toolCallsMade = true;
                        currentHistory.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            name: tc.function.name,
                            content: JSON.stringify({ result: `Updated section "${args.sectionTitle}"` })
                        });
                    } else if (tc.function.name === 'search_web' && appSettings.kbWebSearchEnabled) {
                        try {
                            const args = JSON.parse(tc.function.arguments) as { query: string };
                            if (appSettings.isLoggingEnabled) {
                                console.log(`[DossierAI] KB web search follow-up: "${args.query}"`);
                            }
                            const results = await searchWeb(args.query);
                            currentHistory.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                name: tc.function.name,
                                content: JSON.stringify(results)
                            });
                        } catch (e) {
                            currentHistory.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                name: tc.function.name,
                                content: JSON.stringify({ error: e instanceof Error ? e.message : 'Search failed' })
                            });
                        }
                    }
                }

                loopCount++;
            }

            if (toolCallsMade) {
                addToast(`Dossier for "${dossierTitle}" was created`, "success", 1500);
            } else {
                addToast(`Dossier creation unsuccessful - no data returned for "${dossierTitle}"`, "error", 2000);
            }
        } catch (error) {
            console.error(`[DossierAI] Failed to compile dossier for ${subject}:`, error);
            addToast(`Dossier creation unsuccessful - error occurred.`, "error", 2000);
        }
    }, [selectedModel, selectedProvider, apiKeys, appSettings, addToast, refs]);

    /**
     * Chat-style dossier editing: instructs the LLM to modify specific sections.
     * Uses RAG + paged chat context. Web search optional.
     */
    const chatWithDossier = useCallback(async (dossierId: string, instruction: string) => {
        const apiKey = apiKeys[selectedProvider];
        if (!apiKey) {
            addToast("Dossier edit failed: No API key set.", "error", 2000);
            return { didEdit: false, text: "No API key set." };
        }

        const store = useDossierStore.getState();
        const dossier = store.dossiers.find(d => d.id === dossierId);
        if (!dossier) return { didEdit: false, text: "Dossier not found." };

        const existingContent = dossier.sections.map(s => `## ${s.title}\n${s.content}`).join('\n\n');

        // ── Build RAG context for the instruction ───────────────────────────────
        let ragContextBlock = '';
        let ragResults: import('../types').SearchResult[] = [];
        if (refs?.vectorStore?.current && refs.coordinator?.current && refs.queryEmbeddingResolver) {
            const rag = await buildRagContext(
                `${dossier.title} ${instruction}`,
                refs.vectorStore.current,
                refs.coordinator.current,
                refs.queryEmbeddingResolver
            );
            ragContextBlock = rag.contextBlock;
            ragResults = rag.results;
        }

        // ── Build paged chat context ─────────────────────────────────────────────
        const chatContextBlock = refs?.chatHistory?.length
            ? buildChatContext(refs.chatHistory, appSettings.isLoggingEnabled)
            : '';

        // ── Build system prompt ───────────────────────────────────────────────────
        const systemPrompt = buildKbSystemPrompt({
            dossierId: dossier.id,
            subject: dossier.title,
            ragContextBlock,
            chatContextBlock,
            mapContext: '',
            kbWebSearchEnabled: appSettings.kbWebSearchEnabled,
            existingContent
        }) + '\n\nINSTRUCTION: The user is requesting modifications or clarifications. Use \'update_dossier\' to make edits. If you need clarification before making edits, respond with conversational text. DO NOT claim you have updated unless you actually called the tool.';

        // ── Agentic loop ──────────────────────────────────────────────────────────
        const tools: Tool[] = [
            ...getDossierTools(),
            ...(appSettings.kbWebSearchEnabled ? [WEB_SEARCH_TOOL] : [])
        ];

        const currentHistory: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: instruction }
        ];

        try {
            let didEdit = false;
            let finalText: string | null = null;
            let loopCount = 0;
            const MAX_LOOPS = appSettings.kbWebSearchEnabled ? KB_MAX_WEB_LOOPS + 1 : 2;

            while (loopCount < MAX_LOOPS) {
                const response = await generateContent(selectedModel, apiKey, currentHistory, tools);
                const toolCalls = response.toolCalls || [];
                finalText = response.text;

                if (toolCalls.length === 0) break;

                currentHistory.push({
                    role: 'model',
                    content: response.text || null,
                    tool_calls: toolCalls
                });

                for (const tc of toolCalls) {
                    if (tc.function.name === 'update_dossier') {
                        const args = JSON.parse(tc.function.arguments);

                        // ── Auto-Attach Missing Sources (Edit Mode) ───────────
                        const citedIndices = Array.from(args.content.matchAll(/\[(\d+)\]/g))
                            .map(m => parseInt((m as any)[1], 10))
                            .filter(idx => idx > 0 && idx <= ragResults.length);
                        
                        const normalizedSources: import('../types').DossierSource[] = args.sources ? args.sources : [];
                        for (const idx of citedIndices) {
                            const res = ragResults[idx - 1];
                            const alreadyExists = normalizedSources.some(s => s.fileId === res.id);
                            if (!alreadyExists) {
                                normalizedSources.push({
                                    type: 'document',
                                    label: res.id.split('/').pop() || res.id,
                                    fileId: res.id,
                                    snippet: res.chunk
                                });
                            }
                        }
                        args.sources = normalizedSources;

                        await handleDossierToolCall(tc.function.name, args, { proposeOnly: true });
                        didEdit = true;
                        currentHistory.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            name: tc.function.name,
                            content: JSON.stringify({ result: `Proposed update to section "${args.sectionTitle}"` })
                        });
                    } else if (tc.function.name === 'search_web' && appSettings.kbWebSearchEnabled) {
                        try {
                            const args = JSON.parse(tc.function.arguments) as { query: string };
                            const results = await searchWeb(args.query);
                            currentHistory.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                name: tc.function.name,
                                content: JSON.stringify(results)
                            });
                        } catch (e) {
                            currentHistory.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                name: tc.function.name,
                                content: JSON.stringify({ error: e instanceof Error ? e.message : 'Search failed' })
                            });
                        }
                    }
                }

                loopCount++;
            }

            return { text: finalText, didEdit };
        } catch (err: unknown) {
            console.error('[DossierAI] chatWithDossier error:', err);
            return { didEdit: false, text: `Error: ${(err as Error).message}` };
        }
    }, [selectedModel, selectedProvider, apiKeys, appSettings, addToast, refs]);

    return { generateContextualDossier, chatWithDossier };
};
