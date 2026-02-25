import { useCallback, useState } from 'react';
import ELK from 'elkjs/lib/elk.bundled.js';
import { Node } from '@xyflow/react';
import { useMapStore } from '../store/useMapStore';

const elk = new ELK();

// Default options for elk layout
const defaultOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT', // LEFT, RIGHT, UP, DOWN
    'elk.spacing.nodeNode': '75',
    'elk.layered.spacing.nodeNodeBetweenLayers': '100',
    'elk.edgeRouting': 'ORTHOGONAL',
};

export const useAutoLayout = () => {
    const [isLayingOut, setIsLayingOut] = useState(false);
    const { nodes, edges } = useMapStore();

    const runLayout = useCallback(async (options = {}) => {
        setIsLayingOut(true);

        try {
            // Convert react-flow nodes/edges to ELK graph format
            const graph = {
                id: 'root',
                layoutOptions: { ...defaultOptions, ...options },
                // Note: ELK needs width/height. We'll provide estimation if not present in RF internals.
                children: nodes.map(n => {
                    const rfNode = n as unknown as Node;
                    return {
                        id: n.id,
                        width: rfNode.measured?.width ?? 200,
                        height: rfNode.measured?.height ?? 100
                    };
                }),
                edges: edges.map(e => ({
                    id: e.id,
                    sources: [e.source],
                    targets: [e.target]
                }))
            };

            const layoutedGraph = await elk.layout(graph);

            // Map the layout output back to React Flow nodes
            if (layoutedGraph.children) {
                const layoutMap: Record<string, { x: number; y: number }> = {};
                layoutedGraph.children.forEach(node => {
                    layoutMap[node.id] = { x: node.x ?? 0, y: node.y ?? 0 };
                });

                // Update the store using patchNodes
                // We're iterating locally to batch a patch instead of 100 individual patches
                const updatedNodes = nodes.map(n => {
                    if (layoutMap[n.id]) {
                        return { ...n, position: { ...layoutMap[n.id] } };
                    }
                    return n;
                });

                useMapStore.setState({ nodes: updatedNodes });
                useMapStore.getState().persistToDB();
            }

        } catch (error) {
            console.error('Error calculating layout with elkjs:', error);
        } finally {
            setIsLayingOut(false);
        }
    }, [nodes, edges]);

    return { runLayout, isLayingOut };
};
