import { FC, useCallback, useMemo, useEffect, useState } from 'react';
import {
    ReactFlow,
    Controls,
    Background,
    applyNodeChanges,
    applyEdgeChanges,
    Node,
    Edge,
    NodeChange,
    EdgeChange,
    Connection,
    addEdge,
    BackgroundVariant
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useCaseFileStore } from '../../../store/useCaseFileStore';
import { EntityNode } from './nodes/EntityNode';
import { GroupNode } from './nodes/GroupNode';
import { Search } from 'lucide-react';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const nodeTypes: any = {
    customEntity: EntityNode,
    customGroup: GroupNode,
};

export const InvestigationMapCanvas: FC = () => {
    const { caseFile, updateMapNodes, updateMapEdges, initializeMap } = useCaseFileStore();
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        // Ensure map exists on mount
        if (caseFile && !caseFile.map) {
            initializeMap();
        }
    }, [caseFile, initializeMap]);

    const nodes = useMemo(() => caseFile?.map?.nodes || [], [caseFile?.map?.nodes]);
    const edges = useMemo(() => caseFile?.map?.edges || [], [caseFile?.map?.edges]);

    // Translate back to React Flow format if necessary, though our MapNode/MapEdge 
    // is extremely close to React Flow's Node/Edge definitions.
    const rfNodes: Node[] = useMemo(() => nodes.map(n => {
        const isMatch = !searchQuery ||
            n.data.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            n.data.description?.toLowerCase().includes(searchQuery.toLowerCase());

        return {
            ...n,
            style: { ...(((n as unknown) as Node).style || {}), opacity: isMatch ? 1 : 0.2 },
        };
    }), [nodes, searchQuery]);

    const rfEdges: Edge[] = useMemo(() => edges.map(e => ({
        ...e,
    })), [edges]); // re-run if we want to fade edges too later

    const onNodesChange = useCallback(
        (changes: NodeChange[]) => {
            // @ts-expect-error - React Flow changes are compatible
            updateMapNodes((nds) => applyNodeChanges(changes, nds));
        },
        [updateMapNodes]
    );

    const onEdgesChange = useCallback(
        (changes: EdgeChange[]) => {
            // @ts-expect-error - React Flow changes are compatible
            updateMapEdges((eds) => applyEdgeChanges(changes, eds));
        },
        [updateMapEdges]
    );

    const onConnect = useCallback(
        (params: Connection | Edge) => {
            updateMapEdges((eds) => addEdge(params, eds as Edge[]) as unknown as import('../../../types').MapEdge[]);
        },
        [updateMapEdges]
    );

    return (
        <div style={{ width: '100%', height: '100%', background: 'var(--bg-primary)', position: 'relative' }}>
            {/* Filtering Toolbar */}
            <div style={{
                position: 'absolute', top: '16px', right: '16px', zIndex: 10,
                background: 'var(--panel-bg-color)', border: '1px solid var(--border-color)',
                borderRadius: '8px', padding: '6px 12px', display: 'flex', alignItems: 'center',
                gap: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}>
                <Search size={14} color="var(--text-color-secondary)" />
                <input
                    type="text"
                    placeholder="Filter map nodes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                        border: 'none', background: 'transparent', color: 'var(--text-color)',
                        fontSize: '13px', outline: 'none', width: '200px'
                    }}
                />
            </div>

            <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                fitView
            >
                <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
                <Controls />
            </ReactFlow>
        </div>
    );
};
