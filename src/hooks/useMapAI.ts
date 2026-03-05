import { useCallback, useState, MutableRefObject } from 'react';
import dagre from 'dagre';
import { useMapStore } from '../store/useMapStore';
import { useMapUpdateQueue } from '../store/useMapUpdateQueue';
import { useSettingsStore, useFileStore } from '../store';
import { generateContent, Tool, SchemaType } from '../api/llm-provider';
import { ChatMessage, MapNode, MapEdge, MapNodeSource, CaseFileSection } from '../types';
import { useToastStore } from '../store/useToastStore';
import { ComputeCoordinator } from '../compute/coordinator';
import { VectorStore } from '../rag/pipeline';
import { TaskPriority, TaskType } from '../compute/types';
import { searchWeb } from '../utils/search';

// ─── Semantic Helpers ──────────────────────────────────────────────────────────

function dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

function cosineSimilarity(a: number[], b: number[]): number {
    const magA = Math.sqrt(dotProduct(a, a));
    const magB = Math.sqrt(dotProduct(b, b));
    if (magA === 0 || magB === 0) return 0;
    return dotProduct(a, b) / (magA * magB);
}

/**
 * Mass = (Unique_Citations * 2) + Internal_Edges.
 * Constraint: Only verified certainties/citations contribute to full mass. Unverified = 50% mass penalty.
 */
function calculateNodeMass(node: MapNode, edges: MapEdge[]): number {
    const uniqueCitations = node.data.citationCount || 0;
    const internalEdges = edges.filter(e => e.source === node.id || e.target === node.id).length;

    let mass = (uniqueCitations * 2) + internalEdges;

    // 50% penalty if not verified (either certainty or timestamp)
    if (!node.data.isCertaintyVerified || !node.data.isTimestampVerified) {
        mass = mass * 0.5;
    }

    return Math.max(1, mass); // Minimum mass of 1
}

/**
 * Deduplicates sources based on structural (parentChunkIndex) and conceptual (semantic) similarity.
 */
function deduplicateSources(sources: MapNodeSource[]): { deduplicated: MapNodeSource[], uniqueCount: number } {
    if (!sources || sources.length === 0) return { deduplicated: [], uniqueCount: 0 };

    const unique: MapNodeSource[] = [];

    for (const src of sources) {
        let isDuplicate = false;

        for (const existing of unique) {
            // 1. Structural De-duplication: Same document and same paragraph/chunk
            if (src.fileId && src.fileId === existing.fileId &&
                src.parentChunkIndex !== undefined && src.parentChunkIndex === existing.parentChunkIndex) {
                isDuplicate = true;
                break;
            }

            // 2. Conceptual De-duplication: Semantic similarity > 0.92
            if (src.embedding && existing.embedding && cosineSimilarity(src.embedding, existing.embedding) > 0.92) {
                isDuplicate = true;
                break;
            }

            // 3. Fallback: Exact snippet match
            if (src.snippet && existing.snippet && src.snippet.trim() === existing.snippet.trim()) {
                isDuplicate = true;
                break;
            }
        }

        if (!isDuplicate) {
            unique.push(src);
        }
    }

    return { deduplicated: sources, uniqueCount: unique.length };
}

// ─── Granular Tool Definitions ──────────────────────────────────────────────────

const ADD_NODES_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'add_map_nodes',
        description: 'Add NEW entities (nodes) to the investigation map. NEVER call this for nodes that already exist. Include at least one source.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                nodes: {
                    type: SchemaType.ARRAY,
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            id: { type: SchemaType.STRING, description: 'Unique ID, e.g. "node-john-doe". Use kebab-case.' },
                            label: { type: SchemaType.STRING },
                            entityType: { type: SchemaType.STRING, description: 'One of: person, location, event, organization, evidence, group' },
                            description: { type: SchemaType.STRING },
                            timestamp: { type: SchemaType.STRING, description: 'Timestamp in DD.MM.YYYY HH:MM:SS format. If only a date is available, use 00:00:00 for the time.' },
                            certaintyScore: { type: SchemaType.NUMBER, description: 'AI confidence score from 0 to 100.' },
                            sources: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        type: { type: SchemaType.STRING, description: 'One of: web, document, chat_exchange' },
                                        label: { type: SchemaType.STRING },
                                        snippet: { type: SchemaType.STRING },
                                        url: { type: SchemaType.STRING },
                                        fileId: { type: SchemaType.STRING },
                                        parentChunkIndex: { type: SchemaType.NUMBER }
                                    },
                                    required: ['type', 'label', 'snippet', 'url']
                                }
                            }
                        },
                        required: ['id', 'label', 'entityType']
                    }
                }
            },
            required: ['nodes']
        }
    }
};

const UPDATE_NODE_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'update_map_node',
        description: 'Update an EXISTING node by its ID. Only allowed fields: description, tags, sources, timestamp, certaintyScore. Never change label or entityType.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                id: { type: SchemaType.STRING, description: 'Existing node ID to update' },
                description: { type: SchemaType.STRING },
                timestamp: { type: SchemaType.STRING, description: 'Timestamp in DD.MM.YYYY HH:MM:SS format. If only a date is available, use 00:00:00 for the time. LEAVE EMPTY only if no temporal info exists.' },
                certaintyScore: { type: SchemaType.NUMBER, description: 'AI confidence score from 0 to 100.' },
                tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                sources: {
                    type: SchemaType.ARRAY,
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            type: { type: SchemaType.STRING },
                            label: { type: SchemaType.STRING },
                            snippet: { type: SchemaType.STRING, description: 'Exact quote for semantic de-duplication.' },
                            url: { type: SchemaType.STRING, description: 'File path or ID. Crucial for structural de-duplication.' },
                            fileId: { type: SchemaType.STRING, description: 'Technical ID of the file.' },
                            parentChunkIndex: { type: SchemaType.NUMBER, description: 'Technical index of the chunk.' }
                        },
                        required: ['type', 'label', 'snippet', 'url']
                    }
                }
            },
            required: ['id']
        }
    }
};

