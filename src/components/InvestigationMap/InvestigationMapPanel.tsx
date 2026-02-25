import { FC, useState } from 'react';
import { Undo2, Redo2, Network, X, GitMerge, Loader, Maximize2, Minimize2, Trash2 } from 'lucide-react';
import { useMapStore } from '../../store/useMapStore';
import { useMapAI } from '../../hooks/useMapAI';
import { InvestigationMapCanvas } from './InvestigationMapCanvas';
import './InvestigationMapPanel.css';

interface Props {
    onClose: () => void;
    onOpenDossierForNode?: (nodeId: string) => void;
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

export const InvestigationMapPanel: FC<Props> = ({ onClose, onOpenDossierForNode }) => {
    const { nodes, edges, undo, redo, undoStack, redoStack, progress, jobLock, clearMap } = useMapStore();
    const { reviewMapConnections, reviewTokenWarning } = useMapAI();
    const [isMaximized, setIsMaximized] = useState(false);

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
                    <button
                        className="map-clear-btn"
                        title="Clear entire map"
                        onClick={handleClearMap}
                        disabled={nodes.length === 0 || jobLock}
                    >
                        <Trash2 size={14} />
                    </button>
                </div>

                {progress && (
                    <div className="map-progress-container">
                        <Loader size={13} className="animate-spin" style={{ marginRight: 6 }} />
                        <span className="map-progress-label">{progress.label}</span>
                        {progress.batchTotal > 1 && (
                            <span className="map-progress-count">
                                {progress.batchCurrent}/{progress.batchTotal}
                            </span>
                        )}
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
                <div className="map-canvas-container">
                    <InvestigationMapCanvas onOpenDossierForNode={onOpenDossierForNode} />
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
