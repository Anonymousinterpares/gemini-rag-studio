import { FC, useState, useRef, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, FileText, FolderOpen, FolderTree, Network } from 'lucide-react';
import { ChatMessage, AppFile, TokenUsage } from '../types';
import { MessageList } from './Chat/MessageList';
import { ChatInputForm } from './Chat/ChatInputForm';
import { MessageItemHandlers } from './Chat/MessageItem';
import { ChatHistoryDropdown } from './Chat/ChatHistoryDropdown';

interface ChatPanelProps {
    appSettings: import('../config').AppSettings;
    setAppSettings: (updater: (prev: import('../config').AppSettings) => import('../config').AppSettings) => void;
    backgroundImages: string[];
    handleSourceClick: (e: React.MouseEvent<HTMLDivElement>) => void;
    chatHistory: ChatMessage[];
    isLoading: boolean;
    isEmbedding: boolean;
    editingIndex: number | null;
    editingContent: string;
    setEditingContent: (c: string) => void;
    activeCommentInput: { msgIndex: number, sectionId: string } | null;
    commentText: string;
    hoveredSelectionId: string | null;
    rootDirectoryHandle: FileSystemDirectoryHandle | null;
    caseFileState: { isAwaitingFeedback: boolean; metadata?: import('../store/useChatStore').CaseFileMetadata };
    handlers: MessageItemHandlers;

