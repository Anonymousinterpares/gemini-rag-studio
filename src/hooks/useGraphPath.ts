import { useMemo } from 'react';
import { MapEdge } from '../types';

/**
 * Calculates all connected nodes radiating outward from a source node
 * up to `maxDegree` hops away. Assumes undirected edges for connection mapping.
 */
export const useGraphPath = (
    sourceNodeId: string | null,
    edges: MapEdge[],
    maxDegree: number = 1
): Set<string> => {
    return useMemo(() => {
        if (!sourceNodeId) return new Set<string>();

        const network = new Set<string>();
        network.add(sourceNodeId);

        // Build adjacency list for fast neighbors lookup (undirected)
        const adjList: Record<string, string[]> = {};
        edges.forEach(e => {
            if (!adjList[e.source]) adjList[e.source] = [];
            if (!adjList[e.target]) adjList[e.target] = [];
            adjList[e.source].push(e.target);
            adjList[e.target].push(e.source);
        });

        // Breadth-First Search
        let currentQueue = [sourceNodeId];
        let currentDegree = 0;

        while (currentQueue.length > 0 && currentDegree < maxDegree) {
            const nextQueue: string[] = [];

            for (const nodeId of currentQueue) {
                const neighbors = adjList[nodeId] || [];
                for (const neighbor of neighbors) {
                    if (!network.has(neighbor)) {
                        network.add(neighbor);
                        nextQueue.push(neighbor);
                    }
                }
            }

            currentQueue = nextQueue;
            currentDegree++;
        }

        return network;
    }, [sourceNodeId, edges, maxDegree]);
};
