import { useState, useEffect, useLayoutEffect, FC, useMemo, useCallback } from 'react';
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
import { useToastStore } from './store/useToastStore';
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
import { ProgressBar } from './components/ProgressBar';
import { ToastContainer } from './components/ToastContainer';
import { useDossierAI } from './hooks/useDossierAI';
import { useMapAI } from './hooks/useMapAI';

import './style.css';
import './progress-bar.css';
import './Modal.css';

import { WelcomePage } from './components/WelcomePage';
import { GlobalBackground } from './components/GlobalBackground';
import { motion, AnimatePresence } from 'framer-motion';

const MainApp: FC = () => {
  const { appSettings, setAppSettings, modelsList, selectedModel, setSelectedModel, apiKeys, setApiKeys } = useSettingsStore();
  const { fileTree, selectedFile, isDragging } = useFileStore();
  const { computeDevice, mlWorkerCount, totalMlWorkerCount, rerankerWorkerCount, isInitializingWorkers } = useComputeStore();

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
  const [isSplitView, setIsSplitView] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isMapPanelOpen, setIsMapPanelOpen] = useState(false);
  const [rootDirectoryHandle, setRootDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);

  // Initialize heavy compute workers ONLY when this component mounts
  const { coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver } = useCompute(docFontSize);

  const chatConfig = useMemo(() => ({
    coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver,
    setRerankProgress: () => { }, setActiveSource, setIsModalOpen, setIsMapPanelOpen
  }), [coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver, setActiveSource, setIsModalOpen, setIsMapPanelOpen]);

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
    const newHistory = useChatStore.getState().chatHistory;
    await submitQuery(editingContent, newHistory.slice(0, idx));
  }, [editingContent, saveAndRerunAction, submitQuery]);

  const {
    jobTimers, setJobTimers, activeJobCount, isEmbedding, setIsEmbedding
  } = useComputeStore();

  const { files, setFiles, clearFiles } = useFileStore();

  const { handleMapInstruction, isMapProcessing } = useMapAI({ coordinator, vectorStore, queryEmbeddingResolver });

  useEffect(() => {
    useMapStore.getState().setIsRagEnabled(files.length > 0);
  }, [files.length]);

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

  const { activeProjectId, setActiveProject } = useProjectStore();

  useLayoutEffect(() => {
    setActiveProject(null);
  }, [setActiveProject]);

  useEffect(() => {
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

  const dossierAIRefs = { vectorStore, coordinator, queryEmbeddingResolver, chatHistory };
  const { generateContextualDossier } = useDossierAI(dossierAIRefs);

  const handleUndo = () => { undo(); undoCaseFile(); };
  const handleRedo = () => { redoChatFn(); redoCaseFile(); };

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
      useToastStore.getState().addToast('Knowledge base updated.', 'system-alert', 1000);
    }
  }, [activeJobCount, isEmbedding, setChatHistory, setIsEmbedding]);

  const handleClear = () => {
    if (window.confirm('Clear?')) {
      embeddingCache.clear(); summaryCache.clear();
      setFiles(prev => prev.map(f => ({ ...f, summaryStatus: 'missing', language: 'unknown' })));
      setChatHistory(initialChatHistory);
      useToastStore.getState().addToast('Cleared.', 'system-alert', 1000);
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
    handleSourceClick,
    handleRedo: handleRerunQuery,
    handleRemoveMessage, handleMouseUp,
    onUpdateMapFromMessage: (content: string) => {
      setIsMapPanelOpen(true);
      handleMapInstruction(content);
    },
    isMapProcessing,
    onOpenInCaseFile: (content: string, title?: string) => {
      const clean = content.replace(/<!--searchResults:[\s\S]*?-->/g, '').trim();
      import('./utils/caseFileUtils').then(({ parseCaseFileFromMarkdown }) => {
        try {
          const parsed = JSON.parse(clean);
          if (parsed.version === 1 && Array.isArray(parsed.sections)) {
            const normalized = {
              ...parsed,
              sections: parsed.sections.map((s: import('./types').CaseFileSection) => ({
                ...s,
                content: (s.content as string).replace(/\\n/g, '\n').replace(/\\t/g, '    ')
              }))
            };
            useCaseFileStore.getState().loadCaseFile(normalized);
            return;
          }
        } catch {
          // Ignore parsing errors, fall through to markdown parsing
        }
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

  const wrappedHandleSourceClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const isSourceLink = !!target.closest('.source-link');
    if (isDossierOpen && isSourceLink) {
      setIsSplitView(true);
    }
    handleSourceClick(e);
  }, [handleSourceClick, isDossierOpen]);

  return (
    <>
      {!activeProjectId ? (
        <div style={{ width: '100vw', height: '100vh', display: 'flex', background: 'transparent' }}>
          <ProjectBrowser />
          <ToastContainer />
        </div>
      ) : (
        <>
          {(isInitializingWorkers || (totalMlWorkerCount > 0 && rerankerWorkerCount < totalMlWorkerCount)) && (
            <div className="system-progress-overlay">
              <ProgressBar progress={mlWorkerCount} total={totalMlWorkerCount} label="Embedding workers online..." />
              {!isInitializingWorkers && totalMlWorkerCount > 0 && (
                <ProgressBar progress={rerankerWorkerCount} total={totalMlWorkerCount} label="Rerankers warming up..." className="system-progress-overlay__reranker" />
              )}
            </div>
          )}
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
            onOpenExplorer={onOpenExplorer} isPinned={isPinned} setIsPinned={setIsPinned}
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
            computeDevice={computeDevice}
          />

          {isMapPanelOpen && (
            <div className="investigation-map-panel-wrapper">
              <InvestigationMapPanel
                onClose={() => setIsMapPanelOpen(false)}
                onOpenDossierForNode={(dossierId) => {
                  useDossierStore.getState().setActiveDossier(dossierId);
                  setIsDossierOpen(true);
                }}
                onOpenFileChunk={(fileId, chunkIndex, start = 0, end = 0, snippet = '') => {
                  const file = files.find(f => f.id === fileId);
                  if (file) {
                    const docViewerChunk = { id: fileId, parentChunkIndex: chunkIndex, start, end, chunk: snippet, similarity: 0 };
                    setActiveSource({ file, chunks: [docViewerChunk] });
                    setIsModalOpen(true);
                  } else {
                    useToastStore.getState().addToast('Source file not found in current knowledge base.', 'warning');
                  }
                }}
                coordinator={coordinator}
                vectorStore={vectorStore}
                queryEmbeddingResolver={queryEmbeddingResolver}
              />
            </div>
          )}

          <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} isSplitView={isSplitView}>
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
          {isDossierOpen && (
            <DossierPanel
              isOpen={isDossierOpen}
              onClose={() => {
                setIsDossierOpen(false);
                setIsSplitView(false);
              }}
              isSplitView={isSplitView}
              onToggleSplitView={() => setIsSplitView(!isSplitView)}
              vectorStore={vectorStore}
              coordinator={coordinator}
              queryEmbeddingResolver={queryEmbeddingResolver}
              chatHistory={chatHistory}
              renderModelMessage={renderModelMessage}
              handleSourceClick={wrappedHandleSourceClick}
            />
          )}

          {selectionPopover && (
            <div className="selection-popover" style={{ top: selectionPopover.top, left: selectionPopover.left }}>
              {selectionPopover.commentInputOpen ? (
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
                    <button className="button" onClick={() => handleAddSelectionComment(selectionPopover.msgIndex, selectionPopover.text, selectionPopover.sectionId, commentDraft)} disabled={!commentDraft.trim()}>Save</button>
                    <button className="button secondary" onClick={() => setCommentDraft('')}>Clear</button>
                  </div>
                </div>
              ) : (
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
        </>
      )}
    </>
  );
};

export const App: FC = () => {
  const [showWelcome, setShowWelcome] = useState(true);
  const [videoDone, setVideoDone] = useState(false);

  return (
    <div className='app-container' style={{ background: 'transparent' }}>
      <GlobalBackground 
        videoSrc="/assets/background_1.mp4" 
        onVideoEnd={() => setVideoDone(true)} 
      />
      
      <AnimatePresence mode="wait">
        {showWelcome && (
          <motion.div
            key="welcome"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            style={{ 
              position: 'fixed', 
              inset: 0, 
              zIndex: 1000, 
              backgroundColor: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'auto'
            }}
          >
            <WelcomePage 
              onEnter={() => setShowWelcome(false)} 
              videoDone={videoDone} 
              setVideoDone={setVideoDone} 
            />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: showWelcome ? 0 : 1 }} 
        transition={{ duration: 1.2, ease: "easeOut" }}
        style={{ 
          width: '100%', 
          height: '100%', 
          display: 'flex', 
          background: 'transparent',
          pointerEvents: showWelcome ? 'none' : 'auto',
          visibility: showWelcome ? 'hidden' : 'visible'
        }}
      >
        {!showWelcome && <MainApp />}
      </motion.div>
    </div>
  );
};
