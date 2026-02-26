import { FC, useRef, useEffect } from 'react';
import { Info, Send, Square, RefreshCw, RotateCcw, RotateCw } from 'lucide-react';
import { useChatStore, useSettingsStore, useComputeStore, useFileStore } from '../../store';
import { useAppOrchestrator } from '../../hooks/useAppOrchestrator';
import { useShallow } from 'zustand/shallow';

export const ChatInputForm: FC = () => {
    const chatInputRef = useRef<HTMLTextAreaElement>(null);
    const orchestrator = useAppOrchestrator();

    const { 
        userInput, setUserInput, isLoading, chatHistory, caseFileState, 
        tokenUsage, currentContextTokens 
    } = useChatStore(useShallow(s => ({
        userInput: s.userInput,
        setUserInput: s.setUserInput,
        isLoading: s.isLoading,
        chatHistory: s.chatHistory,
        caseFileState: s.caseFileState,
        tokenUsage: s.tokenUsage,
        currentContextTokens: s.currentContextTokens
    })));

    const { appSettings, setAppSettings } = useSettingsStore(useShallow(s => ({
        appSettings: s.appSettings,
        setAppSettings: s.setAppSettings
    })));

    const activeJobCount = useComputeStore(s => s.activeJobCount);
    const files = useFileStore(s => s.files);

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
            <form className='chat-input-form' onSubmit={orchestrator.handleSubmit}>
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
                                orchestrator.handleSubmit(e as unknown as React.FormEvent);
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
                    <button type='button' className='button stop-button' onClick={orchestrator.stopGeneration}><Square size={16} /></button>
                ) : (
                    <>
                        <button type='button' className='button secondary' onClick={orchestrator.handleUndo} disabled={!orchestrator.canUndo || isLoading} title="Undo last action (Ctrl+Z)"><RotateCcw size={16} /></button>
                        <button type='button' className='button secondary' onClick={orchestrator.handleRedo} disabled={!orchestrator.canRedo || isLoading} title="Redo last undone action (Ctrl+Y)"><RotateCw size={16} /></button>
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
                        onClick={() => orchestrator.setCaseFileState({ isAwaitingFeedback: false, metadata: undefined })}
                        className="button secondary"
                        disabled={isLoading}
                        style={{ marginLeft: '10px', backgroundColor: isLoading ? '#440000' : '#8b0000', opacity: isLoading ? 0.6 : 1 }}
                    >
                        {isLoading ? "Generating Report..." : "Cancel Case File"}
                    </button>
                ) : (
                    <button
                        onClick={() => {
                            orchestrator.submitQuery("Generate a comprehensive Case File based on our conversation.", chatHistory, true);
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
