import { FC } from 'react';
import { ChatMessage } from '../../types';
import { MessageItem, MessageItemHandlers } from './MessageItem';

interface MessageListProps {
    chatHistory: ChatMessage[];
    appSettings: any;
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
}

export const MessageList: FC<MessageListProps> = ({
    chatHistory, appSettings, isLoading, isEmbedding, editingIndex, editingContent, setEditingContent,
    activeCommentInput, commentText, hoveredSelectionId, rootDirectoryHandle, caseFileState, handlers
}) => {
    return (
        <div className='chat-history'>
            {chatHistory.map((msg, i) => ({ msg, i })).filter(({ msg }) => {
                // Hide intermediate tool calls and tool results from the UI
                if (msg.role === 'tool') return false;
                if (msg.role === 'model' && msg.tool_calls && msg.tool_calls.length > 0) return false;
                if (msg.isInternal) return false;
                return true;
            }).map(({ msg, i }) => (
                <MessageItem
                    key={i}
                    msg={msg}
                    i={i}
                    isLast={i === chatHistory.length - 1}
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
                    chatHistory={chatHistory}
                    handlers={handlers}
                />
            ))}
            {isLoading && (
                <div className='chat-message model'>
                    {caseFileState.isAwaitingFeedback ? "Composing Case File... this may take a minute." : "Thinking..."}
                </div>
            )}
        </div>
    );
};
