import { FC, useCallback, useMemo, useState } from 'react';
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
    BackgroundVariant,
    NodeMouseHandler,
    useOnViewportChange,
    ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

import { useMapStore } from '../../store/useMapStore';
import { useToastStore } from '../../store/useToastStore';
import { EntityNode } from '../CaseFile/InvestigationMap/nodes/EntityNode';
import { GroupNode } from '../CaseFile/InvestigationMap/nodes/GroupNode';
import { useMapAI } from '../../hooks/useMapAI';
import { useCaseFileStore } from '../../store/useCaseFileStore';
import { useProjectStore } from '../../store/useProjectStore';
import { useDossierStore } from '../../store/useDossierStore';
import { useDossierAI } from '../../hooks/useDossierAI';
import { useAutoLayout } from '../../hooks/useAutoLayout';
import { useGraphPath } from '../../hooks/useGraphPath';
import { Search, GitFork, Loader, Eye, EyeOff, Trash2, Globe, FileText, MessageSquare, ExternalLink, Network, Focus, X } from 'lucide-react';
import { MapNode, MapNodeSource } from '../../types';
import { ValidatedDateTimeInput } from './ValidatedDateTimeInput';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const nodeTypes: any = {
    customEntity: EntityNode,
    customGroup: GroupNode,
};

interface ContextMenuState {
    x: number;
    y: number;
    nodeId: string;
}

interface SourceDrawerState {
    node: MapNode;
}

interface Props {
    onOpenDossierForNode?: (nodeId: string) => void;
}

