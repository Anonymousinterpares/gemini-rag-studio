import { useState, useRef, useEffect, FC, useCallback } from 'react';
import { getStoredDirectoryHandle, storeDirectoryHandle, clearStoredDirectoryHandle } from './utils/db';
import { Trash2, X, RefreshCw, LayoutGrid, List as ListIcon, FolderTree, ChevronLeft, ChevronRight, User, Bot, Send, Copy, Download, Info } from 'lucide-react';
import { useFileState, useCompute, useChat } from './hooks';
import { AppFile, ViewMode, SearchResult, Model } from './types';
import { embeddingCache } from './cache/embeddingCache';
import { summaryCache } from './cache/summaryCache';
import Settings from './components/Settings';
import CustomFileExplorer from './components/CustomFileExplorer';
import { getMessageTextContent, downloadMessage, processExplorerItems } from './utils/appActions';
import MemoizedFileTreeView from './components/FileTreeView';
import MemoizedFileListView from './components/FileListView';
import MemoizedDocViewer from './components/DocViewer';
import Modal from './Modal';
import EmbeddingCacheModal from './components/EmbeddingCacheModal';
import SummaryModal from './components/SummaryModal';
import { SpeechBubble, DigestParticles, FloatingArrows, RejectionBubble } from './components/Monster';
import RecoveryDialogContainer from './components/RecoveryDialogContainer';
import { useSettingsStore, useFileStore, useChatStore, useComputeStore } from './store';
import './style.css';
import './progress-bar.css';
import './Modal.css';

