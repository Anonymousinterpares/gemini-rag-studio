import { FC, memo, useState, MouseEvent } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { MapNode, EntityType } from '../../../../types';
import { useMapAI } from '../../../../hooks/useMapAI';
import { useMapStore } from '../../../../store/useMapStore';
import { BeaconOverlay } from '../../../InvestigationMap/BeaconOverlay';

import {
    User,
    MapPin,
    Calendar,
    Building2,
    FileText,
    HelpCircle,
} from 'lucide-react';

const getIconForEntity = (type: EntityType) => {
    switch (type) {
        case 'person': return <User size={16} />;
        case 'location': return <MapPin size={16} />;
        case 'event': return <Calendar size={16} />;
        case 'organization': return <Building2 size={16} />;
        case 'evidence': return <FileText size={16} />;
        default: return <HelpCircle size={16} />;
    }
};

const getColorForEntity = (type: EntityType) => {
    switch (type) {
        case 'person': return 'var(--accent-blue, #3b82f6)';
        case 'location': return 'var(--accent-green, #10b981)';
        case 'event': return 'var(--accent-orange, #f59e0b)';
        case 'organization': return 'var(--accent-purple, #8b5cf6)';
        case 'evidence': return 'var(--accent-red, #ef4444)';
        default: return 'var(--text-secondary, #6b7280)';
    }
};

export const EntityNode: FC<NodeProps<MapNode>> = memo(({ id, data, selected }) => {
    const color = getColorForEntity(data.entityType);
    const [menuOpen, setMenuOpen] = useState(false);
    const [instruction, setInstruction] = useState('');
    const { handleMapInstruction, isMapProcessing } = useMapAI();
    const lastChanges = useMapStore(s => s.lastChanges);

    const onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        setMenuOpen(true);
    };

    const isAdded = lastChanges?.added.includes(id);
    const isUpdated = lastChanges?.updated.includes(id);
    const isDisproven = data.certainty === 'disproven';

    let stateClass = '';
    if (isAdded) stateClass = 'node-state--added';
    else if (isUpdated) stateClass = 'node-state--updated';
    else if (isDisproven) stateClass = 'node-state--disproven';

    // Semantic zoom thresholds
    const zoom = data.semanticZoom ?? 1;
    const isMacroView = zoom <= 0.6;
    const isMicroView = zoom >= 1.0;
    const hideExtra = data.hideDescription;

    return (
        <div
            className={`cf-map-node ${stateClass} ${selected ? 'selected' : ''}`}
            onContextMenu={onContextMenu}
            style={{
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'var(--bg-panel)',
                border: `3px solid ${selected ? color : 'var(--border-color)'}`,
                boxShadow: selected ? `0 0 0 3px ${color}40` : '0 2px 4px rgba(0,0,0,0.1)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                minWidth: '120px',
                color: 'var(--text-primary)',
                fontSize: '12px',
                position: 'relative',
                opacity: isDisproven ? 0.5 : 1,
            }}
        >
            {/* Target handle connecting to the left/top */}
            <Handle type="target" position={Position.Top} style={{ background: color }} />

            <BeaconOverlay 
                showTimestampBeacon={!!data.timestamp && !data.isTimestampVerified} 
                showCertaintyBeacon={data.certaintyScore !== undefined && !data.isCertaintyVerified} 
            />

            {!isMacroView && isAdded && <div className="node-badge node-badge--new">NEW</div>}
            {!isMacroView && isUpdated && !isAdded && <div className="node-badge node-badge--updated">UPDATED</div>}
            {!isMacroView && isDisproven && <div className="node-badge node-badge--disproven">REMOVED</div>}

            <div style={{ color, display: 'flex' }}>
                {getIconForEntity(data.entityType)}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
                <strong style={{ fontSize: '13px', fontWeight: 600, textDecoration: isDisproven ? 'line-through' : 'none' }}>{data.label}</strong>
                {!isMacroView && data.description && !hideExtra && (
                    <span style={{
                        fontSize: '10px',
                        color: 'var(--text-secondary)',
                        marginTop: '2px',
                        maxWidth: isMicroView ? '240px' : '150px',
                        display: '-webkit-box',
                        WebkitLineClamp: isMicroView ? 5 : 1,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'normal',
                        lineHeight: 1.3
                    }}>
                        {data.description}
                    </span>
                )}
            </div>

            {/* Source handle connecting to the right/bottom */}
            <Handle type="source" position={Position.Bottom} style={{ background: color }} />

            {/* Context Menu for LLM Interaction */}
            {menuOpen && (
                <div
                    style={{
                        position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                        marginTop: '10px', zIndex: 100, background: 'var(--panel-bg-color)',
                        padding: '10px', border: '1px solid var(--border-color)',
                        borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                        width: '240px', cursor: 'default'
                    }}
                    onMouseDown={(e) => e.stopPropagation()} // Prevent dragging node when interacting with menu
                    onClick={(e) => e.stopPropagation()}
                >
                    <div style={{ fontSize: '11px', color: 'var(--text-color-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                        Analyze Connections (AI)
                    </div>
                    <textarea
                        value={instruction}
                        onChange={e => setInstruction(e.target.value)}
                        placeholder="E.g., Find everyone this person interacted with in the emails..."
                        style={{
                            width: '100%', minHeight: '60px', background: 'var(--input-bg-color)',
                            color: 'var(--text-color)', border: '1px solid var(--border-color)',
                            borderRadius: '6px', padding: '6px', fontSize: '12px', resize: 'vertical',
                            outline: 'none', boxSizing: 'border-box'
                        }}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (!isMapProcessing && instruction.trim()) {
                                    handleMapInstruction(instruction, id);
                                    setMenuOpen(false);
                                    setInstruction('');
                                }
                            }
                            if (e.key === 'Escape') setMenuOpen(false);
                        }}
                    />
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                        <button
                            className="button"
                            style={{ flex: 1, padding: '5px', fontSize: '12px' }}
                            disabled={isMapProcessing || !instruction.trim()}
                            onClick={() => {
                                handleMapInstruction(instruction, id);
                                setMenuOpen(false);
                                setInstruction('');
                            }}
                        >
                            {isMapProcessing ? 'Thinking...' : 'Prompt AI'}
                        </button>
                        <button
                            className="button secondary"
                            style={{ padding: '5px', fontSize: '12px' }}
                            onClick={() => setMenuOpen(false)}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
});

EntityNode.displayName = 'EntityNode';
