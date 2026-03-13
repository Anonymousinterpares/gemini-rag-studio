import dagre from 'dagre';
import { generateContent, Tool, SchemaType, LlmResponse } from '../api/llm-provider';
import { ChatMessage, MapNode, MapEdge, MapNodeSource, Model, SearchResult, AppFile, EntityType } from '../types';
import { TaskPriority, TaskType } from '../compute/types';
import { searchWeb } from '../utils/search';
import { AppSettings } from '../config';
import { useMapStore, MapState } from '../store/useMapStore';

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

export function calculateNodeMass(node: MapNode, edges: MapEdge[]): number {
    const uniqueCitations = node.data.citationCount || 0;
    const internalEdges = edges.filter(e => e.source === node.id || e.target === node.id).length;
    let mass = (uniqueCitations * 2) + internalEdges;
    if (!node.data.isCertaintyVerified || !node.data.isTimestampVerified) {
        mass = mass * 0.5;
    }
    return Math.max(1, mass);
}

export function deduplicateSources(sources: MapNodeSource[]): { deduplicated: MapNodeSource[], uniqueCount: number } {
    if (!sources || sources.length === 0) return { deduplicated: [], uniqueCount: 0 };
    const unique: MapNodeSource[] = [];
    for (const src of sources) {
        let isDuplicate = false;
        for (const existing of unique) {
            if (src.fileId && src.fileId === existing.fileId && src.start !== undefined && src.start === existing.start && src.end !== undefined && src.end === existing.end) {
                isDuplicate = true;
                break;
            }
            if (src.embedding && existing.embedding && cosineSimilarity(src.embedding, existing.embedding) > 0.92) {
                isDuplicate = true;
                break;
            }
            if (src.snippet && existing.snippet && src.snippet.trim() === existing.snippet.trim()) {
                isDuplicate = true;
                break;
            }
        }
        if (!isDuplicate) unique.push(src);
    }
    return { deduplicated: unique, uniqueCount: unique.length };
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const ADD_NODES_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'add_map_nodes',
        description: 'Add NEW entities (nodes) to the investigation map. Include at least one source with byte offsets (start/end) if from a document.',
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
                            timestamp: { type: SchemaType.STRING },
                            certaintyScore: { type: SchemaType.NUMBER },
                            sources: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        type: { type: SchemaType.STRING, description: "'web' or 'document'" },
                                        label: { type: SchemaType.STRING, description: 'Source title or file name' },
                                        snippet: { type: SchemaType.STRING },
                                        url: { type: SchemaType.STRING, description: 'URL for web, or file ID for document' },
                                        fileId: { type: SchemaType.STRING, description: 'Required for document sources' },
                                        parentChunkIndex: { type: SchemaType.NUMBER },
                                        start: { type: SchemaType.NUMBER, description: 'Byte offset start' },
                                        end: { type: SchemaType.NUMBER, description: 'Byte offset end' }
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

export const UPDATE_NODE_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'update_map_node',
        description: 'Update an EXISTING node. Use to fix typos or add details.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                id: { type: SchemaType.STRING, description: 'Existing node ID' },
                label: { type: SchemaType.STRING, description: 'Corrected name if needed.' },
                entityType: { type: SchemaType.STRING },
                description: { type: SchemaType.STRING },
                timestamp: { type: SchemaType.STRING },
                certaintyScore: { type: SchemaType.NUMBER },
                tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                sources: {
                    type: SchemaType.ARRAY,
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            type: { type: SchemaType.STRING },
                            label: { type: SchemaType.STRING },
                            snippet: { type: SchemaType.STRING },
                            url: { type: SchemaType.STRING },
                            fileId: { type: SchemaType.STRING },
                            parentChunkIndex: { type: SchemaType.NUMBER },
                            start: { type: SchemaType.NUMBER },
                            end: { type: SchemaType.NUMBER }
                        },
                        required: ['type', 'label', 'snippet', 'url']
                    }
                }
            },
            required: ['id']
        }
    }
};

export const ADD_EDGES_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'add_map_edges',
        description: 'Connect existing nodes.',
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
                            connectionType: { type: SchemaType.STRING, description: 'knows, involved_in, owns, located_at, related_to' },
                            certainty: { type: SchemaType.STRING }
                        },
                        required: ['source', 'target', 'connectionType']
                    }
                }
            },
            required: ['edges']
        }
    }
};

