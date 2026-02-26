import { useState, useEffect, FC, useMemo, useCallback } from 'react';
import { getStoredDirectoryHandle, storeDirectoryHandle, clearStoredDirectoryHandle } from './utils/db';
import { useFileState, useCompute, useChat } from './hooks';
import { AppFile, ViewMode, SearchResult, Model } from './types';
import { embeddingCache } from './cache/embeddingCache';
import { summaryCache } from './cache/summaryCache';
import Modal from './Modal';
import EmbeddingCacheModal from './components/EmbeddingCacheModal';
import SummaryModal from './components/SummaryModal';
import MemoizedDocViewer from './components/DocViewer';
import CustomFileExplorer from './components/CustomFileExplorer';
import RecoveryDialogContainer from './components/RecoveryDialogContainer';
import { processExplorerItems, downloadMessage } from './utils/appActions';
import { scanDirectoryHandle } from './utils/fileExplorer';
import { useSettingsStore, useFileStore, useComputeStore } from './store';
import { useCaseFileStore } from './store/useCaseFileStore';
import { useChatStore } from './store/useChatStore';
import { useProjectStore } from './store/useProjectStore';
import { useDossierStore } from './store/useDossierStore';
import { useMapStore } from './store/useMapStore';
import { useCaseFileIO } from './hooks/useCaseFileIO';
import { Edit2, FileText } from 'lucide-react';

// Extracted Components and Hooks
import { useChatComments } from './hooks/useChatComments';
import { useChatEdits } from './hooks/useChatEdits';
import { useChatHistoryIO } from './hooks/useChatHistoryIO';
import { useMigration } from './hooks/useMigration';
import { useAppUI } from './hooks/useAppUI';
import { FilePanel } from './components/FilePanel';
import { ChatPanel } from './components/ChatPanel';
import { CaseFilePanel } from './components/CaseFile/CaseFilePanel';
import { DossierPanel } from './components/Dossier/DossierPanel';
import { InvestigationMapPanel } from './components/InvestigationMap/InvestigationMapPanel';
import { ProjectBrowser } from './components/ProjectBrowser/ProjectBrowser';
import { ToastContainer } from './components/ToastContainer';
import { useDossierAI } from './hooks/useDossierAI';
import { useMapAI } from './hooks/useMapAI';

import './style.css';
import './progress-bar.css';
import './Modal.css';