const ADD_EDGES_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'add_map_edges',
        description: 'Add connection edges between existing nodes. Each edge must reference valid node IDs.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                edges: {
                    type: SchemaType.ARRAY,
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            source: { type: SchemaType.STRING },
                            target: { type: SchemaType.STRING },
                            label: { type: SchemaType.STRING },
                            connectionType: { type: SchemaType.STRING, description: 'One of: knows, involved_in, owns, located_at, conflicts_with, related_to' },
                            certainty: { type: SchemaType.STRING, description: 'One of: confirmed, suspected, disproven' },
                            sources: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        type: { type: SchemaType.STRING, description: 'One of: web, document, message' },
                                        label: { type: SchemaType.STRING, description: 'The human-readable title of the source.' },
                                        snippet: { type: SchemaType.STRING, description: 'A brief quote or excerpt from the source.' },
                                        url: { type: SchemaType.STRING, description: 'The original internal ID or web URL.' },
                                        fileId: { type: SchemaType.STRING, description: 'Technical ID of the file.' },
                                        parentChunkIndex: { type: SchemaType.NUMBER, description: 'Technical index of the chunk.' }
                                    },
                                    required: ['type', 'label']
                                }
                            }
                        },
                        required: ['source', 'target', 'connectionType']
                    }
                }
            },
            required: ['edges']
        }
    }
};

const REMOVE_EDGE_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'remove_map_edge',
        description: 'Remove an incorrect or duplicate edge by its ID.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                edgeIds: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                    description: 'List of edge IDs to remove'
                }
            },
            required: ['edgeIds']
        }
    }
};

// ─── Token estimation (rough: ~40 tokens per node summary) ─────────────────────
function estimateNodeTokens(nodes: MapNode[]): number {
    return nodes.length * 40;
}

// ─── Node layout helpers ─────────────────────────────────────────────────────────
function gridLayout(nodes: { id: string; label: string; entityType?: string; description?: string; sources?: MapNodeSource[]; timestamp?: string; certaintyScore?: number }[], existingCount: number): MapNode[] {
    const cols = Math.max(4, Math.ceil(Math.sqrt(nodes.length)));
    return nodes.map((n, i) => ({
        id: n.id,
        type: 'customEntity' as const,
        position: {
            x: ((existingCount + i) % cols) * 280 + 80,
            y: Math.floor((existingCount + i) / cols) * 200 + 80,
        },
        data: {
            label: n.label,
            entityType: (n.entityType as MapNode['data']['entityType']) || 'person',
            description: n.description,
            sources: n.sources,
            timestamp: n.timestamp,
            isTimestampVerified: false,
            certaintyScore: n.certaintyScore,
            isCertaintyVerified: false,
            lastUpdatedAt: Date.now(),
        },
    }));
}

// ─── Auto-layout with Dagre ───────────────────────────────────────────────────
function autoLayout(nodes: MapNode[], edges: MapEdge[], direction: 'TB' | 'LR' = 'LR'): MapNode[] {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    // Typical node sizes (can be refined if nodes grow/shrink dynamically)
    const nodeWidth = 260;
    const nodeHeight = 80;

    dagreGraph.setGraph({ rankdir: direction, nodesep: 80, ranksep: 120 });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    return nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        if (!nodeWithPosition) return node;

        // Dagre positions are center point, React Flow needs top-left
        return {
            ...node,
            position: {
                x: nodeWithPosition.x - nodeWidth / 2,
                y: nodeWithPosition.y - nodeHeight / 2,
            },
        };
    });
}