const InvestigationMapCanvasInner: FC<Props> = ({ onOpenDossierForNode }) => {
    const { nodes, edges, patchNodes, patchEdges, hideDisproven } = useMapStore();
    const { addToast } = useToastStore();
    const { caseFile } = useCaseFileStore();
    const { dossiers } = useDossierStore();
    const { generateMapFromDocument, handleMapInstruction, reviewMapConnections, isMapProcessing } = useMapAI();
    const { findMatchingDossierId } = useProjectStore();
    const { generateContextualDossier } = useDossierAI();
    const { runLayout, isLayingOut } = useAutoLayout();

    const [searchQuery, setSearchQuery] = useState('');
    const [hideDescriptions, setHideDescriptions] = useState(false);
    const [semanticZoom, setSemanticZoom] = useState(1);
    const [hideEdges, setHideEdges] = useState(false);

    // Focus & Trace State
    const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
    const [highlightDegree, setHighlightDegree] = useState<number>(1);
    const networkNodeIds = useGraphPath(highlightedNodeId, edges, highlightDegree);

    const [edgeToDelete, setEdgeToDelete] = useState<Edge | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [sourceDrawer, setSourceDrawer] = useState<SourceDrawerState | null>(null);

    const activeNode = useMemo(() => {
        if (!sourceDrawer) return null;
        return nodes.find(n => n.id === sourceDrawer.node.id) || null;
    }, [nodes, sourceDrawer, dossiers]); // Added dossiers to reactivity

    const [customInstruction, setCustomInstruction] = useState('');
    const [showInstructionInput, setShowInstructionInput] = useState<string | null>(null);


    // ── RF node/edge transform ─────────────────────────────────────────────────
    useOnViewportChange({
        onChange: (viewport) => setSemanticZoom(viewport.zoom),
    });

    const rfNodes: Node[] = useMemo(() => nodes.filter(n => {
        if (hideDisproven && n.data.certainty === 'disproven') return false;
        return true;
    }).map(n => {
        const isMatch = !searchQuery ||
            n.data.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            n.data.description?.toLowerCase().includes(searchQuery.toLowerCase());

        const isHighlighted = highlightedNodeId ? networkNodeIds.has(n.id) : true;
        const opacity = (!isMatch || !isHighlighted) ? 0.15 : 1;
        const pointerEvents = opacity === 1 ? 'auto' : 'none';

        return {
            ...n,
            style: { ...(((n as unknown) as Node).style || {}), opacity, pointerEvents, transition: 'opacity 0.3s ease' },
            data: { ...n.data, hideDescription: hideDescriptions, semanticZoom },
        };
    }), [nodes, searchQuery, hideDescriptions, hideDisproven, semanticZoom, highlightedNodeId, networkNodeIds]);

    const rfEdges: Edge[] = useMemo(() => {
        // If hideDisproven is active, we also must hide any edges connected to disproven nodes
        const visibleNodeIds = new Set(rfNodes.map(n => n.id));

        return edges
            .filter(e => {
                if (hideDisproven) {
                    return visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target);
                }
                return true;
            })
            .map(e => {
                const isHighlighted = highlightedNodeId ? (networkNodeIds.has(e.source) && networkNodeIds.has(e.target)) : true;
                const rfEdge = e as unknown as Edge;
                return {
                    ...e,
                    type: e.type || 'smoothstep', // Ensure edges default to smoothstep for smart routing
                    hidden: hideEdges,
                    style: { ...rfEdge.style, opacity: isHighlighted ? 1 : 0.1, transition: 'opacity 0.3s ease' }
                };
            });
    }, [edges, hideEdges, hideDisproven, rfNodes, highlightedNodeId, networkNodeIds]);

    // ── RF event handlers ───────────────────────────────────────────────────────
    const onNodesChange = useCallback((changes: NodeChange[]) => {
        const updated: MapNode[] = applyNodeChanges(changes, nodes as Node[]) as unknown as MapNode[];
        // Position changes are applied via react flow locally; we synchronize on drag end
        useMapStore.setState({ nodes: updated });
        if (changes.some(c => c.type !== 'select' && c.type !== 'position')) {
            useMapStore.getState().persistToDB();
        }
    }, [nodes]);

    const onNodeDragStop = useCallback(() => {
        useMapStore.getState().persistToDB();
    }, []);

    const onEdgesChange = useCallback((changes: EdgeChange[]) => {
        const updated = applyEdgeChanges(changes, edges as Edge[]);
        useMapStore.setState({ edges: updated as import('../../types').MapEdge[] });
        if (changes.some(c => c.type !== 'select')) {
            useMapStore.getState().persistToDB();
        }
    }, [edges]);

    const onConnect = useCallback((params: Connection | Edge) => {
        const newEdges = addEdge(params, edges as Edge[]) as unknown as import('../../types').MapEdge[];
        useMapStore.setState({ edges: newEdges });
        useMapStore.getState().persistToDB();
    }, [edges]);

    const onNodeDoubleClick = useCallback((_event: React.MouseEvent, clickedNode: Node) => {
        const node = nodes.find(n => n.id === clickedNode.id);
        if (node) setSourceDrawer({ node });
    }, [nodes]);

    const onEdgeDoubleClick = useCallback((_event: React.MouseEvent, clickedEdge: Edge) => {
        setEdgeToDelete(clickedEdge);
    }, []);

    const onNodeContextMenu: NodeMouseHandler = useCallback((event, node) => {
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    }, []);

    // ── Context menu actions ───────────────────────────────────────────────────
    const handleReviewNode = () => {
        if (!contextMenu) return;
        reviewMapConnections([contextMenu.nodeId]);
        setContextMenu(null);
    };

    const handleDeepDive = () => {
        if (!contextMenu) return;
        const node = nodes.find(n => n.id === contextMenu.nodeId);
        if (node) {
            handleMapInstruction(`Deep dive on "${node.data.label}": search for additional connections and context.`, node.id);
        }
        setContextMenu(null);
    };

    const handleDeleteNode = () => {
        if (!contextMenu) return;
        // Soft delete (AI behavior) -> disproven
        patchNodes({ remove: [contextMenu.nodeId] });
        setContextMenu(null);
    };

    const handleHardDeleteNode = () => {
        if (!contextMenu) return;
        if (window.confirm("Are you sure you want to permanently delete this node and its connections? This action cannot be fully undone if the node was discovered by AI.")) {
            patchNodes({ hardRemove: [contextMenu.nodeId] });
            patchEdges({ remove: edges.filter(e => e.source === contextMenu.nodeId || e.target === contextMenu.nodeId).map(e => e.id) });
        }
        setContextMenu(null);
    };

    const handleOpenDossier = () => {
        if (!contextMenu) return;
        const node = nodes.find(n => n.id === contextMenu.nodeId);
        if (!node) { setContextMenu(null); return; }

        const matchId = findMatchingDossierId(node.data.label, node.id);
        if (matchId) {
            onOpenDossierForNode?.(matchId);
        } else {
            generateContextualDossier(`Create a dossier profiling ${node.data.label} acting as an entity of type ${node.data.entityType}. Focus on existing knowns and relationships.`, undefined, node.id);
        }
        setContextMenu(null);
    };

    const confirmDeleteEdge = () => {
        if (edgeToDelete) {
            patchEdges({ remove: [edgeToDelete.id] });
            setEdgeToDelete(null);
        }
    };

    const handleExpandInstruction = async () => {
        if (!showInstructionInput || !customInstruction.trim()) return;
        await handleMapInstruction(customInstruction, showInstructionInput);
        setCustomInstruction('');
        setShowInstructionInput(null);
    };

    const handleFocusNetwork = () => {
        if (!contextMenu) return;
        setHighlightedNodeId(contextMenu.nodeId);
        setHighlightDegree(1);
        setContextMenu(null);
    };

    // ── Source icon helper ────────────────────────────────────────────────────
    const SourceIcon: FC<{ type: MapNodeSource['type'] }> = ({ type }) => {
        if (type === 'web') return <Globe size={14} />;
        if (type === 'document') return <FileText size={14} />;
        return <MessageSquare size={14} />;
    };

    return (
        <div style={{ width: '100%', height: '100%', flex: 1, minHeight: '400px', background: 'var(--bg-primary)', position: 'relative' }}
            onClick={() => setContextMenu(null)}>

            {/* Filtering Toolbar */}
            <div style={{
                position: 'absolute', top: '16px', right: sourceDrawer ? '340px' : '16px', zIndex: 10,
                background: 'var(--panel-bg-color)', border: '1px solid var(--border-color)',
                borderRadius: '8px', padding: '6px 12px', display: 'flex', alignItems: 'center',
                gap: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', transition: 'right 0.3s ease'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRight: '1px solid var(--border-color)', paddingRight: '12px' }}>
                    <Search size={14} color="var(--text-color-secondary)" />
                    <input
                        type="text"
                        placeholder="Filter nodes…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ border: 'none', background: 'transparent', color: 'var(--text-color)', fontSize: '13px', outline: 'none', width: '140px' }}
                    />
                </div>
                <button
                    onClick={() => runLayout()}
                    className="map-toolbar-btn"
                    title="Clean up map layout automatically"
                    disabled={isLayingOut || nodes.length === 0}
                    style={{ opacity: isLayingOut || nodes.length === 0 ? 0.5 : 1 }}
                >
                    {isLayingOut ? <Loader size={14} className="animate-spin" /> : <Network size={14} />} Layout
                </button>
                <div style={{ width: '1px', height: '16px', background: 'var(--border-color)' }}></div>
                <button onClick={() => setHideDescriptions(!hideDescriptions)} className="map-toolbar-btn" title="Toggle node descriptions">
                    {hideDescriptions ? <EyeOff size={14} /> : <Eye size={14} />} Text
                </button>
                <button onClick={() => setHideEdges(!hideEdges)} className="map-toolbar-btn" title="Toggle edge visibility">
                    {hideEdges ? <EyeOff size={14} /> : <Eye size={14} />} Edges
                </button>
            </div>

            {/* React Flow */}
            <div style={{ position: 'absolute', inset: 0 }}>
                <ReactFlow
                    nodes={rfNodes}
                    edges={rfEdges}
                    onNodesChange={onNodesChange}
                    onNodeDragStop={onNodeDragStop}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeDoubleClick={onNodeDoubleClick}
                    onEdgeDoubleClick={onEdgeDoubleClick}
                    onNodeContextMenu={onNodeContextMenu}
                    nodeTypes={nodeTypes}
                    defaultEdgeOptions={{ type: 'smoothstep' }} // Set default for new edges
                    fitView
                >
                    <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
                    <Controls />
                </ReactFlow>
            </div>

            {/* Radix Context Menu */}
            {contextMenu && (
                <DropdownMenu.Root open={true} onOpenChange={(open) => !open && setContextMenu(null)}>
                    <DropdownMenu.Trigger asChild>
                        <div style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, width: 1, height: 1 }} />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                        <DropdownMenu.Content className="map-context-menu" sideOffset={2}>
                            <DropdownMenu.Item className="map-context-item" onSelect={handleReviewNode}>
                                🔍 Review Connections
                            </DropdownMenu.Item>
                            <DropdownMenu.Item className="map-context-item" onSelect={handleDeepDive}>
                                🌐 Deep Dive (Web Search)
                            </DropdownMenu.Item>
                            <DropdownMenu.Item className="map-context-item" onSelect={handleFocusNetwork}>
                                🎯 Focus on Network
                            </DropdownMenu.Item>
                            <DropdownMenu.Item className="map-context-item" onSelect={() => {
                                setShowInstructionInput(contextMenu.nodeId);
                                setContextMenu(null);
                            }}>
                                ✏️ Expand Details
                            </DropdownMenu.Item>
                            <DropdownMenu.Item className="map-context-item" onSelect={handleOpenDossier}>
                                {(() => {
                                    const node = nodes.find(n => n.id === contextMenu.nodeId);
                                    if (!node) return '📄 Open Dossier';
                                    const matchId = findMatchingDossierId(node.data.label, node.id);
                                    return matchId ? '📄 Open Dossier' : '✨ Create AI Dossier';
                                })()}
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator className="map-context-separator" />
                            <DropdownMenu.Item className="map-context-item map-context-item--danger" onSelect={handleDeleteNode}>
                                🗑️ Remove Node (Disproven)
                            </DropdownMenu.Item>
                            <DropdownMenu.Item className="map-context-item map-context-item--danger" onSelect={handleHardDeleteNode} style={{ color: 'var(--accent-red)' }}>
                                ☠️ Delete Permanently
                            </DropdownMenu.Item>
                        </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                </DropdownMenu.Root>
            )}

            {/* Custom Instruction Input */}
            {showInstructionInput && (
                <div className="map-instruction-overlay" onClick={() => setShowInstructionInput(null)}>
                    <div className="map-instruction-box" onClick={e => e.stopPropagation()}>
                        <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--text-color-secondary)' }}>
                            Describe what to explore or add for this node:
                        </p>
                        <textarea
                            autoFocus
                            className="map-instruction-textarea"
                            value={customInstruction}
                            onChange={e => setCustomInstruction(e.target.value)}
                            placeholder="e.g. Find related organizations and known associates…"
                        />
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                            <button className="button secondary" onClick={() => setShowInstructionInput(null)}>Cancel</button>
                            <button className="button" onClick={handleExpandInstruction} disabled={isMapProcessing}>
                                {isMapProcessing ? <Loader size={14} className="animate-spin" /> : 'Expand'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Source Drawer */}
            {activeNode && (
                <div className="map-source-drawer">
                    <div className="map-source-drawer-header">
                        <div>
                            <div className="map-source-node-label">{activeNode.data.label}</div>
                            <span className={`map-entity-badge map-entity-badge--${activeNode.data.entityType}`}>
                                {activeNode.data.entityType}
                            </span>
                        </div>
                        <button className="icon-btn" onClick={() => setSourceDrawer(null)}>✕</button>
                    </div>

                    <div className="map-source-drawer-body">
                        <div className="map-source-section">
                            {(() => {
                                const matchId = findMatchingDossierId(activeNode.data.label, activeNode.id);
                                if (matchId) {
                                    return (
                                        <button
                                            className="button secondary"
                                            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                                            onClick={() => onOpenDossierForNode?.(matchId)}
                                        >
                                            <FileText size={14} /> Open in Knowledge Base
                                        </button>
                                    );
                                }
                                return (
                                    <button
                                        className="button secondary"
                                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                                        onClick={() => generateContextualDossier(`Create a dossier profiling ${activeNode.data.label} acting as an entity of type ${activeNode.data.entityType}. Focus on existing knowns and relationships.`, undefined, activeNode.id)}
                                    >
                                        <ExternalLink size={14} /> Create AI Dossier
                                    </button>
                                );
                            })()}
                        </div>

                        {activeNode.data.description && (
                            <div className="map-source-section">
                                <div className="map-source-section-title">Description</div>
                                <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5 }}>{activeNode.data.description}</p>
                            </div>
                        )}

                        {/* Phase 1 Verification Fields */}
                        <div className="map-source-section" style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px', background: 'rgba(255,255,255,0.02)' }}>
                            <div className="map-source-section-title" style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Network size={14} /> Analytical Verification
                            </div>
                            
                            {/* Timestamp Verification */}
                            <div style={{ marginBottom: '12px' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text-color-secondary)', marginBottom: '4px' }}>Timestamp (DD.MM.YYYY HH:MM:SS)</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <ValidatedDateTimeInput 
                                        value={activeNode.data.timestamp || null}
                                        onChange={(newTimestamp) => {
                                            patchNodes({ update: [{ id: activeNode.id, timestamp: newTimestamp, isTimestampVerified: false }] });
                                        }}
                                        onConfirm={() => {
                                            // Handle Enter confirmation
                                            if (!activeNode.data.isTimestampVerified && activeNode.data.timestamp) {
                                                patchNodes({ update: [{ id: activeNode.id, isTimestampVerified: true }] });
                                                addToast('Timestamp verified.', 'success');
                                            } else if (!activeNode.data.isCertaintyVerified && activeNode.data.certaintyScore !== undefined) {
                                                patchNodes({ update: [{ id: activeNode.id, isCertaintyVerified: true }] });
                                                addToast('Certainty verified.', 'success');
                                            }
                                        }}
                                    />
                                    <button 
                                        className="icon-btn" 
                                        style={{ color: activeNode.data.isTimestampVerified ? 'var(--accent-green)' : 'var(--text-color-secondary)' }}
                                        onClick={() => patchNodes({ update: [{ id: activeNode.id, isTimestampVerified: true }] })}
                                        title="Verify Timestamp"
                                    >
                                        ✓
                                    </button>
                                    <button 
                                        className="icon-btn" 
                                        onClick={() => patchNodes({ update: [{ id: activeNode.id, timestamp: null, isTimestampVerified: false }] })}
                                        title="Clear Timestamp"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>

                            {/* Certainty Verification */}
                            <div>
                                <div style={{ fontSize: '11px', color: 'var(--text-color-secondary)', marginBottom: '4px' }}>AI Certainty Score (0-100)</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input 
                                        type="range" 
                                        min="0" max="100" 
                                        style={{ flex: 1, accentColor: 'var(--accent-primary)' }}
                                        value={activeNode.data.certaintyScore || 50}
                                        onChange={(e) => {
                                            patchNodes({ update: [{ id: activeNode.id, certaintyScore: parseInt(e.target.value), isCertaintyVerified: false }] });
                                        }}
                                    />
                                    <span style={{ fontSize: '12px', minWidth: '25px' }}>{activeNode.data.certaintyScore || 0}%</span>
                                    <button 
                                        className="icon-btn" 
                                        style={{ color: activeNode.data.isCertaintyVerified ? 'var(--accent-green)' : 'var(--text-color-secondary)' }}
                                        onClick={() => patchNodes({ update: [{ id: activeNode.id, isCertaintyVerified: true }] })}
                                        title="Verify Certainty"
                                    >
                                        ✓
                                    </button>
                                </div>
                            </div>
                        </div>

                        {activeNode.data.tags && activeNode.data.tags.length > 0 && (
                            <div className="map-source-section">
                                <div className="map-source-section-title">Tags</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    {activeNode.data.tags.map(tag => (
                                        <span key={tag} className="map-tag-pill">{tag}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeNode.data.sources && activeNode.data.sources.length > 0 ? (
                            <div className="map-source-section">
                                <div className="map-source-section-title">Sources</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {activeNode.data.sources.map((src, i) => (
                                        <div key={i} className="map-source-card">
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                                <SourceIcon type={src.type} />
                                                <span style={{ fontSize: '12px', fontWeight: 600 }}>{src.label}</span>
                                                {src.url && (
                                                    <a href={src.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto' }}>
                                                        <ExternalLink size={12} />
                                                    </a>
                                                )}
                                            </div>
                                            {src.snippet && (
                                                <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-color-secondary)', lineHeight: 1.4 }}>
                                                    "{src.snippet}"
                                                </p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="map-source-section">
                                <div style={{ fontSize: '12px', color: 'var(--text-color-secondary)', fontStyle: 'italic' }}>No sources recorded for this node.</div>
                            </div>
                        )}

                        {/* Expand with AI */}
                        <div className="map-source-section">
                            <div className="map-source-section-title">Expand with AI</div>
                            <textarea
                                className="map-instruction-textarea"
                                placeholder="Describe what to research about this entity…"
                                value={showInstructionInput === activeNode.id ? customInstruction : ''}
                                onChange={e => {
                                    setShowInstructionInput(activeNode.id);
                                    setCustomInstruction(e.target.value);
                                }}
                                rows={2}
                            />
                            <button
                                className="button"
                                style={{ width: '100%', marginTop: '8px' }}
                                onClick={handleExpandInstruction}
                                disabled={isMapProcessing || !customInstruction.trim()}
                            >
                                {isMapProcessing ? <><Loader size={14} className="animate-spin" /> Processing…</> : 'Expand'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edge deletion dialog */}
            {edgeToDelete && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}
                    onClick={() => setEdgeToDelete(null)}>
                    <div style={{ background: 'var(--panel-bg-color)', border: '1px solid var(--border-color)', padding: '20px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '300px' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Trash2 size={24} style={{ color: '#e74c3c' }} />
                            <div>
                                <h3 style={{ margin: 0, fontSize: '15px' }}>Remove Connection?</h3>
                                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-color-secondary)' }}>This cannot be undone via this dialog but can be undone via the Undo button.</p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                            <button className="button secondary" onClick={() => setEdgeToDelete(null)}>Cancel</button>
                            <button className="button" style={{ background: '#e74c3c', borderColor: '#e74c3c' }} onClick={confirmDeleteEdge}>Remove</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Empty-state overlay */}
            {nodes.length === 0 && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,12,20,0.85)', backdropFilter: 'blur(6px)', gap: '16px' }}>
                    <GitFork size={48} style={{ color: 'var(--text-color-secondary)', opacity: 0.4 }} />
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-color)', marginBottom: '6px' }}>Map is empty</div>
                        <div style={{ fontSize: '13px', color: 'var(--text-color-secondary)', maxWidth: '300px' }}>
                            Load a Case File and generate the map, or use the chat to build it organically.
                        </div>
                    </div>
                    {caseFile && (
                        <button
                            className="button"
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '14px', fontWeight: 600 }}
                            onClick={() => generateMapFromDocument(caseFile.sections)}
                            disabled={isMapProcessing}
                        >
                            {isMapProcessing
                                ? <><Loader size={16} className="animate-spin" /> Building map…</>
                                : <><GitFork size={16} /> Generate Map from Document</>}
                        </button>
                    )}
                </div>
            )}

            {/* Float Highlight Control UI */}
            {highlightedNodeId && (
                <div style={{
                    position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
                    zIndex: 20, background: 'var(--panel-bg-color)', border: '1px solid var(--accent-primary)',
                    borderRadius: '12px', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '16px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.4)', color: 'var(--text-color)'
                }}>
                    <Focus size={18} color="var(--accent-primary)" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600 }}>
                            Tracing: {nodes.find(n => n.id === highlightedNodeId)?.data.label || 'Node'}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-color-secondary)' }}>
                            Showing {highlightDegree}-degree connections ({networkNodeIds.size - 1} connected nodes)
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px', borderLeft: '1px solid var(--border-color)', paddingLeft: '16px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-color-secondary)' }}>Distance:</span>
                        <input
                            type="range"
                            min="1"
                            max="5"
                            value={highlightDegree}
                            onChange={(e) => setHighlightDegree(Number(e.target.value))}
                            style={{ width: '80px', accentColor: 'var(--accent-primary)' }}
                        />
                        <span style={{ fontSize: '12px', fontWeight: 600, width: '12px' }}>{highlightDegree}</span>
                    </div>
                    <button
                        onClick={() => setHighlightedNodeId(null)}
                        style={{ marginLeft: '12px', background: 'transparent', border: 'none', color: 'var(--text-color-secondary)', cursor: 'pointer', padding: '4px' }}
                        title="Clear Focus"
                    >
                        <X size={18} />
                    </button>
                </div>
            )}
        </div>
    );
};

export const InvestigationMapCanvas: FC<Props> = (props) => {
    return (
        <ReactFlowProvider>
            <InvestigationMapCanvasInner {...props} />
        </ReactFlowProvider>
    );
};
