import { useCallback, useState } from 'react';
import { useMapStore } from '../store/useMapStore';
import { useMapUpdateQueue } from '../store/useMapUpdateQueue';
import { useSettingsStore } from '../store';
import { generateContent, Tool, SchemaType } from '../api/llm-provider';
import { ChatMessage, MapNode, MapEdge, MapNodeSource, CaseFileSection } from '../types';
import { useToastStore } from '../store/useToastStore';

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
                            sources: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        type: { type: SchemaType.STRING, description: 'One of: web, document, chat_exchange' },
                                        label: { type: SchemaType.STRING },
                                        snippet: { type: SchemaType.STRING },
                                    },
                                    required: ['type', 'label']
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
        description: 'Update an EXISTING node by its ID. Only allowed fields: description, tags, sources. Never change label or entityType.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                id: { type: SchemaType.STRING, description: 'Existing node ID to update' },
                description: { type: SchemaType.STRING },
                tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                sources: {
                    type: SchemaType.ARRAY,
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            type: { type: SchemaType.STRING },
                            label: { type: SchemaType.STRING },
                            snippet: { type: SchemaType.STRING },
                        },
                        required: ['type', 'label']
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
                            certainty: { type: SchemaType.STRING, description: 'One of: confirmed, suspected, disproven' }
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
function gridLayout(nodes: { id: string; label: string; entityType?: string; description?: string; sources?: MapNodeSource[] }[], existingCount: number): MapNode[] {
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
            lastUpdatedAt: Date.now(),
        },
    }));
}

