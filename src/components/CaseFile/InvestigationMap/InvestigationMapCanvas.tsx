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
import { useMapAI } from '../../../hooks/useMapAI';
import { Search, GitFork, Loader, Eye, EyeOff, Trash2 } from 'lucide-react';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const nodeTypes: any = {
    customEntity: EntityNode,
    customGroup: GroupNode,
};

export const InvestigationMapCanvas: FC = () => {
    const { caseFile, updateMapNodes, updateMapEdges, initializeMap } = useCaseFileStore();
    const [searchQuery, setSearchQuery] = useState('');
    const [hideDescriptions, setHideDescriptions] = useState(false);
    const [hideEdges, setHideEdges] = useState(false);
    const [edgeToDelete, setEdgeToDelete] = useState<Edge | null>(null);
    const { generateMapFromDocument, isMapProcessing } = useMapAI();

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
            data: {
                ...n.data,
                hideDescription: hideDescriptions
            }
        };
    }), [nodes, searchQuery, hideDescriptions]);

    const rfEdges: Edge[] = useMemo(() => edges.map(e => ({
        ...e,
        hidden: hideEdges
    })), [edges, hideEdges]); // re-run if we want to fade edges too later

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

    const onNodeDoubleClick = useCallback((event: React.MouseEvent, clickedNode: Node) => {
        event.preventDefault();

        // 2) Ctrl + Double Click -> select all nodes of the same type
        if (event.ctrlKey || event.metaKey) {
            const matchType = clickedNode.data?.entityType;
            if (matchType) {
                updateMapNodes((nds) => nds.map(n => ({
                    ...n,
                    selected: n.data?.entityType === matchType
                })));
            }
            return;
        }

        // 1) Double Click -> select node + all its descendants (subnodes)
        const descendantIds = new Set<string>();
        descendantIds.add(clickedNode.id);

        const queue = [clickedNode.id];
        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const outgoingEdges = edges.filter(e => e.source === currentId);
            for (const edge of outgoingEdges) {
                if (!descendantIds.has(edge.target)) {
                    descendantIds.add(edge.target);
                    queue.push(edge.target);
                }
            }
        }

        updateMapNodes((nds) => nds.map(n => ({
            ...n,
            selected: descendantIds.has(n.id)
        })));

    }, [edges, updateMapNodes]);

    const onEdgeDoubleClick = useCallback((event: React.MouseEvent, clickedEdge: Edge) => {
        event.preventDefault();
        setEdgeToDelete(clickedEdge);
    }, []);

    const confirmDeleteEdge = () => {
        if (edgeToDelete) {
            updateMapEdges((eds) => eds.filter(e => e.id !== edgeToDelete.id));
            setEdgeToDelete(null);
        }
    };

    return (
        <div style={{ width: '100%', height: '100%', flex: 1, minHeight: '400px', background: 'var(--bg-primary)', position: 'relative' }}>
            {/* Filtering Toolbar */}
            <div style={{
                position: 'absolute', top: '16px', right: '16px', zIndex: 10,
                background: 'var(--panel-bg-color)', border: '1px solid var(--border-color)',
                borderRadius: '8px', padding: '6px 12px', display: 'flex', alignItems: 'center',
                gap: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRight: '1px solid var(--border-color)', paddingRight: '12px' }}>
                    <Search size={14} color="var(--text-color-secondary)" />
                    <input
                        type="text"
                        placeholder="Filter map nodes..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            border: 'none', background: 'transparent', color: 'var(--text-color)',
                            fontSize: '13px', outline: 'none', width: '160px'
                        }}
                    />
                </div>

                <button
                    onClick={() => setHideDescriptions(!hideDescriptions)}
                    style={{ background: 'none', border: 'none', color: hideDescriptions ? 'var(--text-color-secondary)' : 'var(--text-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: 0 }}
                    title="Toggle Node Descriptions"
                >
                    {hideDescriptions ? <EyeOff size={14} /> : <Eye size={14} />}
                    Text
                </button>

                <button
                    onClick={() => setHideEdges(!hideEdges)}
                    style={{ background: 'none', border: 'none', color: hideEdges ? 'var(--text-color-secondary)' : 'var(--text-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: 0 }}
                    title="Toggle Connections"
                >
                    {hideEdges ? <EyeOff size={14} /> : <Eye size={14} />}
                    Edges
                </button>
            </div>


            {/* React Flow Graph */}
            <div style={{ position: 'absolute', inset: 0 }}>
                <ReactFlow
                    nodes={rfNodes}
                    edges={rfEdges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeDoubleClick={onNodeDoubleClick}
                    onEdgeDoubleClick={onEdgeDoubleClick}
                    nodeTypes={nodeTypes}
                    fitView
                >
                    <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
                    <Controls />
                </ReactFlow>
            </div>

            {/* Edge Deletion Confirmation Dialog */}
            {edgeToDelete && (
                <div style={{
                    position: 'absolute', inset: 0, zIndex: 100,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)'
                }} onClick={() => setEdgeToDelete(null)}>
                    <div style={{
                        background: 'var(--panel-bg-color)', border: '1px solid var(--border-color)',
                        padding: '20px', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                        display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '300px'
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-color)' }}>
                            <Trash2 size={24} style={{ color: 'var(--accent-red)' }} />
                            <div>
                                <h3 style={{ margin: 0, fontSize: '15px' }}>Remove Connection?</h3>
                                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-color-secondary)' }}>
                                    Are you sure you want to delete this connection?
                                </p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
                            <button className="button secondary" onClick={() => setEdgeToDelete(null)}>Cancel</button>
                            <button className="button" style={{ background: 'var(--accent-red)', borderColor: 'var(--accent-red)' }} onClick={confirmDeleteEdge}>Remove</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Empty-state overlay */}
            {(!caseFile?.map?.nodes || caseFile.map.nodes.length === 0) && (
                <div style={{
                    position: 'absolute', inset: 0, zIndex: 50,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(10,12,20, 0.85)',
                    backdropFilter: 'blur(6px)',
                    gap: '16px',
                }}>
                    <GitFork size={48} style={{ color: 'var(--text-color-secondary)', opacity: 0.4 }} />
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-color)', marginBottom: '6px' }}>Map is empty</div>
                        <div style={{ fontSize: '13px', color: 'var(--text-color-secondary)', maxWidth: '300px' }}>
                            Let the AI read your case file and automatically build the initial map of entities and connections.
                        </div>
                    </div>
                    <button
                        className="button"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '14px', fontWeight: 600 }}
                        onClick={generateMapFromDocument}
                        disabled={isMapProcessing}
                    >
                        {isMapProcessing
                            ? <><Loader size={16} className="animate-spin" /> Analysing document...</>
                            : <><GitFork size={16} /> Generate Map from Document</>}
                    </button>
                    {isMapProcessing && (
                        <div style={{ fontSize: '12px', color: 'var(--text-color-secondary)' }}>
                            This may take a moment depending on document size…
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
