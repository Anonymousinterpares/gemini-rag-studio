import { ChatMessage, TokenUsage } from '../types';

export const useChatHistoryIO = (chatHistory: ChatMessage[], tokenUsage: TokenUsage, setChatHistory: (history: ChatMessage[]) => void, setTokenUsage: (usage: TokenUsage) => void) => {
    const handleSaveChatHistory = async () => {
        const data = JSON.stringify({ chatHistory, tokenUsage }, null, 2);
        if ('showSaveFilePicker' in window) {
            try {
                const handle = await (window as unknown as { showSaveFilePicker: (options: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
                    suggestedName: `chat-session-${new Date().toISOString().split('T')[0]}.json`,
                    types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(data);
                await writable.close();
            } catch (e) {
                console.error(e);
            }
        } else {
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `chat-session.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    const handleLoadChatHistory = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (prev) => {
            try {
                const loaded = JSON.parse(prev.target?.result as string);
                if (loaded.chatHistory) {
                    setChatHistory(loaded.chatHistory);
                    if (loaded.tokenUsage) setTokenUsage(loaded.tokenUsage);
                }
            } catch {
                alert("Failed to load chat history: Invalid JSON");
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    return {
        handleSaveChatHistory,
        handleLoadChatHistory
    };
};