export const App: FC = () => {
  const { appSettings, setAppSettings, modelsList, selectedModel, setSelectedModel, apiKeys, setApiKeys } = useSettingsStore();
  const { fileTree, selectedFile, isDragging } = useFileStore();
  const { computeDevice, mlWorkerCount } = useComputeStore();

  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCacheModalOpen, setIsCacheModalOpen] = useState(false);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [currentSummary, setCurrentSummary] = useState('');
  const [summaryFile, setSummaryFile] = useState<AppFile | null>(null);
  const [activeSource, setActiveSource] = useState<{ file: AppFile, chunks: SearchResult[] } | null>(null);
  const [docFontSize, setDocFontSize] = useState(0.9);
  const [showSettings, setShowSettings] = useState(true);
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [isDossierOpen, setIsDossierOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isMapPanelOpen, setIsMapPanelOpen] = useState(false);
  const [rootDirectoryHandle, setRootDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);

  const { coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver } = useCompute(docFontSize);

  const chatConfig = useMemo(() => ({
    coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver, 
    setRerankProgress: () => { }, setActiveSource, setIsModalOpen
  }), [coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver, setActiveSource, setIsModalOpen]);

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
  } = useChat(chatConfig);

  // ── Case file store + IO ──────────────────────────────────────────────────
  const {
    undo: undoCaseFile,
    redo: redoCaseFile,
    caseFile,
    setOverlayOpen,
    undoStack: cfUndoStack,
    redoStack: cfRedoStack
  } = useCaseFileStore();
  const { handleLoadCaseFile } = useCaseFileIO();
  // Chat redo lives in useChatStore (separate from useChat return)
  const { redo: redoChatFn, redoStack: chatRedoStack } = useChatStore();

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

  // ── Map Integration ───────────────────────────────────────────────────────
  const { handleMapInstruction, isMapProcessing } = useMapAI();

  const {
    handleConfirmEdit,
    handleRejectEdit,
    handleConfirmAllEdits,
    handleRejectAllEdits
  } = useChatEdits(chatHistory, handleUpdateMessage);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');

  const handleStartEdit = useCallback((idx: number, content: string) => {
    setEditingIndex(idx);
    setEditingContent(content);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
    setEditingContent('');
  }, []);

  const handleSaveAndRerun = useCallback(async (idx: number) => {
    if (!editingContent.trim()) return;
    saveAndRerunAction(idx, editingContent);
    setEditingIndex(null);
    setEditingContent('');
    // Wait a tick for the store to update or pass the new history explicitly if handleRerunQuery allowed it.
    // Since handleRerunQuery uses chatHistory from the hook, we need to make sure it's updated.
    // Alternatively, we can call submitQuery directly with the new history.
    const newHistory = useChatStore.getState().chatHistory;
    await submitQuery(editingContent, newHistory.slice(0, idx));
  }, [editingContent, saveAndRerunAction, submitQuery]);

  const {
    jobTimers, setJobTimers, activeJobCount, isEmbedding, setIsEmbedding
  } = useComputeStore();

  const { files, setFiles, clearFiles } = useFileStore();

  const uiConfig = useMemo(() => ({ 
    isLoading, isEmbedding, activeJobCount, files, chatHistory, jobTimers, setJobTimers 
  }), [isLoading, isEmbedding, activeJobCount, files, chatHistory, jobTimers, setJobTimers]);

  const {
    glowType, setGlowType,
    showRejectionBubble, setShowRejectionBubble,
    setHasLLMResponded,
    backgroundImages, dropVideoSrc, setDropVideoSrc,
    showDropVideo, setShowDropVideo
  } = useAppUI(uiConfig);

  const fileConfig = useMemo(() => ({
    vectorStore, docFontSize, coordinator, 
    resetLLMResponseState: () => setHasLLMResponded(false)
  }), [vectorStore, docFontSize, coordinator, setHasLLMResponded]);

  const { handleDrop, handleClearFiles, addFilesAndEmbed } = useFileState(fileConfig);

  const {
    initSessions,
    autoSaveCurrentSession
  } = useChatHistoryIO();

  const { activeSessionId } = useChatStore();

  useMigration();

  // Initialize sessions on mount
  useEffect(() => {
    initSessions();
  }, [initSessions]);

  // Debounced auto-save
  useEffect(() => {
    if (!activeSessionId) return;

    const token = setTimeout(() => {
      autoSaveCurrentSession(activeSessionId, chatHistory, tokenUsage);
    }, 2000);

    return () => clearTimeout(token);
  }, [activeSessionId, chatHistory, tokenUsage, autoSaveCurrentSession]);

  const { activeProjectId, setActiveProject } = useProjectStore();

  // ── Project Switching Logic ──────────────────────────────────────────────
  useEffect(() => {
    // Narrow dependency array to activeProjectId to avoid render loops from unstable hook functions.
    // We call everything within the effect; dependencies like addFilesAndEmbed are unstable 
    // because they depend on the files state we modify here.
    if (!activeProjectId) {
      clearFiles();
      vectorStore?.current?.clear();
      useChatStore.getState().setActiveSessionId(null);
      useChatStore.getState().setSessionList([]);
      useChatStore.getState().setChatHistory([]);
      useMapStore.getState().resetMap();
      useCaseFileStore.getState().resetCaseFile();
      useDossierStore.getState().setActiveDossier(null);
      setRootDirectoryHandle(null);
      return;
    }

    const switchProject = async () => {
      console.log(`[App] Switching to project: ${activeProjectId}`);

      clearFiles();
      vectorStore?.current?.clear();
      useChatStore.getState().setActiveSessionId(null);
      useChatStore.getState().setSessionList([]);
      useChatStore.getState().setChatHistory([]);
      useMapStore.getState().resetMap();
      useCaseFileStore.getState().resetCaseFile();
      useDossierStore.getState().setActiveDossier(null);

      await useMapStore.getState().hydrateFromDB();
      await initSessions();

      try {
        const handle = await getStoredDirectoryHandle(activeProjectId);
        if (handle) {
          if ((await handle.queryPermission()) === 'granted') {
            setRootDirectoryHandle(handle);
            const items = await scanDirectoryHandle(handle);
            const projectFiles = await processExplorerItems(items);
            if (projectFiles.length > 0) {
              await addFilesAndEmbed(projectFiles);
            }
          } else {
            setRootDirectoryHandle(null);
          }
        } else {
          setRootDirectoryHandle(null);
        }
      } catch (e) {
        console.error('[App] Failed to load directory handle:', e);
        setRootDirectoryHandle(null);
      }
    };

    switchProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  const { generateContextualDossier } = useDossierAI();

  // ── Combined undo / redo ────────────────────────────────
  const handleUndo = () => { undo(); undoCaseFile(); };
  const handleRedo = () => { redoChatFn(); redoCaseFile(); };

  // Keyboard shortcuts: Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !isLoading) {
        e.preventDefault();
        undo(); undoCaseFile();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !isLoading) {
        e.preventDefault();
        redoChatFn(); redoCaseFile();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        const selection = window.getSelection();
        const text = selection?.toString().trim() || '';
        generateContextualDossier(text);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

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
    if (activeJobCount > 0) setIsEmbedding(true);
    else if (isEmbedding) {
      setIsEmbedding(false);
      setChatHistory((prev) => (prev[prev.length - 1]?.content?.startsWith('Knowledge base updated') ?? false) ? prev : [...prev, { role: 'model', content: `Knowledge base updated.` }]);
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
    if (cached?.summary) { setCurrentSummary(cached.summary); setSummaryFile(f); setIsSummaryModalOpen(true); return; }
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
    // "handleRedo" in MessageItemHandlers = per-message re-run (renamed to avoid collision)
    handleRedo: handleRerunQuery,
    handleRemoveMessage, handleMouseUp,
    onUpdateMapFromMessage: (content: string) => {
      setIsMapPanelOpen(true);
      handleMapInstruction(content);
    },
    isMapProcessing,
    onOpenInCaseFile: (content: string, title?: string) => {
      // Strip the <!--searchResults:…--> annotation (may span multiple lines)
      const clean = content.replace(/<!--searchResults:[\s\S]*?-->/g, '').trim();
      import('./utils/caseFileUtils').then(({ parseCaseFileFromMarkdown }) => {
        // 1. Try to parse as a proper CaseFile JSON — the LLM often outputs this structure directly
        try {
          const parsed = JSON.parse(clean);
          if (parsed.version === 1 && Array.isArray(parsed.sections)) {
            // Ensure section content strings have real newlines (LLM may use \\n inside JSON)
            const normalized = {
              ...parsed,
              sections: parsed.sections.map((s: import('./types').CaseFileSection) => ({
                ...s,
                content: (s.content as string)
                  .replace(/\\n/g, '\n')
                  .replace(/\\t/g, '    ')
              }))
            };
            useCaseFileStore.getState().loadCaseFile(normalized);
            return; // loadCaseFile already opens the overlay
          }
        } catch { /* not JSON – fall through to markdown */ }
        // 2. Parse as plain Markdown
        const cf = parseCaseFileFromMarkdown(clean, title ?? 'Case File');
        useCaseFileStore.getState().loadCaseFile(cf);
      });
    }
  };

  const onOpenExplorer = async () => {
    if (!activeProjectId) return;
    let h = rootDirectoryHandle;
    if (h && (await h.queryPermission()) !== 'granted') {
      await clearStoredDirectoryHandle(activeProjectId);
      h = null;
      setRootDirectoryHandle(null);
    }
    if (!h) {
      try {
        h = await window.showDirectoryPicker();
        if (h) {
          await storeDirectoryHandle(activeProjectId, h);
          setRootDirectoryHandle(h);
        }
      } catch (e) {
        console.warn('[App] Directory picker cancelled or failed:', e);
      }
    }
    if (h) setIsExplorerOpen(true);
  };

  if (!activeProjectId) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
        <ProjectBrowser />
        <ToastContainer />
      </div>
    );
  }

  return (
    <div className='app-container'>
      <FilePanel
        showSettings={showSettings} setShowSettings={setShowSettings}
        glowType={glowType} isDragging={isDragging} handleDropValidate={handleDropValidate}
        files={files} activeJobCount={activeJobCount} isLoading={isLoading} isEmbedding={isEmbedding}
        showRejectionBubble={showRejectionBubble} showDropVideo={showDropVideo} dropVideoSrc={dropVideoSrc}
        setShowDropVideo={setShowDropVideo} handleClearFiles={handleClearFiles}
        initialChatHistory={initialChatHistory} handleClearConversation={handleClearConversation}
        chatHistory={chatHistory} handleClear={handleClear}
        computeDevice={computeDevice} mlWorkerCount={mlWorkerCount} viewMode={viewMode}
        setViewMode={setViewMode} fileTree={fileTree} handleShowSum={handleShowSum}
        onOpenExplorer={onOpenExplorer}
        isPinned={isPinned}
        setIsPinned={setIsPinned}
        onBackToProjects={() => setActiveProject(null)}
      />
      <ChatPanel
        appSettings={appSettings} setAppSettings={setAppSettings}
        backgroundImages={backgroundImages} handleSourceClick={handleSourceClick}
        chatHistory={chatHistory} isLoading={isLoading} isEmbedding={isEmbedding}
        editingIndex={editingIndex} editingContent={editingContent} setEditingContent={setEditingContent}
        activeCommentInput={activeCommentInput} commentText={commentText}
        hoveredSelectionId={hoveredSelectionId} rootDirectoryHandle={rootDirectoryHandle}
        caseFileState={caseFileState} handlers={messageHandlers}
        userInput={userInput} setUserInput={setUserInput} activeJobCount={activeJobCount}
        files={files} handleSubmit={handleSubmit} stopGeneration={stopGeneration}
        setCaseFileState={setCaseFileState} submitQuery={submitQuery} tokenUsage={tokenUsage}
        currentContextTokens={currentContextTokens}
        undo={handleUndo} redo={handleRedo}
        canUndo={historyStack.length > 0 || cfUndoStack.length > 0}
        canRedo={chatRedoStack.length > 0 || cfRedoStack.length > 0}
        onLoadCaseFile={handleLoadCaseFile}
        onOpenCaseFile={() => setOverlayOpen(true)}
        hasCaseFile={!!caseFile}
        isDossierOpen={isDossierOpen}
        setIsDossierOpen={setIsDossierOpen}
        isMapPanelOpen={isMapPanelOpen}
        setIsMapPanelOpen={setIsMapPanelOpen}
      />

      {isMapPanelOpen && (
        <div className="investigation-map-panel-wrapper">
          <InvestigationMapPanel
            onClose={() => setIsMapPanelOpen(false)}
            onOpenDossierForNode={(dossierId) => {
              useDossierStore.getState().setActiveDossier(dossierId);
              setIsDossierOpen(true);
            }}
          />
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <MemoizedDocViewer
          coordinator={coordinator.current}
          selectedFile={activeSource?.file ?? selectedFile}
          chunksToHighlight={activeSource?.chunks ?? []}
          docFontSize={docFontSize}
          setDocFontSize={setDocFontSize}
        />
      </Modal>
      <EmbeddingCacheModal isOpen={isCacheModalOpen} onClose={() => setIsCacheModalOpen(false)} />
      {summaryFile && <SummaryModal isOpen={isSummaryModalOpen} onClose={() => setIsSummaryModalOpen(false)} summary={currentSummary} fileName={summaryFile.name} />}
      <CustomFileExplorer isOpen={isExplorerOpen} onClose={() => setIsExplorerOpen(false)} rootDirectoryHandle={rootDirectoryHandle} onFilesSelected={async (items) => {
        const toAdd = await processExplorerItems(items);
        addFilesAndEmbed(toAdd); setIsExplorerOpen(false);
      }} />
      <RecoveryDialogContainer availableModels={modelsList} currentModel={selectedModel} apiKeys={apiKeys} onModelChange={(m: Model, k?: string) => { setSelectedModel(m); if (k) setApiKeys(prev => ({ ...prev, [m.provider]: k })); }} />

      <CaseFilePanel
        renderModelMessage={(content) => renderModelMessage(content)}
        onResolveComment={async (cf, sId, comment) => {
          await submitCaseFileComment(cf, sId, comment, (resolvedSectionId, commentId, newContent) => {
            useCaseFileStore.getState().resolveComment(resolvedSectionId, commentId, newContent);
          });
        }}
      />

      <DossierPanel isOpen={isDossierOpen} onClose={() => setIsDossierOpen(false)} />

      {selectionPopover && (
        <div className="selection-popover" style={{ top: selectionPopover.top, left: selectionPopover.left }}>
          {selectionPopover.commentInputOpen ? (
            // Inline comment form
            <div className="selection-popover-form" onMouseDown={e => e.stopPropagation()}>
              <textarea
                className="selection-popover-textarea"
                autoFocus
                placeholder="Enter your comment…"
                value={commentDraft}
                onChange={e => setCommentDraft(e.target.value)}
                rows={3}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAddSelectionComment(selectionPopover.msgIndex, selectionPopover.text, selectionPopover.sectionId, commentDraft);
                  }
                  if (e.key === 'Escape') setCommentDraft('');
                }}
              />
              <div className="selection-popover-actions">
                <button
                  className="button"
                  onClick={() => handleAddSelectionComment(selectionPopover.msgIndex, selectionPopover.text, selectionPopover.sectionId, commentDraft)}
                  disabled={!commentDraft.trim()}
                >Save</button>
                <button className="button secondary" onClick={() => setCommentDraft('')}>Clear</button>
              </div>
            </div>
          ) : (
            // Initial button
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <button className="selection-popover-btn" onClick={handleOpenSelectionCommentInput}>
                <Edit2 size={14} /> Review Selection
              </button>
              <button className="selection-popover-btn" onClick={() => {
                generateContextualDossier(selectionPopover.text);
                setSelectionPopover(null);
              }}>
                <FileText size={14} /> Compile Dossier
              </button>
            </div>
          )}
        </div>
      )}

      <ToastContainer />
    </div>
  );
};