function radialLayout(nodes: { id: string; label: string; entityType?: string; description?: string; sources?: MapNodeSource[] }[], cx: number, cy: number): MapNode[] {
    const radius = 250;
    return nodes.map((n, i) => {
        const angle = (2 * Math.PI / Math.max(nodes.length, 1)) * i;
        return {
            id: n.id,
            type: 'customEntity' as const,
            position: {
                x: cx + Math.cos(angle) * (radius + Math.random() * 40),
                y: cy + Math.sin(angle) * (radius + Math.random() * 40),
            },
            data: {
                label: n.label,
                entityType: (n.entityType as MapNode['data']['entityType']) || 'person',
                description: n.description,
                sources: n.sources,
                lastUpdatedAt: Date.now(),
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
                mapStore.patchNodes({ add: newNodes });
                break;
            }
            case 'update_map_node': {
                const { id, ...rest } = args;
                mapStore.patchNodes({ update: [{ id, ...rest }] });
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
                break;
            }
            case 'remove_map_edge': {
                mapStore.patchEdges({ remove: args.edgeIds || [] });
                break;
            }
        }
    }
}

// ─── System prompts ────────────────────────────────────────────────────────────
const SYSTEM_BASE = `You are a forensic mapping assistant for an investigation analysis tool.
STRICT RULES:
1. USE ONLY THE PROVIDED TOOLS. No conversational text.
2. NEVER add a node whose ID already appears in the existing node list.
3. NEVER recreate the full map — only ADD or UPDATE specific items.
4. Every node/edge you add MUST be grounded in the provided context.`;

// ─── Hook ──────────────────────────────────────────────────────────────────────

export const useMapAI = () => {
    const [isMapProcessing, setIsMapProcessing] = useState(false);
    const [reviewTokenWarning, setReviewTokenWarning] = useState<{
        estimatedTokens: number;
        onConfirmAll: () => void;
        onConfirmTrimmed: () => void;
        onCancel: () => void;
    } | null>(null);

    const { selectedModel, selectedProvider, apiKeys } = useSettingsStore();
    const { addToast } = useToastStore();

    // ── handleMapInstruction ──────────────────────────────────────────────────
    const handleMapInstruction = useCallback(async (
        instruction: string,
        contextNodeId?: string,
        caseFileText?: string
    ) => {
        const mapStore = useMapStore.getState();
        if (!mapStore.acquireLock()) {
            addToast('Map update already in progress. Please wait.', 'warning');
            return;
        }

        setIsMapProcessing(true);
        const apiKey = apiKeys[selectedProvider];

        try {
            const currentNodes = mapStore.nodes;
            const currentEdges = mapStore.edges;
            const existingNodeList = currentNodes.map(n => `${n.id}: ${n.data.label} (${n.data.entityType})`).join('\n');

            let userContent = `Instruction: ${instruction}\n\nExisting Nodes:\n${existingNodeList}\n\nTotal edges: ${currentEdges.length}`;

            if (contextNodeId) {
                const targetNode = currentNodes.find(n => n.id === contextNodeId);
                if (targetNode) {
                    userContent += `\n\nFocus on node: ${JSON.stringify({ id: targetNode.id, label: targetNode.data.label, description: targetNode.data.description })}`;
                }
            }

            if (caseFileText) {
                userContent += `\n\nContext:\n${caseFileText.substring(0, 12000)}`;
            }

            const messages: ChatMessage[] = [
                { role: 'system', content: SYSTEM_BASE },
                { role: 'user', content: userContent }
            ];

            const response = await generateContent(selectedModel, apiKey, messages, [ADD_NODES_TOOL, UPDATE_NODE_TOOL, ADD_EDGES_TOOL, REMOVE_EDGE_TOOL]);

            if (response.toolCalls?.length) {
                const cx = contextNodeId ? (currentNodes.find(n => n.id === contextNodeId)?.position.x ?? 400) : 400;
                const cy = contextNodeId ? (currentNodes.find(n => n.id === contextNodeId)?.position.y ?? 400) : 400;
                applyToolCalls(response.toolCalls, mapStore, (nodes) => radialLayout(nodes, cx, cy));
            }
        } catch (error) {
            console.error('[MapAI] handleMapInstruction error:', error);
        } finally {
            setIsMapProcessing(false);
            mapStore.releaseLock();
            mapStore.setProgress(null);
            // Drain one queued update
            drainUpdateQueue();
        }
    }, [apiKeys, selectedProvider, selectedModel, addToast]);

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
            // ── Phase 1: Parallel entity extraction (batches of 3 sections) ──────
            const BATCH_SIZE = 3;
            const batches: CaseFileSection[][] = [];
            for (let i = 0; i < caseFileSections.length; i += BATCH_SIZE) {
                batches.push(caseFileSections.slice(i, i + BATCH_SIZE));
            }

            mapStore.setProgress({ phase: 1, batchCurrent: 0, batchTotal: batches.length, label: 'Extracting entities…' });

            const phase1Results = await Promise.all(batches.map(async (batch, batchIdx) => {
                const batchText = batch.map(s => s.content).join('\n\n');
                const messages: ChatMessage[] = [
                    {
                        role: 'system',
                        content: `${SYSTEM_BASE}\n\nTask: Extract ALL unique entities from the provided text. Use add_map_nodes ONLY. Do not add edges in this phase.`
                    },
                    {
                        role: 'user',
                        content: `Extract entities from sections ${batchIdx * BATCH_SIZE + 1}-${Math.min((batchIdx + 1) * BATCH_SIZE, caseFileSections.length)}:\n\n${batchText.substring(0, 10000)}`
                    }
                ];

                const response = await generateContent(selectedModel, apiKey, messages, [ADD_NODES_TOOL]);
                mapStore.setProgress({ phase: 1, batchCurrent: batchIdx + 1, batchTotal: batches.length, label: 'Extracting entities…' });
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

            // ── Phase 2: Single connection pass ──────────────────────────────────
            mapStore.setProgress({ phase: 2, batchCurrent: 0, batchTotal: 1, label: 'Connecting entities…' });

            const currentNodes = mapStore.nodes;
            const nodeList = currentNodes.map(n => `${n.id}: ${n.data.label} (${n.data.entityType})`).join('\n');
            const fullText = caseFileSections.map(s => s.content).join('\n\n');

            const phase2Messages: ChatMessage[] = [
                {
                    role: 'system',
                    content: `${SYSTEM_BASE}\n\nTask: ONLY wire connections between the existing nodes listed below. Use add_map_edges and update_map_node only. Do NOT add new nodes.`
                },
                {
                    role: 'user',
                    content: `Existing nodes:\n${nodeList}\n\nCase file:\n${fullText.substring(0, 15000)}`
                }
            ];

            const phase2Response = await generateContent(selectedModel, apiKey, phase2Messages, [ADD_EDGES_TOOL, UPDATE_NODE_TOOL]);

            if (phase2Response.toolCalls?.length) {
                applyToolCalls(phase2Response.toolCalls, mapStore, (nodes) => gridLayout(nodes, currentNodes.length));
            }

            mapStore.setProgress({ phase: 2, batchCurrent: 1, batchTotal: 1, label: 'Done' });

        } catch (error) {
            console.error('[MapAI] generateMapFromDocument error:', error);
        } finally {
            setIsMapProcessing(false);
            mapStore.releaseLock();
            mapStore.setProgress(null);
            drainUpdateQueue();
        }
    }, [apiKeys, selectedProvider, selectedModel, addToast]);

    // ── reviewMapConnections ────────────────────────────────────────────────────
    const reviewMapConnections = useCallback(async (nodeIds?: string[]) => {
        const mapStore = useMapStore.getState();
        const allNodes = mapStore.nodes;
        const allEdges = mapStore.edges;

        // Build neighborhood
        let targetNodes: MapNode[];
        if (nodeIds && nodeIds.length > 0) {
            const targetSet = new Set(nodeIds);
            // Include 1-hop neighbors
            const neighborIds = new Set<string>(nodeIds);
            allEdges.forEach(e => {
                if (targetSet.has(e.source)) neighborIds.add(e.target);
                if (targetSet.has(e.target)) neighborIds.add(e.source);
            });
            targetNodes = allNodes.filter(n => neighborIds.has(n.id));
        } else {
            targetNodes = allNodes;
        }

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
                        content: `${SYSTEM_BASE}\n\nTask: Review the connections between the given nodes for accuracy. Remove incorrect edges using remove_map_edge. Add missing connections using add_map_edges.`
                    },
                    {
                        role: 'user',
                        content: `Nodes to review:\n${nodeList}\n\nExisting edges:\n${edgeList}`
                    }
                ];

                const response = await generateContent(selectedModel, apiKey, messages, [ADD_EDGES_TOOL, REMOVE_EDGE_TOOL, UPDATE_NODE_TOOL]);
                if (response.toolCalls?.length) {
                    applyToolCalls(response.toolCalls, mapStore, (nodes) => radialLayout(nodes, 400, 400));
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
                    // Keep only top 15 by edge degree
                    const degreeCounts = new Map<string, number>();
                    allEdges.forEach(e => {
                        degreeCounts.set(e.source, (degreeCounts.get(e.source) || 0) + 1);
                        degreeCounts.set(e.target, (degreeCounts.get(e.target) || 0) + 1);
                    });
                    const trimmed = [...targetNodes]
                        .sort((a, b) => (degreeCounts.get(b.id) || 0) - (degreeCounts.get(a.id) || 0))
                        .slice(0, 15);
                    runReview(trimmed);
                },
                onCancel: () => setReviewTokenWarning(null),
            });
        } else {
            runReview(targetNodes);
        }
    }, [apiKeys, selectedProvider, selectedModel, addToast]);

    // ── drainUpdateQueue ────────────────────────────────────────────────────────
    const drainUpdateQueue = useCallback(async () => {
        const queue = useMapUpdateQueue.getState();
        const update = queue.dequeueUpdate();
        if (!update || update.length === 0) return;

        const summaries = update.map(r => `**${r.title}** (${r.link})\n${r.snippet}`).join('\n---\n');
        await handleMapInstruction(`Incorporate the following new research findings into the map:\n${summaries}`);

        addToast(`Map updated from search results.`, 'success');
    }, [handleMapInstruction, addToast]);

    return {
        handleMapInstruction,
        generateMapFromDocument,
        reviewMapConnections,
        isMapProcessing,
        reviewTokenWarning,
        dismissReviewWarning: () => setReviewTokenWarning(null),
    };
};