// ─── Apply tool calls from LLM response ────────────────────────────────────────
function applyToolCalls(
    toolCalls: { function: { name: string; arguments: string } }[],
    mapStore: ReturnType<typeof useMapStore.getState>,
    nodeLayoutFn: (nodes: ReturnType<typeof JSON.parse>) => MapNode[]
) {
    for (const tc of toolCalls) {
        const args = JSON.parse(tc.function.arguments);
        switch (tc.function.name) {
            case 'add_map_nodes': {
                const newNodes = nodeLayoutFn(args.nodes || []);

                // For each new node, calculate citation count and mass
                newNodes.forEach(node => {
                    const { uniqueCount } = deduplicateSources(node.data.sources || []);
                    node.data.citationCount = uniqueCount;
                    node.data.mass = calculateNodeMass(node, mapStore.edges);
                });

                mapStore.patchNodes({ add: newNodes });
                break;
            }
            case 'update_map_node': {
                const { id, description, timestamp, certaintyScore, tags, sources } = args;
                const updatePatch: Partial<MapNode['data']> & { id: string } = { id };
                if (description !== undefined) updatePatch.description = description;
                if (timestamp !== undefined) {
                    updatePatch.timestamp = timestamp;
                    updatePatch.isTimestampVerified = false;
                }
                if (certaintyScore !== undefined) {
                    updatePatch.certaintyScore = certaintyScore;
                    updatePatch.isCertaintyVerified = false;
                }
                if (tags !== undefined) updatePatch.tags = tags;

                // Recalculate citation count if sources are updated
                if (sources !== undefined) {
                    updatePatch.sources = sources;
                    const { uniqueCount } = deduplicateSources(sources);
                    updatePatch.citationCount = uniqueCount;
                }

                // Find existing node to recalculate mass based on potentially updated data
                const existingNode = mapStore.nodes.find(n => n.id === id);
                if (existingNode) {
                    const mergedNode = {
                        ...existingNode,
                        data: { ...existingNode.data, ...updatePatch }
                    };
                    updatePatch.mass = calculateNodeMass(mergedNode, mapStore.edges);
                }

                mapStore.patchNodes({ update: [updatePatch] });
                break;
            }
            case 'add_map_edges': {
                const newEdges: MapEdge[] = (args.edges || []).map((e: { source: string; target: string; label?: string; connectionType?: string; certainty?: string }) => ({
                    id: `edge-${Date.now()}-${Math.random().toString(36).slice(2)}-${e.source}-${e.target}`,
                    source: e.source,
                    target: e.target,
                    label: e.label,
                    data: {
                        connectionType: (e.connectionType || 'related_to') as import('../types').ConnectionType,
                        certainty: (e.certainty || 'confirmed') as 'confirmed' | 'suspected' | 'disproven',
                    },
                }));
                mapStore.patchEdges({ add: newEdges });

                // Mass depends on internal edges, so recalculate mass for source/target nodes
                const nodeUpdates: (Partial<MapNode['data']> & { id: string })[] = [];
                const updatedEdges = [...mapStore.edges, ...newEdges];

                newEdges.forEach(edge => {
                    [edge.source, edge.target].forEach(nodeId => {
                        const node = mapStore.nodes.find(n => n.id === nodeId);
                        if (node && !nodeUpdates.some(u => u.id === nodeId)) {
                            nodeUpdates.push({
                                id: nodeId,
                                mass: calculateNodeMass(node, updatedEdges)
                            });
                        }
                    });
                });

                if (nodeUpdates.length > 0) {
                    mapStore.patchNodes({ update: nodeUpdates });
                }
                break;
            }
            case 'remove_map_edge': {
                const edgeIdsToRemove = args.edgeIds || [];
                const edgesAfterRemoval = mapStore.edges.filter(e => !edgeIdsToRemove.includes(e.id));
                const nodesToUpdate = new Set<string>();

                mapStore.edges.forEach(e => {
                    if (edgeIdsToRemove.includes(e.id)) {
                        nodesToUpdate.add(e.source);
                        nodesToUpdate.add(e.target);
                    }
                });

                mapStore.patchEdges({ remove: edgeIdsToRemove });

                // Recalculate mass for nodes affected by edge removal
                const nodeUpdates = Array.from(nodesToUpdate).map(nodeId => {
                    const node = mapStore.nodes.find(n => n.id === nodeId);
                    return node ? { id: nodeId, mass: calculateNodeMass(node, edgesAfterRemoval) } : null;
                }).filter((u): u is { id: string, mass: number } => u !== null);

                if (nodeUpdates.length > 0) {
                    mapStore.patchNodes({ update: nodeUpdates });
                }
                break;
            }
        }
    }
}

// ─── System prompts ────────────────────────────────────────────────────────────
const SYSTEM_BASE = `You are a forensic mapping assistant for an investigation analysis tool.
CRITICAL INSTRUCTION: YOU MUST ONLY RESPOND BY CALLING A FUNCTION TOOL. ANY OTHER TEXT, MARKDOWN, OR EXPLANATION WILL CAUSE A SYSTEM FAILURE. DO NOT OUTPUT CONVERSATIONAL TEXT.

STRICT RULES:
1. USE ONLY THE PROVIDED TOOLS.
2. NEVER add a node whose ID already appears in the existing node list.
3. NEVER recreate the full map — only ADD or UPDATE specific items.
4. Every node/edge you add MUST be grounded in the provided context.
5. When adding sources, ALWAYS populate the \`url\` field if referencing a specific file path, URL, or chat message ID.
6. SOURCES: When citing sources in your tool calls:
   - For internal document sources (from KB Evidence or Chat Sources), use the HUMAN-READABLE TITLE as the \`label\` and the ORIGINAL INTERNAL ID (e.g. "filename.txt_...") as the \`url\`.
   - For web results, use the \`title\` as the \`label\` and the \`link\` as the \`url\`.
   - DO NOT use generic labels like "Chat Source 1" if a file name is provided in the context header.
7. TIMESTAMPS: Extract available dates and times in DD.MM.YYYY HH:MM:SS format. 
   - If only a date is available (e.g. "Jan 5, 2024"), use "05.01.2024 00:00:00".
   - If no year is provided but it can be inferred from context, use the inferred year.
   - If absolutely no temporal data exists for an entity, leave the field EMPTY.
8. CERTAINTY: Assign a certaintyScore (0-100) based on how explicit and cross-referenced the evidence is.`;

interface InternalSearchResult {
    id?: string;
    title?: string;
    link?: string;
    snippet?: string;
    chunk?: string;
    embedding?: number[];
    parentChunkIndex?: number;
}