export const REMOVE_EDGE_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'remove_map_edge',
        description: 'Remove incorrect edges.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                edgeIds: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
            },
            required: ['edgeIds']
        }
    }
};

// ─── Layout ──────────────────────────────────────────────────────────────────

export interface NodeInit {
    id: string;
    label: string;
    entityType?: string;
    description?: string;
    sources?: MapNodeSource[];
    timestamp?: string;
    certaintyScore?: number;
}

export function gridLayout(nodes: NodeInit[], existingCount: number): MapNode[] {
    const cols = 4;
    return nodes.map((n, i) => ({
        id: n.id,
        type: 'customEntity' as const,
        position: { x: ((existingCount + i) % cols) * 300 + 100, y: Math.floor((existingCount + i) / cols) * 200 + 100 },
        data: {
            label: n.label,
            entityType: (n.entityType as EntityType) || 'person',
            description: n.description || '',
            sources: n.sources || [],
            timestamp: n.timestamp || '',
            isTimestampVerified: false,
            certaintyScore: n.certaintyScore || 0.5,
            isCertaintyVerified: false,
            lastUpdatedAt: Date.now(),
        },
    }));
}

export function autoLayout(nodes: MapNode[], edges: MapEdge[], direction: 'TB' | 'LR' = 'LR'): MapNode[] {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: direction, nodesep: 80, ranksep: 120 });
    nodes.forEach(n => dagreGraph.setNode(n.id, { width: 260, height: 80 }));
    edges.forEach(e => dagreGraph.setEdge(e.source, e.target));
    dagre.layout(dagreGraph);
    return nodes.map(n => {
        const p = dagreGraph.node(n.id);
        return p ? { ...n, position: { x: p.x - 130, y: p.y - 40 } } : n;
    });
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export function applyToolCalls(
    toolCalls: NonNullable<LlmResponse['toolCalls']>,
    mapStore: MapState,
    nodeLayoutFn: (nodes: NodeInit[]) => MapNode[]
) {
    for (const tc of toolCalls) {
        try {
            const args = JSON.parse(tc.function.arguments);
            switch (tc.function.name) {
                case 'add_map_nodes': {
                    const existingIds = new Set(mapStore.nodes.map((n: MapNode) => n.id));
                    const filtered = (args.nodes || []).filter((n: NodeInit) => !existingIds.has(n.id));
                    const newNodes = nodeLayoutFn(filtered).map(n => {
                        const { deduplicated, uniqueCount } = deduplicateSources(n.data.sources || []);
                        return { ...n, data: { ...n.data, sources: deduplicated, citationCount: uniqueCount } };
                    });
                    mapStore.patchNodes({ add: newNodes });
                    break;
                }
                case 'update_map_node': {
                    const { id, label, entityType, description, timestamp, certaintyScore, tags, sources } = args;
                    const existingNode = mapStore.nodes.find((n: MapNode) => n.id === id);
                    if (existingNode) {
                        const patch: (Partial<MapNode['data']> & { id: string }) = { id };
                        if (label) patch.label = label;
                        if (entityType) patch.entityType = entityType as EntityType;
                        if (description) patch.description = description;
                        if (timestamp) patch.timestamp = timestamp;
                        if (certaintyScore !== undefined) patch.certaintyScore = certaintyScore;
                        if (tags) patch.tags = tags;
                        if (sources) {
                            const { deduplicated, uniqueCount } = deduplicateSources(sources);
                            patch.sources = deduplicated;
                            patch.citationCount = uniqueCount;
                        }
                        mapStore.patchNodes({ update: [patch] });
                    }
                    break;
                }
                case 'add_map_edges': {
                    const newEdges = (args.edges || []).map((e: { source: string; target: string; label: string; connectionType?: string; certainty?: string }) => ({
                        id: `edge-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                        source: e.source, target: e.target, label: e.label,
                        data: { connectionType: e.connectionType || 'related_to', certainty: e.certainty || 'confirmed' }
                    }));
                    mapStore.patchEdges({ add: newEdges });
                    break;
                }
                case 'remove_map_edge': {
                    mapStore.patchEdges({ remove: args.edgeIds || [] });
                    break;
                }
            }
        } catch (e) { console.error('[applyToolCalls] Error:', e); }
    }
}

export const SYSTEM_BASE = `You are a forensic mapping assistant.
CRITICAL: ONLY respond to tool calls. NO text. 
1. Use IDs from the existing list.
2. Ground everything in the provided context. 
3. Fix typos in labels using update_map_node.
4. When adding or updating document sources, you MUST include the start and end byte offsets.`;

// ─── Research ─────────────────────────────────────────────────────────────────

export async function buildResearchContext(opts: {
    cleanInstruction: string;
    mapStore: MapState;
    apiKey: string | undefined;
    selectedModel: Model;
    files: AppFile[];
    chatHistory?: ChatMessage[];
    config?: {
        coordinator: React.MutableRefObject<import('../compute/coordinator').ComputeCoordinator | null>;
        vectorStore: React.MutableRefObject<import('../rag/pipeline').VectorStore | null>;
        queryEmbeddingResolver: React.MutableRefObject<((value: number[]) => void) | null>;
    };
}) {
    const { cleanInstruction, mapStore, apiKey, selectedModel, files, chatHistory, config } = opts;
    const allRawContexts: {
        label: string;
        chunk: string;
        url?: string;
        id?: string;
        start?: number;
        end?: number;
        parentChunkIndex?: number;
    }[] = [];

    // Simple search queries extraction
    const searchQueries = [cleanInstruction.substring(0, 200)];

    // Ingest Chat (Grounding)
    if (chatHistory?.length) {
        allRawContexts.push({ label: 'Recent Chat', chunk: chatHistory.slice(-10).map(m => `[${m.role}]: ${m.content}`).join('\n') });
    }

    // Web Search
    if (mapStore.isWebActive) {
        try {
            const results = await searchWeb(searchQueries[0]);
            if (results) results.slice(0, 5).forEach(r => allRawContexts.push({ label: r.title, chunk: r.snippet, url: r.link }));
        } catch (e) { console.error('Web search error', e); }
    }

    // RAG Search
    if (mapStore.isRagActive && config?.coordinator.current && config?.vectorStore.current) {
        try {
            const queryEmbeddingPromise = new Promise<number[]>((resolve) => { if (config.queryEmbeddingResolver) config.queryEmbeddingResolver.current = resolve; });
            config.coordinator.current.addJob('Map RAG', [{ id: `rag-${Date.now()}`, priority: TaskPriority.P1_Primary, payload: { type: TaskType.EmbedQuery, query: searchQueries[0] } }]);
            const queryEmbedding = await queryEmbeddingPromise;
            const results = config.vectorStore.current.search(queryEmbedding, 10);
            results.forEach((r: SearchResult) => allRawContexts.push({
                label: files.find(f => f.id === r.id)?.name || r.id,
                chunk: r.chunk,
                id: r.id,
                start: r.start,
                end: r.end,
                parentChunkIndex: r.parentChunkIndex
            }));
        } catch (e) { console.error('RAG error', e); }
    }

    const dedup = deduplicateSources(allRawContexts.map(c => ({
        type: c.id ? 'document' : 'web',
        label: c.label,
        snippet: c.chunk,
        url: c.id || c.url || '',
        fileId: c.id,
        start: c.start,
        end: c.end,
        parentChunkIndex: c.parentChunkIndex
    })));

    // Synthesis Turn
    const synthesisPrompt = `Goal: ${cleanInstruction}\nEvidence:\n${dedup.deduplicated.map((d, i) => {
        const meta = d.type === 'document' ? ` [OFFSETS: ${d.start}-${d.end}, CHUNK: ${d.parentChunkIndex}]` : '';
        return `[REF_${i}] ${d.label}: ${d.snippet}${meta}`;
    }).join('\n---\n')}\n\nProduce a Unified Investigation Brief.`;

    const synthResponse = await generateContent(selectedModel, apiKey, [{ role: 'user', content: synthesisPrompt }], []);

    const sourceTable = dedup.deduplicated.map((d, i) => {
        const obj = {
            name: d.label,
            url: d.url,
            fileId: d.fileId,
            start: d.start,
            end: d.end,
            parentChunkIndex: d.parentChunkIndex
        };
        return `REF_${i}: ${JSON.stringify(obj)}`;
    }).join('\n');

    return `SOURCE TABLE:\n${sourceTable}\n\nBRIEF:\n${synthResponse.text || ''}`;
}

// ─── Pipeline ──────────────────────────────────────────────────────────────────

export async function runMappingPipeline(opts: {
    instruction: string;
    mapStore: MapState;
    apiKey: string | undefined;
    selectedModel: Model;
    files: AppFile[];
    appSettings: AppSettings;
    chatHistory?: ChatMessage[];
    contextNodeId?: string;
    caseFileText?: string;
    bubbleSearchResults?: SearchResult[];
    config?: {
        coordinator: React.MutableRefObject<import('../compute/coordinator').ComputeCoordinator | null>;
        vectorStore: React.MutableRefObject<import('../rag/pipeline').VectorStore | null>;
        queryEmbeddingResolver: React.MutableRefObject<((value: number[]) => void) | null>;
    };
    onProgress?: (label: string) => void;
}) {
    const { instruction, apiKey, selectedModel, files, chatHistory, config, onProgress } = opts;

    try {
        // Initial state
        let currentMapState = useMapStore.getState();

        if (onProgress) {
            onProgress('Researching context...');
            currentMapState.refreshLock();
        }
        const context = await buildResearchContext({ cleanInstruction: instruction, mapStore: currentMapState, apiKey, selectedModel, files, chatHistory, config });

        const getExistingNodesPrompt = (state: MapState) => state.nodes.map((n: MapNode) => `${n.id}: ${n.data.label} (${n.data.entityType})`).join('\n');

        // TURN 1: Nodes
        if (onProgress) {
            onProgress('Verifying entities (Turn 1/2)...');
            currentMapState.refreshLock();
        }
        const userContentTurn1 = `SOURCE:\n${instruction}\n\nEVIDENCE:\n${context}\n\nEXISTING NODES:\n${getExistingNodesPrompt(currentMapState)}`;
        const turn1 = await generateContent(selectedModel, apiKey, [
            { role: 'system', content: `${SYSTEM_BASE}\nTask: IDENTITY. Add or update nodes. Fix typos in labels. DO NOT add edges. Cite document sources WITH offsets from the SOURCE TABLE.` },
            { role: 'user', content: userContentTurn1 }
        ], [ADD_NODES_TOOL, UPDATE_NODE_TOOL]);

        if (turn1.toolCalls?.length) {
            applyToolCalls(turn1.toolCalls, currentMapState, (n) => gridLayout(n, currentMapState.nodes.length));
        }

        // RE-FETCH LIVE STATE after Turn 1 updates
        currentMapState = useMapStore.getState();

        // TURN 2: Edges
        if (onProgress) {
            onProgress('Discovering connections (Turn 2/2)...');
            currentMapState.refreshLock();
        }
        const userContentTurn2 = `SOURCE:\n${instruction}\n\nEVIDENCE:\n${context}\n\nNODES TO CONNECT (USE THESE EXACT IDs):\n${getExistingNodesPrompt(currentMapState)}`;
        const turn2 = await generateContent(selectedModel, apiKey, [
            { role: 'system', content: `${SYSTEM_BASE}\nTask: TOPOLOGY. Add or remove edges between nodes. DO NOT add nodes.` },
            { role: 'user', content: userContentTurn2 }
        ], [ADD_EDGES_TOOL, REMOVE_EDGE_TOOL]);

        if (turn2.toolCalls?.length) {
            applyToolCalls(turn2.toolCalls, currentMapState, (n) => gridLayout(n, currentMapState.nodes.length));
        }

        // RE-FETCH LIVE STATE for Final Snap
        currentMapState = useMapStore.getState();

        // Final Snap
        if (onProgress) {
            onProgress('Finalizing layout...');
            currentMapState.refreshLock();
        }
        const finalNodes = currentMapState.nodes.map((n: MapNode) => ({ ...n, data: { ...n.data, mass: calculateNodeMass(n, currentMapState.edges) } }));
        currentMapState.loadMap(autoLayout(finalNodes, currentMapState.edges, 'LR'), currentMapState.edges);
        currentMapState.persistToDB();

        return { success: true, totalChanges: (turn1.toolCalls?.length || 0) + (turn2.toolCalls?.length || 0) };
    } catch (e) { return { success: false, error: String(e) }; }
}
