import { FC, useRef, useEffect } from 'react';
import { Info, Send, Square, RefreshCw, RotateCcw, RotateCw } from 'lucide-react';
import { AppFile, ChatMessage, TokenUsage } from '../../types';

interface ChatInputFormProps {
    appSettings: import('../../config').AppSettings;
    setAppSettings: (updater: (prev: import('../../config').AppSettings) => import('../../config').AppSettings) => void;
    userInput: string;
    setUserInput: (input: string) => void;
    isLoading: boolean;
    activeJobCount: number;
    files: AppFile[];
    chatHistory: ChatMessage[];
    handleSubmit: (e: React.FormEvent) => void;
    stopGeneration: () => void;
    caseFileState: { isAwaitingFeedback: boolean; metadata?: import('../../store/useChatStore').CaseFileMetadata };
    setCaseFileState: (state: Partial<{ isAwaitingFeedback: boolean; metadata?: import('../../store/useChatStore').CaseFileMetadata; }>) => void;
    submitQuery: (query: string, history: ChatMessage[], isInternal?: boolean) => void;
    tokenUsage: TokenUsage;
    currentContextTokens: number;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
}

export const ChatInputForm: FC<ChatInputFormProps> = ({
    appSettings, setAppSettings, userInput, setUserInput, isLoading, activeJobCount, files, chatHistory,
    handleSubmit, stopGeneration, caseFileState, setCaseFileState, submitQuery, tokenUsage, currentContextTokens,
    undo, redo, canUndo, canRedo
}) => {
    const chatInputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (chatInputRef.current) {
            chatInputRef.current.style.height = 'auto';
            chatInputRef.current.style.height = `${chatInputRef.current.scrollHeight}px`;
        }
    }, [userInput]);

    return (
        <div className='chat-input-area'>
            {appSettings.isChatModeEnabled && (
                <div className="chat-mode-indicator">
                    <Info size={16} />
                    <span>
                        <b>Chat Mode Active:</b> You can chat freely. Upload documents if you want the agent to analyze specific files.
                    </span>
                </div>
            )}
            <form className='chat-input-form' onSubmit={handleSubmit}>
                <textarea
                    ref={chatInputRef}
                    className='chat-input'
                    value={userInput}
                    rows={1}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (userInput.trim() && !isLoading && activeJobCount === 0) {
                                handleSubmit(e as unknown as React.FormEvent);
                            }
                        }
                    }}
                    disabled={isLoading || (files.length === 0 && !appSettings.isChatModeEnabled) || activeJobCount > 0}
                    placeholder={
                        activeJobCount > 0
                            ? "Processing documents... please wait"
                            : (isLoading && caseFileState.isAwaitingFeedback ? "Building report..." : "")
                    }
                />
                {isLoading ? (
                    <button type='button' className='button stop-button' onClick={stopGeneration}><Square size={16} /></button>
                ) : (
                    <>
                        <button type='button' className='button secondary' onClick={undo} disabled={!canUndo || isLoading} title="Undo last action (Ctrl+Z)"><RotateCcw size={16} /></button>
                        <button type='button' className='button secondary' onClick={redo} disabled={!canRedo || isLoading} title="Redo last undone action (Ctrl+Y)"><RotateCw size={16} /></button>
                        <button type='submit' className='button' disabled={!userInput.trim() || activeJobCount > 0}><Send size={16} /></button>
                    </>
                )}
            </form>
            {activeJobCount > 0 && (
                <div className="processing-indicator">
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Indexing in progress... Knowledge base may be incomplete.</span>
                </div>
            )}
            <div className="token-usage-display">
                Tokens: {tokenUsage.promptTokens + tokenUsage.completionTokens}
                <span className="token-usage-split">
                    (In: {tokenUsage.promptTokens}, Out: {tokenUsage.completionTokens})
                </span>
            </div>
            <div className="token-usage-display" style={{ borderTop: 'none', paddingTop: 0 }}>
                Current Context: {currentContextTokens}
            </div>
            <div className='setting-row'>
                <button onClick={() => setAppSettings((p: import('../../config').AppSettings) => ({ ...p, isDeepAnalysisEnabled: !p.isDeepAnalysisEnabled }))} className={`toggle-button ${appSettings.isDeepAnalysisEnabled ? 'active' : ''}`}>Deep Analysis: {appSettings.isDeepAnalysisEnabled ? 'ON' : 'OFF'}</button>
                {caseFileState.isAwaitingFeedback ? (
                    <button
                        onClick={() => setCaseFileState({ isAwaitingFeedback: false, metadata: undefined })}
                        className="button secondary"
                        disabled={isLoading}
                        style={{ marginLeft: '10px', backgroundColor: isLoading ? '#440000' : '#8b0000', opacity: isLoading ? 0.6 : 1 }}
                    >
                        {isLoading ? "Generating Report..." : "Cancel Case File"}
                    </button>
                ) : (
                    <button
                        onClick={() => {
                            submitQuery("Generate a comprehensive Case File based on our conversation.", chatHistory, true);
                        }}
                        className="button secondary"
                        disabled={isLoading || (files.length === 0 && !appSettings.isChatModeEnabled)}
                        style={{ marginLeft: '10px' }}
                        title="Compose an extensive report based on the visible chat context"
                    >
                        Build Case File
                    </button>
                )}
            </div>
        </div>
    );
};
