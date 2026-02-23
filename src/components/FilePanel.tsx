import { FC, useRef } from 'react';
import { Trash2, X, RefreshCw, LayoutGrid, List as ListIcon, FolderTree, RotateCcw } from 'lucide-react';
import { SpeechBubble, DigestParticles, FloatingArrows, RejectionBubble } from './Monster';
import Settings from './Settings';
import MemoizedFileTreeView from './FileTreeView';
import MemoizedFileListView from './FileListView';
import { AppFile, ViewMode } from '../types';

interface FilePanelProps {
    showSettings: boolean;
    setShowSettings: React.Dispatch<React.SetStateAction<boolean>>;
    glowType: string;
    isDragging: boolean;
    handleDropValidate: (e: React.DragEvent) => void;
    files: AppFile[];
    activeJobCount: number;
    isLoading: boolean;
    isEmbedding: boolean;
    showRejectionBubble: boolean;
    showDropVideo: boolean;
    dropVideoSrc: string;
    setShowDropVideo: React.Dispatch<React.SetStateAction<boolean>>;
    handleClearFiles: (initialHistory: any) => void;
    initialChatHistory: any;
    handleClearConversation: () => void;
    chatHistory: any[];
    undo: () => void;
    historyStack: any[];
    handleClear: () => void;
    computeDevice: string;
    mlWorkerCount: number;
    viewMode: ViewMode;
    setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
    fileTree: any;
    handleShowSum: (f: AppFile) => void;
    onOpenExplorer: () => void;
}

export const FilePanel: FC<FilePanelProps> = ({
    showSettings, setShowSettings, glowType, isDragging, handleDropValidate, files,
    activeJobCount, isLoading, isEmbedding, showRejectionBubble, showDropVideo,
    dropVideoSrc, setShowDropVideo, handleClearFiles, initialChatHistory,
    handleClearConversation, chatHistory, undo, historyStack, handleClear,
    computeDevice, mlWorkerCount, viewMode, setViewMode, fileTree, handleShowSum,
    onOpenExplorer
}) => {
    const dropVideoRef = useRef<HTMLVideoElement>(null);

    return (
        <div className={`panel file-panel ${!showSettings ? 'settings-hidden' : ''}`}>
            <div className='file-panel-header'>
                <button className='button secondary' onClick={onOpenExplorer}>Open Explorer</button>
                <button className='button secondary' onClick={() => setShowSettings(p => !p)}>Settings</button>
            </div>
            <Settings className={showSettings ? '' : 'hidden'} />
            <div className={`drag-drop-area glow-${glowType} ${isDragging ? 'dragging' : ''}`} onDrop={handleDropValidate} onDragOver={(e) => e.preventDefault()} onDragLeave={() => { }}>
                <SpeechBubble filesCount={files.length} isProcessing={activeJobCount > 0 || isLoading} isEmbedding={isEmbedding} />
                <RejectionBubble show={showRejectionBubble} />
                <FloatingArrows show={files.length === 0 && activeJobCount === 0 && !isLoading} />
                <DigestParticles isActive={isEmbedding || activeJobCount > 0} />
                {isLoading || activeJobCount > 0 ? (
                    <video src='/assets/thinking.mp4' autoPlay loop muted className="drop-media-element" />
                ) : (showDropVideo ? (
                    <video ref={dropVideoRef} src={dropVideoSrc} onEnded={() => setShowDropVideo(false)} autoPlay muted className="drop-media-element" />
                ) : (
                    <img src="/assets/drop.png" className="drop-media-element" />
                ))}
            </div>
            <div className='flex gap-2'>
                <button className='button secondary' onClick={() => handleClearFiles(initialChatHistory)} disabled={files.length === 0 || isEmbedding} title="Clear Files"><Trash2 size={16} /></button>
                <button className='button secondary' onClick={handleClearConversation} disabled={chatHistory.length <= 1 || isLoading || isEmbedding} title="Clear Chat"><X size={16} /></button>
                <button className='button secondary' onClick={undo} disabled={historyStack.length === 0 || isLoading || isEmbedding} title="Undo last action"><RotateCcw size={16} /></button>
                <button className='button secondary' onClick={handleClear} title="Reset App"><RefreshCw size={16} /></button>
            </div>
            <div className='compute-status-indicator'>Compute: {computeDevice.toUpperCase()} ({mlWorkerCount} ML)</div>
            <div className='view-switcher'>
                <button className={viewMode === 'tree' ? 'active' : ''} onClick={() => setViewMode('tree')}><LayoutGrid size={16} /></button>
                <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}><ListIcon size={16} /></button>
            </div>
            <div className='panel-content file-list-container'>
                {files.length > 0 ? (viewMode === 'tree' ? <MemoizedFileTreeView tree={fileTree} onShowSummary={handleShowSum} /> : <MemoizedFileListView onShowSummary={handleShowSum} />) : <div className='placeholder-text'><FolderTree size={48} /></div>}
            </div>
        </div>
    );
};