// ─── Shared Research Pipeline ──────────────────────────────────────────────────
async function buildResearchContext(opts: {
    cleanInstruction: string;
    bubbleSearchResults: InternalSearchResult[];
    mapStore: ReturnType<typeof useMapStore.getState>;
    apiKey: string | undefined;
    selectedModel: import('../types').Model;
    files: import('../types').AppFile[];
    appSettings: import('../config').AppSettings;
    config?: {
        coordinator: MutableRefObject<ComputeCoordinator | null>;
        vectorStore: MutableRefObject<VectorStore | null>;
        queryEmbeddingResolver: MutableRefObject<((value: number[]) => void) | null>;
    };
}) {
    const { cleanInstruction, bubbleSearchResults, mapStore, apiKey, selectedModel, files, appSettings, config } = opts;

    console.group('DEBUG: Map Update Context Retrieval');
    console.log('Cleaned Instruction:', cleanInstruction);
    console.log('Settings:', { RAG: mapStore.isRagActive, WEB: mapStore.isWebActive, DEEP: mapStore.isDeepActive });

    let finalSynthesizedContext = '';
    const allRawContexts: { label: string, chunk: string, id?: string, link?: string, similarity?: number, embedding?: number[], parentChunkIndex?: number }[] = [];

    // ── Phase 1: The Planner (Deep Analysis Only) ──────────────────────
    let searchQueries = [cleanInstruction.split('\n')[0].substring(0, 200)]; // Default
    if (mapStore.isDeepActive) {
        const maxQ = appSettings.numSubQuestions || 3;
        mapStore.setProgress({ phase: 0, batchCurrent: 1, batchTotal: 1, label: 'Planning research...' });
        const plannerPrompt = `Analyze this investigation goal and generate up to ${maxQ} specific, targeted search queries to find the missing details.
Goal: ${cleanInstruction}
JSON Format: { "queries": ["query1", "query2", ...] }`;
        const plannerResponse = await generateContent(selectedModel, apiKey, [{ role: 'user', content: plannerPrompt }], []);
        try {
            const parsed = JSON.parse(plannerResponse.text || '{}');
            if (parsed.queries && parsed.queries.length > 0) {
                searchQueries = parsed.queries;
                console.log('Deep Planner queries:', searchQueries);
            }
        } catch { console.warn('[MapAI] Planner failed, using default query.'); }
    }

    // ── Phase 2: Hybrid Research & Evaluation ─────────────────────────
    mapStore.setProgress({ phase: 1, batchCurrent: 0, batchTotal: searchQueries.length, label: 'Researching...' });

    // 2a. Smart Ingestion (Instant)
    bubbleSearchResults.forEach(sr => allRawContexts.push({
        label: sr.title || sr.id || 'Chat Source',
        chunk: sr.chunk || sr.snippet || '',
        id: sr.id,
        link: sr.link,
        embedding: sr.embedding,
        parentChunkIndex: sr.parentChunkIndex
    }));

    // 2b. WEB Search — in DEEP mode run up to 3 targeted planner queries;
    //     in standard mode run once (primary query only).
    //     Each query is retried once with backoff on DDG rate-limit errors.
    const decodeDDGLink = (link: string): string => {
        try {
            const url = new URL(link);
            const uddg = url.searchParams.get('uddg');
            return uddg ? decodeURIComponent(uddg) : link;
        } catch {
            return link;
        }
    };

    console.log('%c[MapAI] WEB CHECK', 'color:cyan;font-weight:bold', {
        isWebActive: mapStore.isWebActive,
        isDeepActive: mapStore.isDeepActive,
        queriesAvailable: searchQueries.length,
        willSearch: mapStore.isWebActive && searchQueries.length > 0
    });
    if (mapStore.isWebActive && searchQueries.length > 0) {
        // Cap queries based on settings to respect DDG rate limits and user preference.
        const maxWeb = appSettings.numSubQuestions || 3;
        const webQueries = mapStore.isDeepActive ? searchQueries.slice(0, maxWeb) : [searchQueries[0]];
        for (let wi = 0; wi < webQueries.length; wi++) {
            const q = webQueries[wi].replace(/["']/g, '').trim();
            // Single-retry helper with configurable delay
            const trySearch = async (): Promise<void> => {
                try {
                    console.log(`%c[MapAI] Web search ${wi + 1}/${webQueries.length}:`, 'color:cyan', q);
                    mapStore.setProgress({ phase: 1, batchCurrent: wi + 1, batchTotal: webQueries.length, label: `Web (${wi + 1}/${webQueries.length}): ${q.substring(0, 25)}...` });
                    const results = await searchWeb(q);
                    console.log(`%c[MapAI] searchWeb() ${wi + 1} returned:`, 'color:cyan', results?.length ?? 0, 'results');
                    if (results) results.slice(0, 5).forEach(r => allRawContexts.push({
                        label: r.title,
                        chunk: r.snippet,
                        link: decodeDDGLink(r.link)  // decode actual URL from DDG redirect
                    }));
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    if (msg.includes('too quickly') || msg.includes('anomaly') || msg.includes('Ratelimit') || msg.includes('429')) {
                        console.warn(`[MapAI] DDG rate limit on query ${wi + 1}, retrying in 6s...`);
                        await new Promise(res => setTimeout(res, 6000));
                        try {
                            const retryResults = await searchWeb(q);
                            if (retryResults) retryResults.slice(0, 5).forEach(r => allRawContexts.push({
                                label: r.title,
                                chunk: r.snippet,
                                link: decodeDDGLink(r.link)
                            }));
                        } catch (retryErr) {
                            console.warn(`[MapAI] Web search ${wi + 1} failed after retry — skipping.`, retryErr);
                        }
                    } else {
                        console.error(`[MapAI] Web search ${wi + 1} error:`, e);
                    }
                }
            };
            await trySearch();
            // Rate-limit guard between queries (skip after last)
            if (wi < webQueries.length - 1) await new Promise(res => setTimeout(res, 3500));
        }
    } else {
        console.warn('[MapAI] WEB SEARCH SKIPPED — isWebActive:', mapStore.isWebActive, '| queries:', searchQueries.length);
    }


    for (let i = 0; i < searchQueries.length; i++) {
        const q = searchQueries[i].replace(/["']/g, '').trim();
        mapStore.setProgress({ phase: 1, batchCurrent: i + 1, batchTotal: searchQueries.length, label: `RAG Search: ${q.substring(0, 30)}...` });

        // RAG Search
        if (mapStore.isRagActive && files.length > 0 && config?.coordinator.current && config?.vectorStore.current && config?.queryEmbeddingResolver) {
            try {
                const queryEmbeddingPromise = new Promise<number[]>((resolve) => { if (config.queryEmbeddingResolver) config.queryEmbeddingResolver.current = resolve; });
                config.coordinator.current.addJob('Map RAG Search', [{ id: `map-rag-${Date.now()}`, priority: TaskPriority.P1_Primary, payload: { type: TaskType.EmbedQuery, query: q } }]);
                const queryEmbedding = await queryEmbeddingPromise;
                const results = config.vectorStore.current.search(queryEmbedding, appSettings.numFinalContextChunks || 10);
                results.forEach(r => allRawContexts.push({
                    label: files.find(f => f.id === r.id)?.name || r.id,
                    chunk: r.chunk,
                    id: r.id,
                    similarity: r.similarity,
                    embedding: queryEmbedding,
                    parentChunkIndex: r.parentChunkIndex
                }));
            } catch (e) { console.error('[MapAI] RAG search error:', e); }
        }
    }

    // 2c. Programmatic Deduplication
    const dedupSources: MapNodeSource[] = allRawContexts.map(c => ({
        type: c.id ? 'document' : 'web',
        label: c.label,
        snippet: c.chunk,
        url: c.id || c.link || '',
        fileId: c.id,
        embedding: c.embedding,
        parentChunkIndex: c.parentChunkIndex
    }));
    const { deduplicated, uniqueCount } = deduplicateSources(dedupSources);

    // DIAGNOSTIC LOG: Source Mapping Table
    console.group('DIAGNOSTIC: Source Mapping Table');
    console.table(deduplicated.map((d, i) => ({
        ref: `REF_${i}`,
        type: d.type,
        file: d.label,
        id: d.fileId || d.url || 'N/A',
        chunk: d.parentChunkIndex ?? 'N/A',
        snippet: d.snippet?.substring(0, 50) + '...'
    })));
    console.groupEnd();

    // 2d. LLM Evaluation & Synthesis (Deep Only)
    //  Build the REF table — document sources include fileId+chunkIndex, web sources include the real URL.
    const buildRefTable = (sources: typeof deduplicated) =>
        "--- SOURCE REFERENCE TABLE ---\n" +
        sources.map((d, i) => {
            if (d.type === 'web') {
                return `REF_${i}: { "name": "${d.label}", "type": "web", "url": "${d.url}" }`;
            }
            return `REF_${i}: { "name": "${d.label}", "type": "document", "url": "${d.url}", "fileId": "${d.fileId || ''}", "chunkIndex": ${d.parentChunkIndex ?? 'null'} }`;
        }).join('\n') +
        "\n\nCRITICAL: When citing sources in tool calls, you MUST copy ALL properties exactly as they appear in the reference JSON above (including url, fileId, and chunkIndex).";

    if (mapStore.isDeepActive && uniqueCount > 0) {
        mapStore.setProgress({ phase: 2, batchCurrent: 1, batchTotal: 1, label: 'Evaluating evidence...' });
        const synthesisPrompt = `You are a forensic analyst. Evaluate the following research findings for relevance and conflict. Merge overlapping facts into a single unified investigation brief.
Goal: ${cleanInstruction}
Findings:
${deduplicated.map((d, i) => `[REF_${i}] Source: ${d.label}${d.type === 'web' ? ` (${d.url})` : ''}\nContent: ${d.snippet}`).join('\n---\n')}

Produce a high-signal "Unified Investigation Brief". If sources conflict, note the discrepancy.`;
        const synthResponse = await generateContent(selectedModel, apiKey, [{ role: 'user', content: synthesisPrompt }], []);
        finalSynthesizedContext = synthResponse.text || '';

        // Construct mapping lookup table
        const lookupTable = buildRefTable(deduplicated) + "\n\n";
        finalSynthesizedContext = lookupTable + finalSynthesizedContext;
    } else {
        // Fast Mode Synthesis
        finalSynthesizedContext = buildRefTable(deduplicated) +
            "\n\n" +
            deduplicated.map((d, i) => `[REF_${i}: ${d.label}${d.type === 'web' ? ` | ${d.url}` : ''}]\n${d.snippet}`).join('\n\n');
    }

    console.groupEnd();
    return finalSynthesizedContext;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export const useMapAI = (config?: {
    coordinator: MutableRefObject<ComputeCoordinator | null>;
    vectorStore: MutableRefObject<VectorStore | null>;
    queryEmbeddingResolver: MutableRefObject<((value: number[]) => void) | null>;
}) => {
    const [isMapProcessing, setIsMapProcessing] = useState(false);
    const [reviewTokenWarning, setReviewTokenWarning] = useState<{
        estimatedTokens: number;
        onConfirmAll: () => void;
        onConfirmTrimmed: () => void;
        onCancel: () => void;
    } | null>(null);

    const { selectedModel, selectedProvider, apiKeys, appSettings } = useSettingsStore();
    const { addToast } = useToastStore();
    const { files } = useFileStore();

    // ── drainUpdateQueue ────────────────────────────────────────────────────────
    const drainUpdateQueue = useCallback(async () => {
        const queue = useMapUpdateQueue.getState();
        const update = queue.dequeueUpdate();
        if (!update || update.length === 0) return;

        const summaries = update.map(r => `**${r.title}** (${r.link})\n${r.snippet}`).join('\n---\n');
        // We call it via a global reference to avoid circular dependency in useCallback
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any)._handleMapInstruction) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (window as any)._handleMapInstruction(`Incorporate the following new research findings into the map:\n${summaries}`);
            addToast(`Map updated from search results.`, 'success');
        }
    }, [addToast]);

    // ── handleMapInstruction ──────────────────────────────────────────────────
    const handleMapInstruction = useCallback(async (
        instruction: string,
        contextNodeId?: string,
        caseFileText?: string
    ) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any)._handleMapInstruction = handleMapInstruction;
        const mapStore = useMapStore.getState();
        if (!mapStore.acquireLock()) {
            addToast('Map update already in progress. Please wait.', 'warning');
            return;
        }

        setIsMapProcessing(true);
        const apiKey = apiKeys[selectedProvider];

        try {
            // ── Phase 0: Bubble Context & Cleanup ──────────────────────────────
            const cleanInstruction = instruction.replace(/<!--searchResults:[\s\S]*?-->/g, '').trim();
            let bubbleSearchResults: InternalSearchResult[] = [];
            instruction.replace(/<!--searchResults:([\s\S]*?)-->/, (_, resultsJson) => {
                try { bubbleSearchResults = JSON.parse(resultsJson); } catch { /* ignore */ }
                return '';
            });

            // ── Phases 0-2: Research Pipeline ──────────────────────────────────
            const finalSynthesizedContext = await buildResearchContext({
                cleanInstruction,
                bubbleSearchResults,
                mapStore,
                apiKey,
                selectedModel,
                files,
                appSettings,
                config
            });

            // ── Phase 3: Synthesized Mapping ───────────────────────────────────
            const currentNodes = mapStore.nodes;
            const existingNodeList = currentNodes.map(n => `${n.id}: ${n.data.label} (${n.data.entityType})`).join('\n');
            let userContent = `=== SOURCE MATERIAL TO MAP ===\n${cleanInstruction}\n==============================\n\nContext & References:\n${caseFileText ? `Case File: ${caseFileText}\n\n` : ''}${finalSynthesizedContext.substring(0, 25000)}\n\n---\n\nExisting Nodes Setup:\n${existingNodeList}\n\nCRITICAL: DO NOT explain your work or write an essay. ONLY return the JSON tool call to add or update nodes found in the SOURCE MATERIAL.`;

            if (contextNodeId) {
                const targetNode = currentNodes.find(n => n.id === contextNodeId);
                if (targetNode) userContent += `\n\nFocus on node: ${JSON.stringify({ id: targetNode.id, label: targetNode.data.label, description: targetNode.data.description })}`;
            }

            mapStore.setProgress({ phase: 3, batchCurrent: 1, batchTotal: 2, label: 'Mapping entities...' });
            const phase1Messages: ChatMessage[] = [
                { role: 'system', content: `${SYSTEM_BASE}\n\nTask: Extract or update entities. Use REF_X IDs for source URLs and Names for labels.` },
                { role: 'user', content: userContent }
            ];
            const phase1Response = await generateContent(selectedModel, apiKey, phase1Messages, [ADD_NODES_TOOL, UPDATE_NODE_TOOL]);

            let totalToolCalls = 0;
            if (phase1Response.toolCalls?.length) {
                totalToolCalls += phase1Response.toolCalls.length;
                applyToolCalls(phase1Response.toolCalls, mapStore, (nodes) => gridLayout(nodes, currentNodes.length));
            }

            mapStore.setProgress({ phase: 3, batchCurrent: 2, batchTotal: 2, label: 'Mapping connections...' });
            const updatedNodes = useMapStore.getState().nodes;
            const updatedNodeList = updatedNodes.map(n => `${n.id}: ${n.data.label} (${n.data.entityType})`).join('\n');
            const phase2Messages: ChatMessage[] = [
                { role: 'system', content: `${SYSTEM_BASE}\n\nTask: ONLY wire connections between existing nodes. Use add_map_edges and remove_map_edge.` },
                { role: 'user', content: `=== SOURCE MATERIAL TO MAP ===\n${cleanInstruction}\n==============================\n\nContext & References:\n${finalSynthesizedContext.substring(0, 25000)}\n\n---\n\nExisting Nodes Setup:\n${updatedNodeList}\n\nCRITICAL: DO NOT explain your work or write an essay. ONLY return the JSON tool call to connect the entities.` }
            ];
            const phase2Response = await generateContent(selectedModel, apiKey, phase2Messages, [ADD_EDGES_TOOL, REMOVE_EDGE_TOOL]);

            if (phase2Response.toolCalls?.length) {
                totalToolCalls += phase2Response.toolCalls.length;
                applyToolCalls(phase2Response.toolCalls, mapStore, (nodes) => gridLayout(nodes, updatedNodes.length));

                // ── Phase 4: Final Polish (Mass & Layout) ───────────────────────
                const finalNodes = useMapStore.getState().nodes.map(n => ({
                    ...n,
                    data: {
                        ...n.data,
                        // Re-calculate mass based on unique citations and new edges
                        mass: calculateNodeMass(n, useMapStore.getState().edges),
                        // Clean labels from ID-leaking AI
                        label: n.data.label.replace(/^[node-]+/i, '').replace(/_/g, ' '),
                        // Restore sources lost in map step
                        sources: n.data.sources
                    }
                }));
                const finalEdges = useMapStore.getState().edges;
                useMapStore.setState({ nodes: autoLayout(finalNodes, finalEdges, 'LR') });
                useMapStore.getState().persistToDB();
            }

            if (totalToolCalls > 0) {
                addToast('Map updated successfully.', 'success');
            } else {
                mapStore.setMapError("No new mappable information was found.");
            }
        } catch (error) {
            console.error('[MapAI] handleMapInstruction error:', error);
            mapStore.setMapError("Error processing map update.");
        } finally {
            setIsMapProcessing(false);
            mapStore.releaseLock();
            mapStore.setProgress(null);
            drainUpdateQueue();
        }
    }, [apiKeys, selectedProvider, selectedModel, addToast, drainUpdateQueue, config, files, appSettings]);

    // ── generateMapFromDocument (Two-Phase) ────────────────────────────────────
    const generateMapFromDocument = useCallback(async (caseFileSections: CaseFileSection[]) => {
        const mapStore = useMapStore.getState();
        if (!mapStore.acquireLock()) {
            addToast('Map is already being generated. Please wait.', 'warning');
            return;
        }

        setIsMapProcessing(true);
        const apiKey = apiKeys[selectedProvider];

        try {
            // ── Phase 0-1: Research (Planner, Web, RAG, Synthesis) ──────
            const cleanInstruction = `Analyze and map the following case: ${caseFileSections.map(s => s.title).join(', ')}`;
            const finalSynthesizedContext = await buildResearchContext({
                cleanInstruction,
                bubbleSearchResults: [],
                mapStore,
                apiKey,
                selectedModel,
                files,
                appSettings,
                config
            });

            // ── Phase 2: Parallel entity extraction (batches of 3 sections) ──────
            const BATCH_SIZE = 3;
            const batches: CaseFileSection[][] = [];
            for (let i = 0; i < caseFileSections.length; i += BATCH_SIZE) {
                batches.push(caseFileSections.slice(i, i + BATCH_SIZE));
            }

            mapStore.setProgress({ phase: 2, batchCurrent: 0, batchTotal: batches.length, label: 'Extracting entities…' });

            const phase1Results = await Promise.all(batches.map(async (batch, batchIdx) => {
                const batchText = batch.map(s => s.content).join('\n\n');
                const messages: ChatMessage[] = [
                    {
                        role: 'system',
                        content: `${SYSTEM_BASE}\n\nTask: Extract ALL unique entities from the provided text. Use add_map_nodes ONLY. Do not add edges in this phase.`
                    },
                    {
                        role: 'user',
                        content: `=== SOURCE MATERIAL TO MAP (sections ${batchIdx * BATCH_SIZE + 1}-${Math.min((batchIdx + 1) * BATCH_SIZE, caseFileSections.length)}) ===\n${batchText.substring(0, 10000)}\n==============================\n\nContext & References:\n${finalSynthesizedContext.substring(0, 25000)}\n\nCRITICAL: DO NOT explain your work or write an essay. ONLY return the JSON tool call to add nodes found in the SOURCE MATERIAL.`
                    }
                ];

                const response = await generateContent(selectedModel, apiKey, messages, [ADD_NODES_TOOL]);
                mapStore.setProgress({ phase: 2, batchCurrent: batchIdx + 1, batchTotal: batches.length, label: 'Extracting entities…' });
                return response.toolCalls || [];
            }));

            // Collect all proposed nodes and deduplicate across batches
            const seenIds = new Set<string>();
            const allProposedNodes: MapNode[] = [];
            let globalIdx = 0;

            for (const toolCalls of phase1Results) {
                for (const tc of toolCalls) {
                    if (tc.function.name !== 'add_map_nodes') continue;
                    const args = JSON.parse(tc.function.arguments);
                    const laid = gridLayout(args.nodes || [], globalIdx);
                    for (const node of laid) {
                        if (!seenIds.has(node.id)) {
                            seenIds.add(node.id);
                            allProposedNodes.push(node);
                            globalIdx++;
                        } else {
                            console.warn(`[MapAI] Phase 1 dedup: "${node.id}" seen in multiple batches — skipped.`);
                        }
                    }
                }
            }

            mapStore.patchNodes({ add: allProposedNodes });

            // ── Phase 3: Single connection pass ──────────────────────────────────
            mapStore.setProgress({ phase: 3, batchCurrent: 0, batchTotal: 1, label: 'Connecting entities…' });

            const currentNodes = mapStore.nodes;
            const nodeList = currentNodes.map(n => `${n.id}: ${n.data.label} (${n.data.entityType})`).join('\n');
            const fullText = caseFileSections.map(s => s.content).join('\n\n');

            const phase2Messages: ChatMessage[] = [
                {
                    role: 'system',
                    content: `${SYSTEM_BASE}\n\nTask: ONLY wire connections between the existing nodes listed below. Use add_map_edges only. Do NOT add new nodes.`
                },
                {
                    role: 'user',
                    content: `=== SOURCE MATERIAL TO CONNECT ===\n${fullText.substring(0, 15000)}\n==============================\n\nContext & References:\n${finalSynthesizedContext.substring(0, 25000)}\n\n---\n\nExisting nodes:\n${nodeList}\n\nCRITICAL: DO NOT explain your work or write an essay. ONLY return the JSON tool call to connect the entities.`
                }
            ];

            const runPhase2 = async (nodesToKeep?: MapNode[]) => {
                try {
                    // Update connection list based on trimmed nodes if necessary
                    let modifiedMessages = phase2Messages;
                    if (nodesToKeep) {
                        const trimmedList = nodesToKeep.map(n => `${n.id}: ${n.data.label}`).join('\n');
                        modifiedMessages = [
                            phase2Messages[0],
                            { role: 'user', content: `=== SOURCE MATERIAL TO CONNECT ===\n${fullText.substring(0, 15000)}\n==============================\n\n---\n\nExisting nodes (TRIMMED to fit context):\n${trimmedList}\n\nCRITICAL: DO NOT explain your work or write an essay. ONLY return the JSON tool call to connect the entities.` }
                        ];
                    }

                    const phase2Response = await generateContent(selectedModel, apiKey, modifiedMessages, [ADD_EDGES_TOOL]);

                    if (phase2Response.toolCalls?.length) {
                        try {
                            applyToolCalls(phase2Response.toolCalls, mapStore, (nodes) => gridLayout(nodes, currentNodes.length));
                        } catch (e) {
                            console.error('[MapAI] runPhase2 applyToolCalls error (malformed JSON?):', e);
                            addToast('Some connections could not be mapped due to an AI formatting error.', 'warning');
                        }
                    }

                    const finalNodes = useMapStore.getState().nodes;
                    const finalEdges = useMapStore.getState().edges;
                    if (finalNodes.length > 0) {
                        useMapStore.setState({ nodes: autoLayout(finalNodes, finalEdges, 'LR') });
                        useMapStore.getState().persistToDB();
                    }

                    mapStore.setProgress({ phase: 3, batchCurrent: 1, batchTotal: 1, label: 'Done' });
                } catch (error) {
                    console.error('[MapAI] Phase 2 error:', error);
                } finally {
                    setIsMapProcessing(false);
                    mapStore.releaseLock();
                    mapStore.setProgress(null);
                    drainUpdateQueue();
                }
            };

            const estimatedTokens = estimateNodeTokens(currentNodes) + Math.floor(fullText.length / 4);
            if (estimatedTokens > 8000) {
                setReviewTokenWarning({
                    estimatedTokens,
                    onConfirmAll: () => {
                        setReviewTokenWarning(null);
                        runPhase2();
                    },
                    onConfirmTrimmed: () => {
                        setReviewTokenWarning(null);
                        // Sort by some heuristic (e.g., entity type priority or randomly keep a subset if too large)
                        runPhase2(currentNodes.slice(0, 20)); // Arbitrary trim for initial generation phase 2
                    },
                    onCancel: () => {
                        setReviewTokenWarning(null);
                        setIsMapProcessing(false);
                        mapStore.releaseLock();
                        mapStore.setProgress(null);
                        addToast('Map generation cancelled before Phase 2.', 'info');
                    }
                });
            } else {
                runPhase2();
            }

        } catch (error) {
            console.error('[MapAI] generateMapFromDocument error:', error);
            setIsMapProcessing(false);
            mapStore.releaseLock();
            mapStore.setProgress(null);
            drainUpdateQueue();
        }
    }, [apiKeys, selectedProvider, selectedModel, addToast, drainUpdateQueue, appSettings, files, config]);

    // ── reviewMapConnections ────────────────────────────────────────────────────
    const reviewMapConnections = useCallback(async (nodeIds?: string[]) => {
        const mapStore = useMapStore.getState();
        const allNodes = mapStore.nodes;
        const allEdges = mapStore.edges;

        // By default, provide all nodes so the LLM has context to find new connections across the map.
        // Token warnings will catch it if it's too large.
        const targetNodes = allNodes;

        const estimatedTokens = estimateNodeTokens(targetNodes);

        const runReview = async (nodes: MapNode[]) => {
            if (!mapStore.acquireLock()) {
                addToast('Map update already in progress.', 'warning');
                return;
            }
            setIsMapProcessing(true);
            const apiKey = apiKeys[selectedProvider];

            try {
                const nodeList = nodes.map(n => `${n.id}: ${n.data.label} (${n.data.entityType})`).join('\n');
                const relevantEdges = allEdges.filter(e =>
                    nodes.some(n => n.id === e.source) && nodes.some(n => n.id === e.target)
                );
                const edgeList = relevantEdges.map(e => `${e.id}: ${e.source} --[${e.data?.connectionType}]--> ${e.target}`).join('\n');

                const messages: ChatMessage[] = [
                    {
                        role: 'system',
                        content: `${SYSTEM_BASE}\n\nTask: Review the connections between the given nodes for accuracy. Remove incorrect edges using remove_map_edge. Add missing connections using add_map_edges.\nCRITICAL: If the edge list is empty, or if specific nodes are provided, your primary job is to discover NEW logical connections between the nodes based on their descriptions. Do not output empty just because there are no existing edges.`
                    },
                    {
                        role: 'user',
                        content: `${nodeIds && nodeIds.length > 0 ? `Target Nodes to Focus On: ${nodeIds.join(', ')}\n\n` : ''}Available Nodes:\n${nodeList}\n\nExisting edges:\n${edgeList ? edgeList : '(No existing edges yet. Please look for relationships to establish!)'}`
                    }
                ];

                const response = await generateContent(selectedModel, apiKey, messages, [ADD_EDGES_TOOL, REMOVE_EDGE_TOOL, UPDATE_NODE_TOOL]);
                if (response.toolCalls?.length) {
                    applyToolCalls(response.toolCalls, mapStore, (nodes) => gridLayout(nodes, allNodes.length));

                    // Re-layout after significant edge changes
                    const finalNodes = useMapStore.getState().nodes;
                    const finalEdges = useMapStore.getState().edges;
                    useMapStore.setState({ nodes: autoLayout(finalNodes, finalEdges, 'LR') });
                    useMapStore.getState().persistToDB();

                    addToast(`Map review complete: ${response.toolCalls.length} changes applied.`, 'success');
                } else {
                    addToast('Map review complete: no changes needed.', 'info');
                }
            } catch (error) {
                console.error('[MapAI] reviewMapConnections error:', error);
            } finally {
                setIsMapProcessing(false);
                mapStore.releaseLock();
                drainUpdateQueue();
            }
        };

        if (estimatedTokens > 8000) {
            // Show token budget warning to user before proceeding
            setReviewTokenWarning({
                estimatedTokens,
                onConfirmAll: () => {
                    setReviewTokenWarning(null);
                    runReview(targetNodes);
                },
                onConfirmTrimmed: () => {
                    setReviewTokenWarning(null);
                    // Keep the requested target nodes absolutely safe from trimming
                    const targetSet = new Set(nodeIds || []);
                    const trimmed = [...targetNodes]
                        .sort((a, b) => {
                            if (targetSet.has(a.id) && !targetSet.has(b.id)) return -1;
                            if (targetSet.has(b.id) && !targetSet.has(a.id)) return 1;
                            return 0; // if both are targets or neither, could sort by degree, but this is fine
                        })
                        .slice(0, 30); // Arbitrary trim for connections
                    runReview(trimmed);
                },
                onCancel: () => setReviewTokenWarning(null),
            });
        } else {
            runReview(targetNodes);
        }
    }, [apiKeys, selectedProvider, selectedModel, addToast, drainUpdateQueue]);

    return {
        handleMapInstruction,
        generateMapFromDocument,
        reviewMapConnections,
        isMapProcessing,
        reviewTokenWarning,
        dismissReviewWarning: () => setReviewTokenWarning(null),
    };
};