export const App: FC = () => {
  const { appSettings, setAppSettings, modelsList, selectedModel, setSelectedModel, apiKeys, setApiKeys } = useSettingsStore();
  const { files, setFiles, fileTree, selectedFile, isDragging } = useFileStore();
  const { chatHistory, setChatHistory, userInput, setUserInput, tokenUsage, isLoading } = useChatStore();
  const { isEmbedding, setIsEmbedding, jobTimers, setJobTimers, computeDevice, mlWorkerCount, activeJobCount } = useComputeStore();

  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCacheModalOpen, setIsCacheModalOpen] = useState(false);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [currentSummary, setCurrentSummary] = useState('');
  const [summaryFile, setSummaryFile] = useState<AppFile | null>(null);
  const [activeSource, setActiveSource] = useState<{ file: AppFile, chunks: SearchResult[] } | null>(null);
  const [docFontSize, setDocFontSize] = useState(0.9);
  const [showSettings, setShowSettings] = useState(true);
  const [dropVideoSrc, setDropVideoSrc] = useState('');
  const [showDropVideo, setShowDropVideo] = useState(false);
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [rootDirectoryHandle, setRootDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [glowType, setGlowType] = useState<'default' | 'blue' | 'yellow' | 'green' | 'red'>('default');
  const [showRejectionBubble, setShowRejectionBubble] = useState(false);
  const [hasLLMResponded, setHasLLMResponded] = useState(false);
  const [backgroundImages, setBackgroundImages] = useState<string[]>([]);

  const { coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver } = useCompute(docFontSize);

  const { handleRedo, handleSubmit, handleSourceClick, renderModelMessage, handleClearConversation, handleRemoveMessage, initialChatHistory } = useChat({
    coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver, setRerankProgress: () => {}, setActiveSource, setIsModalOpen
  });

  const { handleDrop, handleClearFiles, addFilesAndEmbed } = useFileState({
    vectorStore, docFontSize, coordinator, resetLLMResponseState: () => setHasLLMResponded(false)
  });

  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const dropVideoRef = useRef<HTMLVideoElement>(null);

  const handleCopy = useCallback(async (idx: number) => {
    const text = getMessageTextContent(idx, chatHistoryRef);
    if (text) await navigator.clipboard.writeText(text);
  }, []);

  const handleDownloadAction = useCallback(async (idx: number) => {
    const text = getMessageTextContent(idx, chatHistoryRef);
    if (text) await downloadMessage(text, idx, rootDirectoryHandle);
  }, [rootDirectoryHandle]);

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
      setChatHistory((prev) => prev[prev.length - 1]?.content.startsWith('Knowledge base updated') ? prev : [...prev, { role: 'model', content: `Knowledge base updated.` }]);
    }
  }, [activeJobCount, isEmbedding, setChatHistory, setIsEmbedding]);

  useEffect(() => {
    if (glowType === 'red') return;
    const nextGlow = isLoading || isEmbedding || activeJobCount > 0 ? 'yellow' : (files.length === 0 ? 'default' : (!hasLLMResponded ? 'blue' : 'green'));
    if (nextGlow !== glowType) setGlowType(nextGlow);
  }, [isLoading, isEmbedding, activeJobCount, files.length, hasLLMResponded, glowType]);

  useEffect(() => {
    if (chatHistory.length > 1) {
      const last = chatHistory[chatHistory.length - 1];
      const isUser = chatHistory[chatHistory.length - 2]?.role === 'user';
      if (last.role === 'model' && !isLoading && !isEmbedding && isUser && !['Loading', 'Adding', 'Knowledge base'].some(s => last.content.includes(s))) {
        if (!hasLLMResponded) setHasLLMResponded(true);
        setGlowType('green');
      }
    }
  }, [chatHistory, isLoading, isEmbedding, hasLLMResponded]);

  useEffect(() => {
    const active = Object.values(jobTimers).some(t => t.isActive);
    let interval: number;
    if (active) {
      interval = window.setInterval(() => {
        setJobTimers(prev => {
          const next = { ...prev };
          let changed = false;
          for (const k in next) if (next[k].isActive) { next[k] = { ...next[k], elapsed: Date.now() - next[k].startTime }; changed = true; }
          return changed ? next : prev;
        });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [jobTimers, setJobTimers]);

  useEffect(() => {
    const discover = async () => {
      const bgs: string[] = [];
      for (let i = 1; i <= 20; i++) {
        const path = `/assets/background${i}.png`;
        try { await new Promise<void>((res, rej) => { const img = new Image(); img.onload = () => res(); img.onerror = () => rej(); img.src = path; }); bgs.push(path); }
        catch { break; }
      }
      setBackgroundImages(bgs);
    };
    discover();
  }, []);

  const handleClear = () => {
    if (window.confirm('Clear?')) {
      embeddingCache.clear(); summaryCache.clear();
      setFiles(prev => prev.map(f => ({ ...f, summaryStatus: 'missing', language: 'unknown' })));
      setChatHistory([...initialChatHistory, { role: 'model', content: 'Cleared.' }]);
    }
  };

  const handleShowSum = useCallback(async (f: AppFile) => {
    const cached = await summaryCache.get(f.id);
    if (cached?.summary) { setCurrentSummary(cached.summary); setSummaryFile(f); setIsSummaryModalOpen(true); return; }
    if (coordinator.current) setFiles(p => p.map(file => file.id === f.id ? { ...file, summaryStatus: 'in_progress' } : file));
  }, [coordinator, setFiles]);

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

  return (
    <div className='app-container'>
      <div className={`panel file-panel ${!showSettings ? 'settings-hidden' : ''}`}>
        <div className='file-panel-header'>
          <button className='button secondary' onClick={async () => {
            let h = rootDirectoryHandle;
            if (h && (await h.queryPermission()) !== 'granted') { await clearStoredDirectoryHandle(); h = null; setRootDirectoryHandle(null); }
            if (!h) try { h = await window.showDirectoryPicker(); if (h) { await storeDirectoryHandle(h); setRootDirectoryHandle(h); } } catch { /* ignore */ }
            if (h) setIsExplorerOpen(true);
          }}>Open Explorer</button>
          <button className='button secondary' onClick={() => setShowSettings(p => !p)}>Settings</button>
        </div>
        <Settings className={showSettings ? '' : 'hidden'} />
        <div className={`drag-drop-area glow-${glowType} ${isDragging ? 'dragging' : ''}`} onDrop={handleDropValidate} onDragOver={(e) => e.preventDefault()} onDragLeave={() => {}}>
          <SpeechBubble filesCount={files.length} isProcessing={activeJobCount > 0 || isLoading} isEmbedding={isEmbedding} />
          <RejectionBubble show={showRejectionBubble} />
          <FloatingArrows show={files.length === 0 && activeJobCount === 0 && !isLoading} />
          <DigestParticles isActive={isEmbedding || activeJobCount > 0} />
          {isLoading || activeJobCount > 0 ? <video src='/assets/thinking.mp4' autoPlay loop muted className="drop-media-element" /> : (showDropVideo ? <video ref={dropVideoRef} src={dropVideoSrc} onEnded={() => setShowDropVideo(false)} autoPlay muted className="drop-media-element" /> : <img src="/assets/drop.png" className="drop-media-element" />)}
        </div>
        <div className='flex gap-2'>
          <button className='button secondary' onClick={() => handleClearFiles(initialChatHistory)} disabled={files.length === 0 || isEmbedding}><Trash2 size={16} /></button>
          <button className='button secondary' onClick={handleClearConversation} disabled={chatHistory.length <= 1 || isLoading || isEmbedding}><X size={16} /></button>
          <button className='button secondary' onClick={handleClear}><RefreshCw size={16} /></button>
        </div>
        <div className='compute-status-indicator'>Compute: {computeDevice.toUpperCase()} ({mlWorkerCount} ML)</div>
        <div className='view-switcher'>
          <button className={viewMode === 'tree' ? 'active' : ''} onClick={() => setViewMode('tree')}><LayoutGrid size={16} /></button>
          <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}><ListIcon size={16} /></button>
        </div>
        <div className='panel-content file-list-container'>
          {files.length > 0 ? (viewMode === 'tree' ? <MemoizedFileTreeView tree={fileTree} onShowSummary={handleShowSum} /> : <MemoizedFileListView onShowSummary={handleShowSum} />) : <div className='placeholder-text'><FolderTree size={48} /></div>}
        </div>
      </div>
      <div className='panel chat-panel'>
        <div className='chat-panel-header'><div className='background-changer'><button className='background-btn' onClick={() => setAppSettings(p => ({...p, backgroundIndex: p.backgroundIndex === 0 ? backgroundImages.length : p.backgroundIndex - 1}))}><ChevronLeft size={16} /></button><button className='background-btn' onClick={() => setAppSettings(p => ({...p, backgroundIndex: (p.backgroundIndex + 1) % (backgroundImages.length + 1)}))}><ChevronRight size={16} /></button></div></div>
        <div className='panel-content' ref={chatHistoryRef} onClick={handleSourceClick} style={{ backgroundImage: backgroundImages[appSettings.backgroundIndex - 1] ? `url('${backgroundImages[appSettings.backgroundIndex - 1]}')` : 'none', backgroundSize: 'cover' }}>
          <div className='chat-history'>
            {chatHistory.map((msg, i) => (
              <div key={i} className={`message-container ${msg.role}`}>
                <div className={`chat-message ${msg.role} bubble-${appSettings.chatBubbleColor}`}>
                  <div className='avatar'>{msg.role === 'model' ? <Bot size={20} /> : <User size={20} />}</div>
                  <div className='message-content'>{msg.role === 'model' ? <div className='message-markup' dangerouslySetInnerHTML={renderModelMessage(msg.content)} /> : msg.content}</div>
                  <div className="message-actions">
                    <button onClick={() => handleCopy(i)}><Copy size={14} /></button>
                    <button onClick={() => handleDownloadAction(i)}><Download size={14} /></button>
                    {msg.role === 'user' && <button onClick={() => handleRedo(i)} disabled={isLoading || isEmbedding}><RefreshCw size={14} /></button>}
                    <button onClick={() => handleRemoveMessage(i)}><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            ))}
            {isLoading && <div className='chat-message model'>Thinking...</div>}
          </div>
        </div>
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
            <input type='text' className='chat-input' value={userInput} onChange={(e) => setUserInput(e.target.value)} disabled={isLoading || (files.length === 0 && !appSettings.isChatModeEnabled)} />
            <button type='submit' className='button' disabled={isLoading || !userInput.trim()}><Send size={16} /></button>
          </form>
          <div className="token-usage-display">Tokens: {tokenUsage.promptTokens + tokenUsage.completionTokens}</div>
          <div className='setting-row'><button onClick={() => setAppSettings(p => ({ ...p, isDeepAnalysisEnabled: !p.isDeepAnalysisEnabled }))} className={`toggle-button ${appSettings.isDeepAnalysisEnabled ? 'active' : ''}`}>Deep Analysis: {appSettings.isDeepAnalysisEnabled ? 'ON' : 'OFF'}</button></div>
        </div>
      </div>
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}><MemoizedDocViewer coordinator={coordinator.current} selectedFile={activeSource?.file ?? selectedFile} chunksToHighlight={activeSource?.chunks?.map(c => ({ start: c.start, end: c.end })) ?? []} docFontSize={docFontSize} setDocFontSize={setDocFontSize} /></Modal>
      <EmbeddingCacheModal isOpen={isCacheModalOpen} onClose={() => setIsCacheModalOpen(false)} />
      {summaryFile && <SummaryModal isOpen={isSummaryModalOpen} onClose={() => setIsSummaryModalOpen(false)} summary={currentSummary} fileName={summaryFile.name} />}
      <CustomFileExplorer isOpen={isExplorerOpen} onClose={() => setIsExplorerOpen(false)} rootDirectoryHandle={rootDirectoryHandle} onFilesSelected={async (items) => {
        const toAdd = await processExplorerItems(items);
        addFilesAndEmbed(toAdd); setIsExplorerOpen(false);
      }} />
      <RecoveryDialogContainer availableModels={modelsList} currentModel={selectedModel} apiKeys={apiKeys} onModelChange={(m: Model, k?: string) => { setSelectedModel(m); if (k) setApiKeys(prev => ({ ...prev, [m.provider]: k })); }} />
    </div>
  );
};
