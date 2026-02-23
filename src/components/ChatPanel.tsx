import { FC } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ChatMessage, AppFile, TokenUsage } from '../types';
import { MessageList } from './Chat/MessageList';
import { ChatInputForm } from './Chat/ChatInputForm';
import { MessageItemHandlers } from './Chat/MessageItem';

interface ChatPanelProps {
    appSettings: any;
    setAppSettings: any;
    backgroundImages: string[];
    handleSourceClick: (e: any) => void;
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
    caseFileState: { isAwaitingFeedback: boolean; metadata?: any };
    handlers: MessageItemHandlers;

    // For chat input
    userInput: string;
    setUserInput: (input: string) => void;
    activeJobCount: number;
    files: AppFile[];
    handleSubmit: (e: React.FormEvent) => void;
    stopGeneration: () => void;
    setCaseFileState: (state: Partial<{ isAwaitingFeedback: boolean; metadata?: any; }>) => void;
    submitQuery: (query: string, history: ChatMessage[], isInternal?: boolean) => void;
    tokenUsage: TokenUsage;
    currentContextTokens: number;
    handleSaveChatHistory: () => Promise<void>;
    handleLoadChatHistory: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const ChatPanel: FC<ChatPanelProps> = ({
    appSettings, setAppSettings, backgroundImages, handleSourceClick, chatHistory, isLoading,
    isEmbedding, editingIndex, editingContent, setEditingContent, activeCommentInput, commentText,
    hoveredSelectionId, rootDirectoryHandle, caseFileState, handlers, userInput, setUserInput,
    activeJobCount, files, handleSubmit, stopGeneration, setCaseFileState, submitQuery,
    tokenUsage, currentContextTokens, handleSaveChatHistory, handleLoadChatHistory
}) => {
    return (
        <div className='panel chat-panel'>
            <div className='chat-panel-header'>
                <div className='background-changer'>
                    <button className='background-btn' onClick={() => setAppSettings((p: any) => ({ ...p, backgroundIndex: p.backgroundIndex === 0 ? backgroundImages.length : p.backgroundIndex - 1 }))}><ChevronLeft size={16} /></button>
                    <button className='background-btn' onClick={() => setAppSettings((p: any) => ({ ...p, backgroundIndex: (p.backgroundIndex + 1) % (backgroundImages.length + 1) }))}><ChevronRight size={16} /></button>
                </div>
            </div>
            <div className='panel-content' onClick={handleSourceClick} style={{ backgroundImage: backgroundImages[appSettings.backgroundIndex - 1] ? `url('${backgroundImages[appSettings.backgroundIndex - 1]}')` : 'none', backgroundSize: 'cover' }}>
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
                handleSaveChatHistory={handleSaveChatHistory}
                handleLoadChatHistory={handleLoadChatHistory}
            />
        </div>
    );
};
