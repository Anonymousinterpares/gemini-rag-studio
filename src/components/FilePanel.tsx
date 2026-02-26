import { FC, useRef } from 'react';
import { Trash2, X, RefreshCw, LayoutGrid, List as ListIcon, FolderTree, Pin, PinOff, ArrowLeft } from 'lucide-react';
import { SpeechBubble, DigestParticles, FloatingArrows, RejectionBubble } from './Monster';
import Settings from './Settings';
import MemoizedFileTreeView from './FileTreeView';
import MemoizedFileListView from './FileListView';
import { useUIStore } from '../store/useUIStore';
import { useFileStore, useComputeStore, useChatStore } from '../store';
import { useAppOrchestrator } from '../hooks/useAppOrchestrator';
import { useShallow } from 'zustand/shallow';

export const FilePanel: FC = () => {
    const dropVideoRef = useRef<HTMLVideoElement>(null);
    
    // Orchestrator for complex logic
    const orchestrator = useAppOrchestrator();
    
    // UI Store
    const ui = useUIStore(useShallow(s => ({
        showSettings: s.showSettings,
        setShowSettings: s.setShowSettings,
        viewMode: s.viewMode,
        setViewMode: s.setViewMode,
        isPinned: s.isPinned,
        setIsPinned: s.setIsPinned
    })));

    // File Store
    const { files, fileTree } = useFileStore(useShallow(s => ({
        files: s.files,
        fileTree: s.fileTree
    })));

    // Compute Store
    const { activeJobCount, isEmbedding, computeDevice, mlWorkerCount } = useComputeStore(useShallow(s => ({
        activeJobCount: s.activeJobCount,
        isEmbedding: s.isEmbedding,
        computeDevice: s.computeDevice,
        mlWorkerCount: s.mlWorkerCount
    })));

    // Chat Store
    const chatHistory = useChatStore(s => s.chatHistory);

    return (
        <div className={`panel file-panel ${!ui.showSettings ? 'settings-hidden' : ''} ${!ui.isPinned ? 'auto-hide' : ''}`}>
            <div className='file-panel-header'>
                <button
                    className='button secondary'
                    onClick={() => orchestrator.setActiveProject(null)}
                    title="Back to Projects"
                    style={{ padding: '0.4rem', marginRight: '4px' }}
                >
                    <ArrowLeft size={16} />
                </button>
                <button
                    className='button secondary'
                    onClick={() => ui.setIsPinned(!ui.isPinned)}
                    title={ui.isPinned ? "Unpin side panel (auto-hide)" : "Pin side panel (keep visible)"}
                    style={{ padding: '0.4rem' }}
                >
                    {ui.isPinned ? <PinOff size={16} /> : <Pin size={16} />}
                </button>
                <div style={{ flex: 1 }}></div>
                <button className='button secondary' onClick={orchestrator.onOpenExplorer}>Open Explorer</button>
                <button className='button secondary' onClick={() => ui.setShowSettings(p => !p)}>Settings</button>
            </div>
            <Settings className={ui.showSettings ? '' : 'hidden'} />
            <div className={`drag-drop-area glow-${orchestrator.glowType} ${orchestrator.isDragging ? 'dragging' : ''}`} onDrop={orchestrator.handleDropValidate} onDragOver={(e) => e.preventDefault()} onDragLeave={() => { }}>
                <SpeechBubble filesCount={files.length} isProcessing={activeJobCount > 0 || orchestrator.isLoading} isEmbedding={isEmbedding} />
                <RejectionBubble show={orchestrator.showRejectionBubble} />
                <FloatingArrows show={files.length === 0 && activeJobCount === 0 && !orchestrator.isLoading} />
                <DigestParticles isActive={isEmbedding || activeJobCount > 0} />
                {orchestrator.isLoading || activeJobCount > 0 ? (
                    <video src='/assets/thinking.mp4' autoPlay loop muted className="drop-media-element" />
                ) : (orchestrator.showDropVideo ? (
                    <video ref={dropVideoRef} src={orchestrator.dropVideoSrc} onEnded={() => orchestrator.setShowDropVideo(false)} autoPlay muted className="drop-media-element" />
                ) : (
                    <img src="/assets/drop.png" className="drop-media-element" />
                ))}
            </div>
            <div className='flex gap-2'>
                <button className='button secondary' onClick={() => orchestrator.handleClearFiles([])} disabled={files.length === 0 || isEmbedding} title="Clear Files"><Trash2 size={16} /></button>
                <button className='button secondary' onClick={orchestrator.handleClearConversation} disabled={chatHistory.length <= 1 || orchestrator.isLoading || isEmbedding} title="Clear Chat"><X size={16} /></button>
                <button className='button secondary' onClick={orchestrator.handleClear} title="Reset App"><RefreshCw size={16} /></button>
            </div>
            <div className='compute-status-indicator'>Compute: {computeDevice.toUpperCase()} ({mlWorkerCount} ML)</div>
            <div className='view-switcher'>
                <button className={ui.viewMode === 'tree' ? 'active' : ''} onClick={() => ui.setViewMode('tree')}><LayoutGrid size={16} /></button>
                <button className={ui.viewMode === 'list' ? 'active' : ''} onClick={() => ui.setViewMode('list')}><ListIcon size={16} /></button>
            </div>
            <div className='panel-content file-list-container'>
                {files.length > 0 ? (ui.viewMode === 'tree' ? <MemoizedFileTreeView tree={fileTree} onShowSummary={orchestrator.handleShowSum} /> : <MemoizedFileListView onShowSummary={orchestrator.handleShowSum} />) : <div className='placeholder-text'><FolderTree size={48} /></div>}
            </div>
        </div>
    );
};