    // For chat input
    userInput: string;
    setUserInput: (input: string) => void;
    activeJobCount: number;
    files: AppFile[];
    handleSubmit: (e: React.FormEvent) => void;
    stopGeneration: () => void;
    setCaseFileState: (state: Partial<{ isAwaitingFeedback: boolean; metadata?: import('../store/useChatStore').CaseFileMetadata; }>) => void;
    submitQuery: (query: string, history: ChatMessage[], isInternal?: boolean) => void;
    tokenUsage: TokenUsage;
    currentContextTokens: number;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onLoadCaseFile: () => void;
    onOpenCaseFile: () => void;
    hasCaseFile: boolean;
    isDossierOpen: boolean;
    setIsDossierOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isMapPanelOpen: boolean;
    setIsMapPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export const ChatPanel: FC<ChatPanelProps> = ({
    appSettings, setAppSettings, backgroundImages, handleSourceClick, chatHistory, isLoading,
    isEmbedding, editingIndex, editingContent, setEditingContent, activeCommentInput, commentText,
    hoveredSelectionId, rootDirectoryHandle, caseFileState, handlers, userInput, setUserInput,
    activeJobCount, files, handleSubmit, stopGeneration, setCaseFileState, submitQuery,
    tokenUsage, currentContextTokens,
    undo, redo, canUndo, canRedo,
    onLoadCaseFile, onOpenCaseFile, hasCaseFile,
    isDossierOpen, setIsDossierOpen,
    isMapPanelOpen, setIsMapPanelOpen,
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [showScrollDown, setShowScrollDown] = useState(false);

    const handleScroll = useCallback(() => {
        if (scrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            const needsScroll = scrollHeight - scrollTop - clientHeight > 100;
            if (needsScroll !== showScrollDown) {
                console.log(`[ChatPanel] Scroll-to-bottom button visibility changing: ${needsScroll}`, {
                    scrollTop, scrollHeight, clientHeight, diff: scrollHeight - scrollTop - clientHeight
                });
                setShowScrollDown(needsScroll);
            }
        }
    }, [showScrollDown]);

    // Log mounting for debug
    useEffect(() => {
        console.log('[ChatPanel] Mounted, initial scroll check');
        handleScroll();
    }, [handleScroll]);

    // Also check on chatHistory changes in case scrollHeight grows
    useEffect(() => {
        handleScroll();
    }, [chatHistory, handleScroll]);

    const prefetchCaseFile = () => import('./CaseFile/CaseFilePanel');
    const prefetchDossier = () => import('./Dossier/DossierPanel');
    const prefetchMap = () => import('./InvestigationMap/InvestigationMapPanel');

    return (
        <div className='panel chat-panel'>
            <div className='chat-panel-header' style={{ justifyContent: 'space-between', display: 'flex' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        className='button secondary'
                        title='Load a case file (.json or .md) from your computer'
                        onClick={onLoadCaseFile}
                        onMouseEnter={prefetchCaseFile}
                        style={{ padding: '0.4rem', display: 'flex', alignItems: 'center' }}
                    >
                        <FileText size={16} />
                    </button>
                    <button
                        className='button secondary'
                        title='Open the loaded case file in the overlay panel'
                        onClick={onOpenCaseFile}
                        onMouseEnter={prefetchCaseFile}
                        disabled={!hasCaseFile}
                        style={{ padding: '0.4rem', display: 'flex', alignItems: 'center' }}
                    >
                        <FolderOpen size={16} />
                    </button>
                    <button
                        className={`button secondary ${isDossierOpen ? 'active' : ''}`}
                        title='Open the Knowledge Base to manage Dossiers and Topics'
                        onClick={() => setIsDossierOpen(!isDossierOpen)}
                        onMouseEnter={prefetchDossier}
                        style={{ padding: '0.4rem', display: 'flex', alignItems: 'center', backgroundColor: isDossierOpen ? 'rgba(52, 152, 219, 0.2)' : undefined, borderColor: isDossierOpen ? '#3498db' : undefined }}
                    >
                        <FolderTree size={16} />
                    </button>
                    <button
                        className={`button secondary ${isMapPanelOpen ? 'active' : ''}`}
                        title='Toggle Investigation Map panel'
                        onClick={() => setIsMapPanelOpen(!isMapPanelOpen)}
                        onMouseEnter={prefetchMap}
                        style={{ padding: '0.4rem', display: 'flex', alignItems: 'center', backgroundColor: isMapPanelOpen ? 'rgba(52, 152, 219, 0.2)' : undefined, borderColor: isMapPanelOpen ? '#3498db' : undefined }}
                    >
                        <Network size={16} />
                    </button>
                </div>
                <div style={{ display: 'flex', gap: '8px', flex: 1, justifyContent: 'center' }}>
                    <ChatHistoryDropdown />
                </div>
                <div className='background-changer'>
                    <button className='background-btn' onClick={() => setAppSettings((p: import('../config').AppSettings) => ({ ...p, backgroundIndex: p.backgroundIndex === 0 ? backgroundImages.length : p.backgroundIndex - 1 }))}><ChevronLeft size={16} /></button>
                    <button className='background-btn' onClick={() => setAppSettings((p: import('../config').AppSettings) => ({ ...p, backgroundIndex: (p.backgroundIndex + 1) % (backgroundImages.length + 1) }))}><ChevronRight size={16} /></button>
                </div>
            </div>
            <div className='panel-content' ref={scrollRef} onScroll={handleScroll} onClick={handleSourceClick} style={{ backgroundImage: backgroundImages[appSettings.backgroundIndex - 1] ? `url('${backgroundImages[appSettings.backgroundIndex - 1]}')` : 'none', backgroundSize: 'cover' }}>
                <MessageList
                    chatHistory={chatHistory}
                    appSettings={appSettings}
                    isLoading={isLoading}
                    isEmbedding={isEmbedding}
                    editingIndex={editingIndex}
                    editingContent={editingContent}
                    setEditingContent={setEditingContent}
                    activeCommentInput={activeCommentInput}
                    commentText={commentText}
                    hoveredSelectionId={hoveredSelectionId}
                    rootDirectoryHandle={rootDirectoryHandle}
                    caseFileState={caseFileState}
                    handlers={handlers}
                />
            </div>

            <div style={{ position: 'relative', flexShrink: 0 }}>
                {showScrollDown && (
                    <button
                        className="scroll-to-bottom-btn"
                        onClick={() => {
                            if (scrollRef.current) {
                                scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
                            }
                        }}
                        title="Scroll to bottom"
                    >
                        <svg
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="white"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ display: 'block' }}
                        >
                            <path d="M7 10l5 5 5-5" />
                        </svg>
                    </button>
                )}
                <ChatInputForm
                    appSettings={appSettings}
                    setAppSettings={setAppSettings}
                    userInput={userInput}
                    setUserInput={setUserInput}
                    isLoading={isLoading}
                    activeJobCount={activeJobCount}
                    files={files}
                    chatHistory={chatHistory}
                    handleSubmit={handleSubmit}
                    stopGeneration={stopGeneration}
                    caseFileState={caseFileState}
                    setCaseFileState={setCaseFileState}
                    submitQuery={submitQuery}
                    tokenUsage={tokenUsage}
                    currentContextTokens={currentContextTokens}
                    undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo}
                />
            </div>
        </div>
    );
};
