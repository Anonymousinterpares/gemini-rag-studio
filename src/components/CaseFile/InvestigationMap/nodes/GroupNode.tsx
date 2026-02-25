import { FC, memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { MapNode } from '../../../../types';

import { FolderOpen, FolderClosed } from 'lucide-react';

export const GroupNode: FC<NodeProps<MapNode>> = memo(({ data, selected }) => {
    // Semantic zoom thresholds
    const zoom = (data as any).semanticZoom ?? 1;
    const isMacroView = zoom <= 0.6;

    return (
        <div
            className={`cf-map-group-node ${selected ? 'selected' : ''}`}
            style={{
                padding: isMacroView ? '6px' : '12px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: `3px dashed ${selected ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                minWidth: '200px',
                minHeight: '150px',
                color: 'var(--text-primary)',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: isMacroView ? '0' : '8px', opacity: 0.8 }}>
                {data.isCollapsed ? <FolderClosed size={16} /> : <FolderOpen size={16} />}
                <strong style={{ fontSize: '13px' }}>{data.label}</strong>
            </div>

            {/* We still need handles on groups so we can connect to them when collapsed */}
            <Handle type="target" position={Position.Top} />
            <Handle type="source" position={Position.Bottom} />
        </div>
    );
});

GroupNode.displayName = 'GroupNode';
