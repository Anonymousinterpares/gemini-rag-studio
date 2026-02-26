import { FC } from 'react';
import { MessageItem } from './MessageItem';
import { useChatStore } from '../../store';
import { useShallow } from 'zustand/shallow';

export const MessageList: FC = () => {
    const { chatHistory, isLoading, caseFileState } = useChatStore(useShallow(s => ({
        chatHistory: s.chatHistory,
        isLoading: s.isLoading,
        caseFileState: s.caseFileState
    })));

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
