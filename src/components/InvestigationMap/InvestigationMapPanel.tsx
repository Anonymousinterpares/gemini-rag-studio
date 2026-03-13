import { FC, useState, useEffect, MutableRefObject } from 'react';
import { Undo2, Redo2, Network, X, GitMerge, Loader, Maximize2, Minimize2, Trash2, Power } from 'lucide-react';
import { useMapStore } from '../../store/useMapStore';
import { useMapAI } from '../../hooks/useMapAI';
import { useMeasure } from '../../hooks';
import { InvestigationMapCanvas } from './InvestigationMapCanvas';
import { ComputeCoordinator } from '../../compute/coordinator';
import { VectorStore } from '../../rag/pipeline';
import { ProgressBar } from '../ProgressBar';
import './InvestigationMapPanel.css';

const MapLockIndicator: FC<{ expiresAt: number; onCancel: () => void }> = ({ expiresAt, onCancel }) => {
    const [timeLeft, setTimeLeft] = useState(Math.max(0, expiresAt - Date.now()));

    useEffect(() => {
        // Reset timeLeft immediately when expiresAt changes
        setTimeLeft(Math.max(0, expiresAt - Date.now()));
        
        const interval = setInterval(() => {
            const remaining = Math.max(0, expiresAt - Date.now());
            setTimeLeft(remaining);
            if (remaining === 0) clearInterval(interval);
        }, 100);
        return () => clearInterval(interval);
    }, [expiresAt]);

    const totalDuration = 90000;
    const progressPercent = Math.min(100, Math.max(0, (timeLeft / totalDuration) * 100));
    
    // Circle math
    const radius = 10;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

    return (
        <button 
            className="map-lock-indicator-btn" 
            onClick={onCancel} 
            title={`Cancel Generation (Auto-cancels in ${Math.ceil(timeLeft / 1000)}s)`}
        >
            <svg width="24" height="24" viewBox="0 0 24 24" className="map-lock-ring">
                <circle className="map-lock-ring-bg" cx="12" cy="12" r={radius} strokeWidth="2" fill="none" />
                <circle 
                    className="map-lock-ring-fg" 
                    cx="12" cy="12" r={radius} 
                    strokeWidth="2" 
                    fill="none" 
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    transform="rotate(-90 12 12)"
                />
            </svg>
            <span className="map-lock-stop-icon"></span>
        </button>
    );
};

interface Props {
    onClose: () => void;
    onOpenDossierForNode?: (nodeId: string) => void;
    onOpenFileChunk?: (fileId: string, chunkIndex: number, start?: number, end?: number) => void;
    coordinator?: MutableRefObject<ComputeCoordinator | null>;
    vectorStore?: MutableRefObject<VectorStore | null>;
    queryEmbeddingResolver?: MutableRefObject<((value: number[]) => void) | null>;
}

// ── Token Budget Warning Modal ───────────────────────────────────────────────
interface TokenWarningProps {
    estimatedTokens: number;
    onConfirmAll: () => void;
    onConfirmTrimmed: () => void;
    onCancel: () => void;
}

const TokenBudgetWarning: FC<TokenWarningProps> = ({ estimatedTokens, onConfirmAll, onConfirmTrimmed, onCancel }) => (
    <div className="map-modal-backdrop" onClick={onCancel}>
        <div className="map-modal-box" onClick={e => e.stopPropagation()}>
            <h3 className="map-modal-title">⚠️ Large Review Detected</h3>
            <p className="map-modal-body">
                This review involves approximately <strong>{Math.round(estimatedTokens / 1000)}k tokens</strong>.
                A full review may be slow and expensive.
            </p>
            <div className="map-modal-actions">
                <button className="button secondary" onClick={onCancel}>Cancel</button>
                <button className="button secondary" onClick={onConfirmTrimmed}>
                    Review Top 15 Nodes
                </button>
                <button className="button" onClick={onConfirmAll}>
                    Review All ({estimatedTokens > 1000 ? `~${Math.round(estimatedTokens / 1000)}k` : estimatedTokens} tokens)
                </button>
            </div>
        </div>
    </div>
);

