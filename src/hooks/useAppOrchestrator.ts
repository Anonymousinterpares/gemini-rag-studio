import { useState, useEffect, useCallback } from 'react';
import { useFileStore, useComputeStore, useSettingsStore, useProjectStore, useMapStore, useCaseFileStore, useChatStore } from '../store';
import { useUIStore } from '../store/useUIStore';
import { useFileState, useCompute, useChat, useAppUI, useDossierAI, useMapAI, useMigration, useChatComments, useChatEdits, useChatHistoryIO, useCaseFileIO } from '../hooks';
import { getStoredDirectoryHandle, storeDirectoryHandle, clearStoredDirectoryHandle } from '../utils/db';
import { downloadMessage } from '../utils/appActions';
import { AppFile } from '../types';
import { embeddingCache } from '../cache/embeddingCache';
import { summaryCache } from '../cache/summaryCache';

export const useAppOrchestrator = () => {
    const { appSettings, setAppSettings, modelsList, selectedModel, setSelectedModel, apiKeys, setApiKeys } = useSettingsStore();
    const { files, setFiles, fileTree, isDragging } = useFileStore();
    const { isEmbedding, setIsEmbedding, computeDevice, mlWorkerCount, activeJobCount, setJobTimers } = useComputeStore();
    const { activeProjectId, setActiveProject } = useProjectStore();
    const { undo: undoCaseFile, redo: redoCaseFile, caseFile, setOverlayOpen, undoStack: cfUndoStack, redoStack: cfRedoStack } = useCaseFileStore();
    const { redo: redoChatFn, redoStack: chatRedoStack, activeSessionId } = useChatStore();
    const { handleLoadCaseFile } = useCaseFileIO();
    const { handleMapInstruction, isMapProcessing } = useMapAI();
    const { generateContextualDossier } = useDossierAI();
    const { initSessions, autoSaveCurrentSession } = useChatHistoryIO();
    
    const ui = useUIStore();

    const [rootDirectoryHandle, setRootDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);

    const { coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver } = useCompute(ui.docFontSize);

    const {
        userInput, setUserInput,
        chatHistory, setChatHistory,
        undo, historyStack,
        tokenUsage,
        currentContextTokens,
        isLoading,
        submitQuery,
        handleRedo: handleRerunQuery, handleSubmit, handleSourceClick, renderModelMessage,
        stopGeneration,
        handleClearConversation, handleRemoveMessage,
        handleUpdateMessage,
        handleSaveAndRerun: saveAndRerunAction,
        initialChatHistory,
        caseFileState, setCaseFileState,
        resendWithComments,
        hoveredSelectionId, setHoveredSelectionId,
        submitCaseFileComment
    } = useChat({
        coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver, 
        setRerankProgress: () => { }, 
        setActiveSource: (s) => ui.setActiveSource(s), 
        setIsModalOpen: (open) => ui.setDocModalOpen(open)
    });

    const {
        activeCommentInput, setActiveCommentInput,
        commentText, setCommentText,
        commentDraft, setCommentDraft,
        handleMouseUp,
        selectionPopover, setSelectionPopover,
        handleOpenSelectionCommentInput,
        handleAddSelectionComment,
        handleDeleteSelectionComment,
        handleStartComment,
        handleAddComment,
        handleEditComment,
        handleDeleteComment
    } = useChatComments(chatHistory, handleUpdateMessage);

    const {
        handleConfirmEdit,
        handleRejectEdit,
        handleConfirmAllEdits,
        handleRejectAllEdits
    } = useChatEdits(chatHistory, handleUpdateMessage);

    useMigration();

    useEffect(() => {
        initSessions();
    }, [initSessions]);

    useEffect(() => {
        if (!activeSessionId) return;
        const token = setTimeout(() => {
            autoSaveCurrentSession(activeSessionId, chatHistory, tokenUsage);
        }, 2000);
        return () => clearTimeout(token);
    }, [activeSessionId, chatHistory, tokenUsage, autoSaveCurrentSession]);

    useEffect(() => {
        if (activeProjectId) {
            useMapStore.getState().hydrateFromDB();
        }
    }, [activeProjectId]);

    const {
        glowType, setGlowType,
        showRejectionBubble, setShowRejectionBubble,
        setHasLLMResponded,
        backgroundImages, dropVideoSrc, setDropVideoSrc,
        showDropVideo, setShowDropVideo
    } = useAppUI({ isLoading, isEmbedding, activeJobCount, files, chatHistory, jobTimers: useComputeStore.getState().jobTimers, setJobTimers });

    const handleUndo = useCallback(() => { if (!isLoading) { undo(); undoCaseFile(); } }, [isLoading, undo, undoCaseFile]);
    const handleRedo = useCallback(() => { if (!isLoading) { redoChatFn(); redoCaseFile(); } }, [isLoading, redoChatFn, redoCaseFile]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !isLoading) {
                e.preventDefault(); handleUndo();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !isLoading) {
                e.preventDefault(); handleRedo();
            } else if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
                e.preventDefault();
                const selection = window.getSelection();
                const text = selection?.toString().trim() || '';
                generateContextualDossier(text);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isLoading, handleUndo, handleRedo, generateContextualDossier]);

    const { handleDrop, handleClearFiles } = useFileState({
        vectorStore, docFontSize: ui.docFontSize, coordinator, resetLLMResponseState: () => setHasLLMResponded(false)
    });

    const handleStartEdit = (idx: number, content: string) => {
        ui.setEditingIndex(idx);
        ui.setEditingContent(content);
    };

    const handleCancelEdit = () => {
        ui.setEditingIndex(null);
        ui.setEditingContent('');
    };

    const handleSaveAndRerun = async (idx: number) => {
        if (!ui.editingContent.trim()) return;
        saveAndRerunAction(idx, ui.editingContent);
        const content = ui.editingContent;
        handleCancelEdit();
        const newHistory = useChatStore.getState().chatHistory;
        await submitQuery(content, newHistory.slice(0, idx));
    };

    const handleCopy = async (idx: number) => {
        const msg = chatHistory[idx];
        if (msg?.content) await navigator.clipboard.writeText(msg.content);
    };

    const handleDownloadAction = async (idx: number) => {
        const msg = chatHistory[idx];
        if (msg?.content) {
            await downloadMessage(msg.content, idx, rootDirectoryHandle);
        }
    };

    useEffect(() => {
        if (coordinator.current) {
            coordinator.current.setLogging(appSettings.isLoggingEnabled);
            coordinator.current.setMlWorkerCount(appSettings.numMlWorkers);
        }
    }, [appSettings.isLoggingEnabled, appSettings.numMlWorkers, coordinator]);

    useEffect(() => {
        const load = async () => {
            const handle = await getStoredDirectoryHandle();
            if (handle && (await handle.queryPermission()) === 'granted') setRootDirectoryHandle(handle);
            else await clearStoredDirectoryHandle();
        };
        load();
    }, []);

    useEffect(() => {
        if (activeJobCount > 0) setIsEmbedding(true);
        else if (isEmbedding) {
            setIsEmbedding(false);
            setChatHistory((prev) => (prev[prev.length - 1]?.content?.startsWith('Knowledge base updated') ?? false) ? prev : [...prev, { role: 'model', content: 'Knowledge base updated.' }]);
        }
    }, [activeJobCount, isEmbedding, setChatHistory, setIsEmbedding]);

    const handleClear = () => {
        if (window.confirm('Clear?')) {
            embeddingCache.clear(); summaryCache.clear();
            setFiles(prev => prev.map(f => ({ ...f, summaryStatus: 'missing', language: 'unknown' })));
            setChatHistory([...initialChatHistory, { role: 'model', content: 'Cleared.' }]);
        }
    };

    const handleShowSum = async (f: AppFile) => {
        const cached = await summaryCache.get(f.id);
        if (cached?.summary) { ui.openSummary(f, cached.summary); return; }
        if (coordinator.current) setFiles(p => p.map(file => file.id === f.id ? { ...file, summaryStatus: 'in_progress' } : file));
    };

    const handleDropValidate = (e: React.DragEvent) => {
        e.preventDefault();
        const items = Array.from(e.dataTransfer.items);
        if (!items.some(i => i.webkitGetAsEntry()?.isDirectory)) {
            const bad = Array.from(e.dataTransfer.files).filter(f => !['pdf', 'txt', 'md', 'docx', 'doc', 'json', 'csv', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'html', 'css', 'xml', 'yaml', 'yml'].includes(f.name.split('.').pop()?.toLowerCase() || ''));
            if (bad.length > 0) {
                setGlowType('red'); setShowRejectionBubble(true); setShowDropVideo(true); setDropVideoSrc('/assets/drop_NOT_accepted.mp4');
                setTimeout(() => { setGlowType('default'); setShowRejectionBubble(false); }, 5000);
                return;
            }
        }
        handleDrop(e as React.DragEvent<HTMLDivElement>);
    };

    const messageHandlers = {
        handleSaveAndRerun, handleCancelEdit, handleUpdateMessage, submitQuery,
        handleRejectAllEdits, handleConfirmAllEdits, handleConfirmEdit, handleRejectEdit,
        renderModelMessage, setHoveredSelectionId, resendWithComments,
        handleStartComment, handleAddComment, handleEditComment, handleDeleteComment,
        handleDeleteSelectionComment, setActiveCommentInput, setCommentText,
        handleCopy, handleDownloadAction, handleStartEdit,
        handleRedo: handleRerunQuery,
        handleRemoveMessage, handleMouseUp,
        onUpdateMapFromMessage: (content: string) => {
            ui.setIsMapPanelOpen(true);
            handleMapInstruction(content);
        },
        isMapProcessing,
        onOpenInCaseFile: (content: string, title?: string) => {
            const clean = content.replace(/<!--searchResults:[\s\S]*?-->/g, '').trim();
            import('../utils/caseFileUtils').then(({ parseCaseFileFromMarkdown }) => {
                try {
                    const parsed = JSON.parse(clean);
                    if (parsed.version === 1 && Array.isArray(parsed.sections)) {
                        const normalized = {
                            ...parsed,
                            sections: parsed.sections.map((s: import('../types').CaseFileSection) => ({
                                ...s,
                                content: (s.content as string)
                                    .replace(/\\n/g, '\n')
                                    .replace(/\\t/g, '    ')
                            }))
                        };
                        useCaseFileStore.getState().loadCaseFile(normalized);
                        return;
                    }
                } catch { /* not JSON */ }
                const cf = parseCaseFileFromMarkdown(clean, title ?? 'Case File');
                useCaseFileStore.getState().loadCaseFile(cf);
            });
        }
    };

    const onOpenExplorer = async () => {
        let h = rootDirectoryHandle;
        if (h && (await h.queryPermission()) !== 'granted') { await clearStoredDirectoryHandle(); h = null; setRootDirectoryHandle(null); }
        if (!h) try { h = await window.showDirectoryPicker(); if (h) { await storeDirectoryHandle(h); setRootDirectoryHandle(h); } } catch { /* ignore */ }
        if (h) ui.setIsExplorerOpen(true);
    };

    return {
        // Core state
        appSettings, setAppSettings, modelsList, selectedModel, setSelectedModel, apiKeys, setApiKeys,
        files, fileTree, isDragging,
        isEmbedding, computeDevice, mlWorkerCount, activeJobCount,
        activeProjectId, setActiveProject,
        rootDirectoryHandle,
        
        // Chat state
        userInput, setUserInput, chatHistory, tokenUsage, currentContextTokens, isLoading,
        submitQuery, renderModelMessage,
        
        // UI states (from store)
        ui,
        
        // Handlers
        handleUndo, handleRedo,
        handleSubmit, handleSourceClick, stopGeneration,
        handleClearConversation, handleRemoveMessage,
        handleClearFiles, handleClear, handleShowSum,
        onOpenExplorer, handleDropValidate,
        messageHandlers,
        
        // Computed
        canUndo: historyStack.length > 0 || cfUndoStack.length > 0,
        canRedo: chatRedoStack.length > 0 || cfRedoStack.length > 0,
        
        // Complex AI integrations
        generateContextualDossier,
        handleMapInstruction,
        isMapProcessing,
        
        // Case file
        caseFile,
        handleLoadCaseFile,
        setOverlayOpen,
        caseFileState,
        setCaseFileState,
        submitCaseFileComment,
        
        // UI logic
        glowType, showRejectionBubble, showDropVideo, dropVideoSrc, setShowDropVideo,
        
        // Comments/Selections
        activeCommentInput, commentText, selectionPopover, commentDraft, setCommentDraft,
        handleOpenSelectionCommentInput, handleAddSelectionComment, setSelectionPopover,
        hoveredSelectionId,
        
        // Backgrounds
        backgroundImages,
        
        // Refs/Special
        coordinator,
        vectorStore
    };
};