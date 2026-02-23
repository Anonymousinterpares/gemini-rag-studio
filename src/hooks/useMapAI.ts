import { useCallback, useState } from 'react';
import { useCaseFileStore } from '../store/useCaseFileStore';
import { useSettingsStore } from '../store';
import { generateContent, Tool, SchemaType } from '../api/llm-provider';
import { ChatMessage, MapNode, MapEdge } from '../types';

const MAP_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'update_investigation_map',
        description: 'Updates the investigation map by adding new nodes and edges, or updating existing ones, based on user instructions and the current case file context.',
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                newNodes: {
                    type: SchemaType.ARRAY,
                    description: 'A list of new nodes to add to the map.',
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            id: { type: SchemaType.STRING, description: 'Unique ID for the node, e.g., "node-john-doe"' },
                            label: { type: SchemaType.STRING, description: 'Display name of the entity' },
                            entityType: { type: SchemaType.STRING, description: 'Must be one of: person, location, event, organization, evidence' },
                            description: { type: SchemaType.STRING, description: 'Short context about this entity' }
                        },
                        required: ['id', 'label', 'entityType']
                    }
                },
                newEdges: {
                    type: SchemaType.ARRAY,
                    description: 'A list of connections (edges) to add between nodes.',
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            source: { type: SchemaType.STRING, description: 'Node ID of the source' },
                            target: { type: SchemaType.STRING, description: 'Node ID of the target' },
                            label: { type: SchemaType.STRING, description: 'Optional short description of the connection' },
                            connectionType: { type: SchemaType.STRING, description: 'Must be one of: knows, involved_in, owns, located_at, conflicts_with, related_to' }
                        },
                        required: ['source', 'target', 'connectionType']
                    }
                }
            }
        }
    }
};

export const useMapAI = () => {
    const [isMapProcessing, setIsMapProcessing] = useState(false);
    const { caseFile, updateMapNodes, updateMapEdges } = useCaseFileStore();
    const { selectedModel, selectedProvider, apiKeys } = useSettingsStore();

    const handleMapInstruction = useCallback(async (
        instruction: string,
        contextNodeId?: string
    ) => {
        if (!caseFile || !caseFile.map) return;

        setIsMapProcessing(true);
        const apiKey = apiKeys[selectedProvider];

        try {
            const currentNodes = caseFile.map.nodes || [];
            const currentEdges = caseFile.map.edges || [];

            const systemPrompt = `You are a forensic mapping assistant. You help build an investigation map for a case file.
Current Map State: ${currentNodes.length} nodes, ${currentEdges.length} edges.

Your job is to execute the 'update_investigation_map' tool to add to the map based on the user's instruction.
Return the tool call ONLY. Do not provide conversational text.`;

            let userContent = `Instruction: ${instruction}`;

            if (contextNodeId) {
                const targetNode = currentNodes.find(n => n.id === contextNodeId);
                if (targetNode) {
                    userContent += `\n\nFocus context on node: ${JSON.stringify(targetNode)}`;
                }
            }

            // Add actual case file text for context
            const caseFileText = caseFile.sections.map(s => s.content).join('\n\n');
            userContent += `\n\nCase File Context:\n${caseFileText.substring(0, 15000)}`;

            const messages: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ];

            const response = await generateContent(selectedModel, apiKey, messages, [MAP_TOOL]);

            if (response.toolCalls && response.toolCalls.length > 0) {
                for (const tc of response.toolCalls) {
                    if (tc.function.name === 'update_investigation_map') {
                        const args = JSON.parse(tc.function.arguments);
                        const incomingNodes = args.newNodes || [];
                        const incomingEdges = args.newEdges || [];

                        // Add standard React Flow fields and layout
                        const parentNode = contextNodeId ? currentNodes.find(n => n.id === contextNodeId) : null;
                        const centerX = parentNode ? parentNode.position.x : 250;
                        const centerY = parentNode ? parentNode.position.y : 250;
                        const radius = 200;

                        const finalNodes: MapNode[] = incomingNodes.map((n: { id: string; label: string; entityType?: string; description?: string }, i: number) => {
                            // Radial layout around parent or center
                            const angle = (2 * Math.PI / incomingNodes.length) * i;
                            return {
                                id: n.id,
                                type: 'customEntity',
                                position: {
                                    x: centerX + Math.cos(angle) * (radius + Math.random() * 50),
                                    y: centerY + Math.sin(angle) * (radius + Math.random() * 50)
                                },
                                data: {
                                    label: n.label,
                                    entityType: n.entityType || 'person',
                                    description: n.description
                                }
                            };
                        });

                        const finalEdges: MapEdge[] = incomingEdges.map((e: { source: string; target: string; label?: string; connectionType?: string }) => ({
                            id: `edge-${Date.now()}-${e.source}-${e.target}`,
                            source: e.source,
                            target: e.target,
                            label: e.label,
                            data: {
                                connectionType: e.connectionType || 'related_to',
                                certainty: 'confirmed'
                            }
                        }));

                        if (finalNodes.length > 0) {
                            updateMapNodes(prev => [...prev, ...finalNodes]);
                        }
                        if (finalEdges.length > 0) {
                            updateMapEdges(prev => [...prev, ...finalEdges]);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Map AI Error:", error);
        } finally {
            setIsMapProcessing(false);
        }
    }, [caseFile, updateMapNodes, updateMapEdges, selectedModel, apiKeys, selectedProvider]);

    return { handleMapInstruction, isMapProcessing };
};