export const InvestigationMapPanel: FC<Props> = ({ onClose, onOpenDossierForNode, onOpenFileChunk, coordinator, vectorStore, queryEmbeddingResolver }) => {
    const {
        nodes, edges, undo, redo, undoStack, redoStack, progress, jobLock, lockExpiresAt, clearMap,
        isRagEnabled, isRagActive, isWebActive, isDeepActive, isRetrieving,
        setIsRagActive, setIsWebActive, setIsDeepActive
    } = useMapStore();
    const { reviewMapConnections, reviewTokenWarning } = useMapAI();
    const [isMaximized, setIsMaximized] = useState(false);
    const [measureRef, dimensions] = useMeasure<HTMLDivElement>();

    const handleClearMap = () => {
        if (window.confirm("Are you sure you want to clear the entire map? This cannot be fully undone.")) {
            clearMap();
        }
    };

    return (
        <div className={`investigation-map-panel ${isMaximized ? 'maximized' : ''}`}>

            {/* ── Header ────────────────────────────────────────────────────── */}
            <div className="map-panel-header">
                <div className="map-panel-header-left">
                    <Network size={18} />
                    <span className="map-panel-title">Investigation Map</span>
                    <span className="map-stat-badge">{nodes.length} nodes · {edges.length} edges</span>

                    {/* Source Orchestration */}
                    <div className="map-source-controls">
                        <div className={`map-source-indicator rag ${isRagEnabled ? 'available' : 'disabled'} ${isRagActive ? 'active' : 'inactive'}`}>
                            <span className="badge">RAG</span>
                            <button
                                className="source-toggle"
                                onClick={() => isRagEnabled && setIsRagActive(!isRagActive)}
                                title={isRagEnabled ? (isRagActive ? "Deactivate RAG Search" : "Activate RAG Search") : "Knowledge Base Empty"}
                                disabled={!isRagEnabled}
                            >
                                <Power size={10} />
                            </button>
                        </div>
                        <div className={`map-source-indicator web ${isWebActive ? 'active' : 'inactive'}`}>
                            <span className="badge">WEB</span>
                            <button
                                className="source-toggle"
                                onClick={() => setIsWebActive(!isWebActive)}
                                title={isWebActive ? "Deactivate Web Research" : "Activate Web Research"}
                            >
                                <Power size={10} />
                            </button>
                        </div>
                        <div className={`map-source-indicator deep ${isDeepActive ? 'active' : 'inactive'}`}>
                            <span className="badge">DEEP</span>
                            <button
                                className="source-toggle"
                                onClick={() => setIsDeepActive(!isDeepActive)}
                                title={isDeepActive ? "Deactivate Deep Analysis" : "Activate Deep Analysis Map Update"}
                            >
                                <Power size={10} />
                            </button>
                        </div>
                    </div>

                    <button
                        className="map-clear-btn"
                        title="Clear entire map"
                        onClick={handleClearMap}
                        disabled={nodes.length === 0 || jobLock}
                    >
                        <Trash2 size={14} />
                    </button>
                </div>

                {isRetrieving && (
                    <div className="map-retrieving-indicator">
                        <Loader size={13} className="animate-spin" />
                        <span>Searching Knowledge Base...</span>
                    </div>
                )}



                <div className="map-panel-header-right">
                    <button
                        className="map-header-btn"
                        title="Review all connections"
                        onClick={() => reviewMapConnections()}
                        disabled={jobLock || nodes.length === 0}
                    >
                        <GitMerge size={15} />
                        <span>Review</span>
                    </button>
                    <div className="map-header-divider" />
                    <button
                        className="map-header-btn"
                        title="Undo last map change"
                        onClick={undo}
                        disabled={undoStack.length === 0}
                    >
                        <Undo2 size={15} />
                    </button>
                    <button
                        className="map-header-btn"
                        title="Redo"
                        onClick={redo}
                        disabled={redoStack.length === 0}
                    >
                        <Redo2 size={15} />
                    </button>
                    <div className="map-header-divider" />
                    <button
                        className="map-header-btn"
                        title={isMaximized ? "Restore" : "Maximize"}
                        onClick={() => setIsMaximized(!isMaximized)}
                    >
                        {isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                    </button>
                    <button className="map-header-btn" title="Close map panel" onClick={onClose}>
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* ── Canvas ────────────────────────────────────────────────────── */}
            <div className="map-panel-body">
                {progress && (
                    <ProgressBar 
                        progress={progress.batchCurrent} 
                        total={progress.batchTotal} 
                        label={progress.label}
                        className="map-progress-container"
                    >
                        {jobLock && lockExpiresAt && (
                            <MapLockIndicator
                                expiresAt={lockExpiresAt}
                                onCancel={() => useMapStore.getState().releaseLock()}
                            />
                        )}
                    </ProgressBar>
                )}
                {!progress && jobLock && lockExpiresAt && (
                    <ProgressBar 
                        progress={0} 
                        total={1} 
                        label="Preparing..."
                        className="map-progress-container"
                    >
                        <MapLockIndicator
                            expiresAt={lockExpiresAt}
                            onCancel={() => useMapStore.getState().releaseLock()}
                        />
                    </ProgressBar>
                )}                <div className="map-canvas-container" ref={measureRef}>
                    {dimensions.width > 0 && dimensions.height > 0 && (
                        <InvestigationMapCanvas
                            onOpenDossierForNode={onOpenDossierForNode}
                            onOpenFileChunk={onOpenFileChunk}
                            coordinator={coordinator}
                            vectorStore={vectorStore}
                            queryEmbeddingResolver={queryEmbeddingResolver}
                        />
                    )}
                </div>
            </div>

            {/* ── Token Budget Warning ────────────────────────────────────── */}
            {reviewTokenWarning && (
                <TokenBudgetWarning
                    estimatedTokens={reviewTokenWarning.estimatedTokens}
                    onConfirmAll={reviewTokenWarning.onConfirmAll}
                    onConfirmTrimmed={reviewTokenWarning.onConfirmTrimmed}
                    onCancel={reviewTokenWarning.onCancel}
                />
            )}
        </div>
    );
};
