import { useState, useRef, useEffect, FC, useCallback } from 'react';
import mammoth from 'mammoth'; // Import mammoth
import * as pdfjsLib from 'pdfjs-dist'; // Import pdfjsLib
import { TextItem } from 'pdfjs-dist/types/src/display/api'; // Import TextItem
import {
  getStoredDirectoryHandle,
  storeDirectoryHandle,
  clearStoredDirectoryHandle, // Also import clear for potential future use or debugging
} from './utils/db';
import {
  List as ListIcon,
  LayoutGrid,
  BrainCircuit,
  Bot,
  User,
  Trash2,
  Send,
  FolderTree,
  RefreshCw,
  X,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
} from 'lucide-react'
import { useSettingsState } from './hooks/useSettingsState'
import { useFileState } from './hooks/useFileState'
import { useCompute } from './hooks/useCompute'
import { useChat } from './hooks/useChat'
import { loadSettings, saveSettings, AppSettings } from './config'
import { AppFile, ViewMode, SearchResult } from './types'
import { embeddingCache } from './cache/embeddingCache'
import Settings from './components/Settings'
import CustomFileExplorer from './components/CustomFileExplorer'
import { getFileFromHandle } from './utils/fileExplorer'; // Import getFileFromHandle
import { generateFileId } from './utils/fileUtils';
import { createFileTasks } from './utils/taskFactory';
import MemoizedFileTreeView from './components/FileTreeView'
import MemoizedFileListView from './components/FileListView'
import MemoizedDocViewer from './components/DocViewer'
import Modal from './Modal'
import EmbeddingCacheModal from './components/EmbeddingCacheModal'
import SummaryModal from './components/SummaryModal'
import { summaryCache } from './cache/summaryCache'
import { SpeechBubble, DigestParticles, FloatingArrows, RejectionBubble } from './components/Monster'
import RecoveryDialogContainer from './components/RecoveryDialogContainer'
import './style.css'
import './progress-bar.css'
import './Modal.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

// eslint-disable-next-line react-refresh/only-export-components
export * from './types';
// eslint-disable-next-line react-refresh/only-export-components
export * from './config';
// eslint-disable-next-line react-refresh/only-export-components
export * from './utils/fileTree';

export const App: FC = () => {
  const [appSettings, setAppSettings] = useState<AppSettings>(loadSettings);
  // DIAGNOSTIC: Log the initial appSettings.isLoggingEnabled value
  useEffect(() => {
    console.log(`[App DIAGNOSTIC] Initial appSettings.isLoggingEnabled: ${appSettings.isLoggingEnabled}`);
  }, [appSettings.isLoggingEnabled]);

  const [isEmbedding, setIsEmbedding] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCacheModalOpen, setIsCacheModalOpen] = useState(false);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [currentSummary, setCurrentSummary] = useState('');
  const [summaryFile, setSummaryFile] = useState<AppFile | null>(null);
  const [activeSource, setActiveSource] = useState<{ file: AppFile, chunks: SearchResult[] } | null>(null);
  const [docFontSize, setDocFontSize] = useState(0.9);
  const [showSettings, setShowSettings] = useState(true); // New state for toggling settings visibility
  const [dropVideoSrc, setDropVideoSrc] = useState('');
  const [showDropVideo, setShowDropVideo] = useState(false);
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [rootDirectoryHandle, setRootDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [isProcessing, setIsProcessing] = useState(false); // New state for overall processing
  const [glowType, setGlowType] = useState<'default' | 'blue' | 'yellow' | 'green' | 'red'>('default');
  const [showRejectionBubble, setShowRejectionBubble] = useState(false);
  const [hasLLMResponded, setHasLLMResponded] = useState(false);
  const [backgroundImages, setBackgroundImages] = useState<string[]>([]);

  const {
    modelsList,
    setModelsList,
    selectedProvider,
    setSelectedProvider,
    selectedModel,
    setSelectedModel,
    apiKeys,
    setApiKeys,
  } = useSettingsState();

  const [files, setFiles] = useState<AppFile[]>([]);

  const {
    coordinator,
    vectorStore,
    queryEmbeddingResolver,
    rerankPromiseResolver,
    jobProgress,
    rerankProgress,
    setRerankProgress,
    jobTimers,
    setJobTimers,
    computeDevice,
    mlWorkerCount,
    activeJobCount,
    totalEmbeddingsCount,
  } = useCompute({ appSettings, files, setFiles, selectedModel, selectedProvider, apiKeys, docFontSize });

  const {
    userInput,
    setUserInput,
    chatHistory,
    setChatHistory,
    handleRedo,
    handleSubmit,
    handleSourceClick,
    renderModelMessage,
    handleClearConversation,
    handleRemoveMessage,
    initialChatHistory,
    pendingQuery,
    setPendingQuery,
    tokenUsage,
    setTokenUsage,
  } = useChat({
    appSettings,
    files,
    isLoading,
    isEmbedding,
    coordinator,
    vectorStore,
    queryEmbeddingResolver,
    rerankPromiseResolver,
    setRerankProgress,
    apiKeys,
    selectedProvider,
    selectedModel,
    setIsLoading,
    setActiveSource,
    setIsModalOpen,
    setSelectedFile: () => {},
  });

  const {
    fileTree,
    selectedFile,
    setSelectedFile,
    isDragging,
    handleFileSelect,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handleClearFiles,
    addFilesAndEmbed,
    handleRemoveFile,
  } = useFileState({
    appSettings,
    selectedModel,
    selectedProvider,
    apiKeys,
    docFontSize,
    setIsEmbedding,
    setChatHistory,
    setTokenUsage,
    setFiles,
    files,
    setJobTimers,
    coordinator,
    vectorStore,
    setDropVideoSrc,
    setShowDropVideo,
    resetLLMResponseState: () => setHasLLMResponded(false),
  });

  // Debug initial states
  useEffect(() => {
    console.log('[App] Initial state:', {
      glowType,
      filesCount: files.length,
      hasLLMResponded,
      chatHistoryLength: chatHistory.length
    });
  }, [glowType, files.length, hasLLMResponded, chatHistory.length]);


  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const dropVideoRef = useRef<HTMLVideoElement>(null);

  const getMessageTextContent = useCallback((index: number): string => {
    const container = chatHistoryRef.current?.querySelectorAll('.message-container')[index] as HTMLElement | undefined;
    if (!container) return '';
    const markupEl = container.querySelector('.message-markup') as HTMLElement | null;
    if (markupEl) {
      return markupEl.innerText || '';
    }
    const contentEl = container.querySelector('.message-content') as HTMLElement | null;
    return contentEl?.innerText || '';
  }, []);

  const handleCopyMessage = useCallback(async (index: number) => {
    const text = getMessageTextContent(index);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  }, [getMessageTextContent]);

  const handleDownloadMessage = useCallback(async (index: number) => {
    const text = getMessageTextContent(index);
    const defaultName = `message-${index + 1}.txt`;

    // Try File System Access API first
    const anyWindow = window as any;
    if (anyWindow.showSaveFilePicker) {
      try {
        const opts: any = {
          suggestedName: defaultName,
          types: [
            {
              description: 'Text File',
              accept: { 'text/plain': ['.txt'] },
            },
          ],
        };
        // Prefer starting in the last opened directory if available
        if (rootDirectoryHandle) {
          opts.startIn = rootDirectoryHandle as any;
        }
        const handle = await anyWindow.showSaveFilePicker(opts);
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        return;
      } catch (err) {
        // User might have cancelled; fall back to anchor method if different error
        if ((err as Error)?.name === 'AbortError') return;
        console.warn('showSaveFilePicker failed, falling back to anchor download:', err);
      }
    }

    // Fallback: trigger a download via anchor
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download message:', err);
    }
  }, [getMessageTextContent, rootDirectoryHandle]);

  useEffect(() => {
    saveSettings(appSettings);
    if (coordinator.current) {
      coordinator.current.setLogging(appSettings.isLoggingEnabled);
      coordinator.current.setMlWorkerCount(appSettings.numMlWorkers);
    }
  }, [appSettings, coordinator]);

  // Effect to load stored directory handle on component mount
  useEffect(() => {
    const loadHandle = async () => {
      try {
        const handle = await getStoredDirectoryHandle();
        if (handle) {
          // Check if permission is still valid
          const permissionStatus = await handle.queryPermission();
          if (permissionStatus === 'granted') {
            setRootDirectoryHandle(handle);
            console.log('[App] Loaded and validated stored directory handle.');
          } else {
            console.log('[App] Stored directory handle permission revoked or not granted.');
            // Optionally clear the stored handle if permission is no longer granted
            await clearStoredDirectoryHandle();
          }
        }
      } catch (error) {
        console.error('[App] Error loading stored directory handle:', error);
      }
    };
    loadHandle();
  }, []); // Run only once on mount

  useEffect(() => {
    const currentlyProcessing = activeJobCount > 0 || isLoading;
    setIsProcessing(currentlyProcessing);

    if (activeJobCount > 0) {
      setIsEmbedding(true);
    } else {
        if (isEmbedding) { // Only update if the state is changing from true to false
            setIsEmbedding(false);
            setChatHistory((prev) => {
                if (prev.length > 0 && prev[prev.length - 1].content.startsWith('Knowledge base updated')) {
                    return prev;
                }
                return [
                    ...prev,
                    {
                        role: 'model',
                        content: `Knowledge base updated. You can now ask questions about the new content.`,
                    },
                ];
            });
        }
    }
  }, [activeJobCount, isEmbedding, setChatHistory, isLoading]);

  // Glow state management - ensure glow is always present
  useEffect(() => {
    if (glowType === 'red') {
      // Don't override red glow (rejection state)
      return;
    }
    
    let newGlowType: 'default' | 'blue' | 'yellow' | 'green' | 'red';
    
    if (isLoading) {
      newGlowType = 'yellow';
    } else if (isEmbedding || activeJobCount > 0) {
      newGlowType = 'yellow';
    } else {
      // Determine idle glow color based on state
      if (files.length === 0) {
        // No files loaded - orange glow
        newGlowType = 'default';
      } else if (!hasLLMResponded) {
        // Files loaded but no LLM response yet - blue glow
        newGlowType = 'blue';
      } else {
        // Files loaded and LLM has responded - green glow
        newGlowType = 'green';
      }
    }
    
    if (newGlowType !== glowType) {
      console.log(`[App] Glow changing from ${glowType} to ${newGlowType}`, {
        filesCount: files.length,
        hasLLMResponded,
        isLoading,
        isEmbedding,
        activeJobCount
      });
      setGlowType(newGlowType);
    }
  }, [isLoading, isEmbedding, activeJobCount, files.length, hasLLMResponded, glowType]);

  // Track when LLM first responds to USER QUERIES (not background processing)
  useEffect(() => {
    if (chatHistory.length > 1) { // Must have more than just the initial welcome message
      const lastMessage = chatHistory[chatHistory.length - 1];
      
      // Only count model responses that are actual answers to user queries
      // This should be a response that comes after a user message
      const isUserInitiatedResponse = chatHistory.length >= 2 && 
                                      chatHistory[chatHistory.length - 2].role === 'user';
      
      // Exclude the initial welcome message by checking if it's the first message
      const isInitialWelcome = chatHistory.length === 1 && 
                              lastMessage.content.includes('Drop your files or a project folder');
      
      if (lastMessage.role === 'model' && 
          !isLoading && 
          !isEmbedding &&
          !isInitialWelcome &&
          isUserInitiatedResponse &&
          // Additional safety: exclude common system messages
          !lastMessage.content.includes('Loading') &&
          !lastMessage.content.includes('Adding') &&
          !lastMessage.content.includes('Knowledge base updated') &&
          !lastMessage.content.includes('Processing files') &&
          !lastMessage.content.includes('Embedding') &&
          !lastMessage.content.includes('cleared') &&
          !lastMessage.content.includes('queued')) {
        
        // Mark that LLM has responded to user query
        if (!hasLLMResponded) {
          setHasLLMResponded(true);
          console.log('[App] First USER-initiated LLM response detected, switching to green glow');
        }
        
        // Show green glow for response
        setGlowType('green');
      }
    }
  }, [chatHistory, isLoading, isEmbedding, hasLLMResponded]);

  useEffect(() => {
    if (!isEmbedding && pendingQuery) {
      handleSubmit({ preventDefault: () => {} } as React.FormEvent);
      setPendingQuery(null);
    }
  }, [isEmbedding, pendingQuery, handleSubmit, setPendingQuery]);

  useEffect(() => {
    const hasActiveJobs = Object.values(jobTimers).some(timer => timer.isActive);

    if (hasActiveJobs && !timerIntervalRef.current) {
      timerIntervalRef.current = window.setInterval(() => {
        setJobTimers(prev => {
          const newTimers = { ...prev };
          let needsUpdate = false;
          for (const jobName in newTimers) {
            if (newTimers[jobName].isActive) {
              newTimers[jobName] = {
                ...newTimers[jobName],
                elapsed: Date.now() - newTimers[jobName].startTime,
              };
              needsUpdate = true;
            }
          }
          return needsUpdate ? newTimers : prev;
        });
      }, 100);
    } else if (!hasActiveJobs && timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [jobTimers, setJobTimers]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Discover available background images
  useEffect(() => {
    const discoverBackgrounds = async () => {
      const backgrounds: string[] = [];
      
      // Check for background images up to a reasonable limit
      for (let index = 1; index <= 20; index++) {
        const imagePath = `/assets/background${index}.png`;
        try {
          // Create image element to test if it loads
          await new Promise<void>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => reject();
            img.src = imagePath;
          });
          backgrounds.push(imagePath);
        } catch {
          // If image fails to load, we've likely reached the end
          break;
        }
      }
      
      setBackgroundImages(backgrounds);
    };
    
    discoverBackgrounds();
  }, []);

  // Background cycling functions
  const nextBackground = useCallback(() => {
    if (backgroundImages.length === 0) return;
    const newIndex = (appSettings.backgroundIndex + 1) % (backgroundImages.length + 1); // +1 for "no background"
    setAppSettings(prev => ({ ...prev, backgroundIndex: newIndex }));
  }, [backgroundImages.length, appSettings.backgroundIndex, setAppSettings]);

  const prevBackground = useCallback(() => {
    if (backgroundImages.length === 0) return;
    const newIndex = appSettings.backgroundIndex === 0 ? backgroundImages.length : appSettings.backgroundIndex - 1;
    setAppSettings(prev => ({ ...prev, backgroundIndex: newIndex }));
  }, [backgroundImages.length, appSettings.backgroundIndex, setAppSettings]);

  const getCurrentBackground = useCallback(() => {
    if (backgroundImages.length === 0 || appSettings.backgroundIndex === 0) {
      return null; // No background (default dark)
    }
    return backgroundImages[appSettings.backgroundIndex - 1];
  }, [backgroundImages, appSettings.backgroundIndex]);


  const handleClearEmbeddings = () => {
    if (window.confirm('Are you sure you want to clear the embedding cache? This will also clear the summary cache.')) {
      embeddingCache.clear();
      summaryCache.clear();
      setFiles(prevFiles =>
        prevFiles.map(file => ({
          ...file,
          summaryStatus: 'missing',
          language: 'unknown',
        }))
      );
      setChatHistory(prev => [...prev, { role: 'model', content: 'Embedding and summary caches cleared.' }]);
    }
  };

  const handleShowSummary = useCallback(async (file: AppFile) => {
    console.log(`[App] handleShowSummary called for ${file.id} (path: ${file.path}). Status: ${file.summaryStatus}`);

    // 1) If cached summary exists, show it regardless of status
    const cachedSummary = await summaryCache.get(file.id);
    if (cachedSummary && cachedSummary.summary) {
      console.log(`[App] Cached summary found for ${file.id}. Opening modal.`);
      setCurrentSummary(cachedSummary.summary);
      setSummaryFile(file);
      setIsSummaryModalOpen(true);
      return;
    }

    // 2) If not cached, trigger generation if possible
    if (coordinator.current) {
      console.log(`[App] No cached summary for ${file.id}. Queuing summary generation job...`);
      setFiles((prev) => prev.map(f => f.id === file.id ? { ...f, summaryStatus: 'in_progress' } : f));
      try {
        const tasks = await createFileTasks(file, 'summary', coordinator.current, docFontSize, selectedModel, selectedProvider, apiKeys, appSettings);
        coordinator.current.addJob(`Summary: ${file.id}`, tasks);
        setChatHistory((prev) => [...prev, { role: 'model', content: `Generating summary for ${file.name}...` }]);
      } catch (e) {
        console.error('[App] Failed to queue summary tasks:', e);
      }
    } else {
      console.warn('[App] Coordinator not ready; cannot queue summary job.');
    }
  }, [coordinator, setFiles, docFontSize, selectedModel, selectedProvider, apiKeys, appSettings, setChatHistory, setCurrentSummary, setSummaryFile, setIsSummaryModalOpen]);

  const handleTreeViewFileSelect = useCallback((file: AppFile) => {
    setSelectedFile(file);
    setActiveSource(null);
  }, [setSelectedFile, setActiveSource]);
  const handleToggleLogging = useCallback(() => {
    setAppSettings(prev => ({ ...prev, isLoggingEnabled: !prev.isLoggingEnabled }));
  }, [setAppSettings]);

  const handleIncrementMlWorkers = useCallback(() => {
    setAppSettings(prev => ({ ...prev, numMlWorkers: prev.numMlWorkers + 1 }));
  }, [setAppSettings]);

  const handleDecrementMlWorkers = useCallback(() => {
    setAppSettings(prev => ({ ...prev, numMlWorkers: Math.max(2, prev.numMlWorkers - 1) }));
  }, [setAppSettings]);

  const handleIncrementInitialCandidates = useCallback(() => {
    setAppSettings(prev => ({ ...prev, numInitialCandidates: prev.numInitialCandidates + 5 }));
  }, [setAppSettings]);

  const handleDecrementInitialCandidates = useCallback(() => {
    setAppSettings(prev => {
      const newInitialCandidates = Math.max(1, prev.numInitialCandidates - 5); // Ensure it doesn't go below 1
      let newFinalContextChunks = prev.numFinalContextChunks;

      if (newFinalContextChunks > newInitialCandidates) {
        newFinalContextChunks = newInitialCandidates;
      }

      return {
        ...prev,
        numInitialCandidates: newInitialCandidates,
        numFinalContextChunks: newFinalContextChunks,
      };
    });
  }, [setAppSettings]);

  const handleIncrementFinalContextChunks = useCallback(() => {
    setAppSettings(prev => ({ ...prev, numFinalContextChunks: prev.numFinalContextChunks + 1 }));
  }, [setAppSettings]);

  const handleDecrementFinalContextChunks = useCallback(() => {
    setAppSettings(prev => ({ ...prev, numFinalContextChunks: Math.max(1, prev.numFinalContextChunks - 1) }));
  }, [setAppSettings]);

  const handleToggleReranking = useCallback(() => {
    setAppSettings(prev => ({ ...prev, isRerankingEnabled: !prev.isRerankingEnabled }));
  }, [setAppSettings]);

  // Monster-related functions
  const getMonsterState = () => {
    if (files.length > 10) return 'fully_eaten';
    if (files.length > 5) return 'half_full';
    return 'default';
  };

  const getMonsterImage = () => {
    const state = getMonsterState();
    if (state === 'fully_eaten') {
      // Try fully_eaten.png, fallback to half_full.png if it doesn't exist
      return "/assets/fully_eaten.png";
    }
    if (state === 'half_full') return "/assets/half_full.png";
    return "/assets/drop.png";
  };

  const getIdleVideo = () => {
    const state = getMonsterState();
    if (state === 'fully_eaten') return '/assets/idle_fully_eaten.mp4';
    if (state === 'half_full') return '/assets/idle_half_full.mp4';
    return '/assets/idle.mp4';
  };

  const getThinkingVideo = () => {
    const state = getMonsterState();
    if (state === 'fully_eaten') return '/assets/thinking_fully_eaten.mp4';
    if (state === 'half_full') return '/assets/thinking_half_full.mp4';
    return '/assets/thinking.mp4';
  };

  const getRejectedVideo = () => {
    const state = getMonsterState();
    if (state === 'fully_eaten') return '/assets/drop_NOT_accepted_fully_eaten.mp4';
    if (state === 'half_full') return '/assets/drop_NOT_accepted_half_full.mp4';
    return '/assets/drop_NOT_accepted.mp4';
  };

  const createRipple = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;
    
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    ripple.classList.add('ripple');
    
    e.currentTarget.appendChild(ripple);
    
    setTimeout(() => ripple.remove(), 800);
  };

  // Enhanced handleDrop with ripple effect (removing unused handleDropWithRipple)
  // const handleDropWithRipple = (e: React.DragEvent) => {
  //   createRipple(e);
  //   handleDrop(e, addFilesAndEmbed);
  // };

  // Check for unsupported files and show rejection video
  const handleDropWithValidation = (e: React.DragEvent) => {
    e.preventDefault();

    const items = Array.from(e.dataTransfer.items);
    const containsFolder = items.some(item => item.webkitGetAsEntry()?.isDirectory);

    if (!containsFolder) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      const unsupportedFiles = droppedFiles.filter(file => {
        const ext = file.name.toLowerCase().split('.').pop();
        return !['pdf', 'txt', 'md', 'docx', 'doc', 'json', 'csv', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'html', 'css', 'xml', 'yaml', 'yml'].includes(ext || '');
      });

      if (unsupportedFiles.length > 0) {
        setGlowType('red');
      setShowRejectionBubble(true);
      setDropVideoSrc(getRejectedVideo());
      setShowDropVideo(true);
      console.warn(`Unsupported file types dropped: ${unsupportedFiles.map(f => f.name).join(', ')}`);
      
      // Create video element to get duration
      const video = document.createElement('video');
      video.src = getRejectedVideo();
      video.onloadedmetadata = () => {
        const duration = video.duration * 1000; // Convert to milliseconds
        const glowDuration = duration > 0 ? duration : 5000; // Fallback to 5 seconds
        
        // Reset red glow and rejection bubble after video duration
        setTimeout(() => {
          setGlowType('default');
          setShowRejectionBubble(false);
        }, glowDuration);
      };
      
      // Fallback timeout in case video metadata doesn't load
      setTimeout(() => {
        if (glowType === 'red') {
          setGlowType('default');
          setShowRejectionBubble(false);
        }
      }, 5000);
      
        return;
      }
    }
    
    // If all files are supported, or if a folder is dropped, create ripple and proceed
    createRipple(e);
    handleDrop(e as React.DragEvent<HTMLDivElement>);
  };

  return (
    <div className='app-container'>
      <div className={`panel file-panel ${!showSettings ? 'settings-hidden' : ''}`}>
        {/* Move buttons and settings to the top */}
        <div className='file-panel-header'>
          <button
            className='button secondary'
            onClick={async () => {
              console.log('[App] "Open File Explorer" button clicked.');
              if (rootDirectoryHandle) {
                // If a handle is already stored and valid, use it directly
                const permissionStatus = await rootDirectoryHandle.queryPermission();
                if (permissionStatus === 'granted') {
                  setIsExplorerOpen(true);
                  console.log('[App] Opening custom file explorer with stored handle.');
                  return;
                } else {
                  console.log('[App] Stored handle permission revoked, re-requesting.');
                  await clearStoredDirectoryHandle(); // Clear invalid handle
                  setRootDirectoryHandle(null); // Reset state
                }
              }

              // If no handle or permission revoked, open native picker
              console.log('[App] Attempting to open native directory picker...');
              try {
                const handle = await window.showDirectoryPicker();
                console.log('[App] Native directory picker returned handle:', handle?.name);
                if (handle) {
                  await storeDirectoryHandle(handle);
                  setRootDirectoryHandle(handle);
                  setIsExplorerOpen(true);
                  console.log('[App] Native directory picker opened, handle stored, opening custom explorer. rootDirectoryHandle state:', handle.name);
                } else {
                  console.log('[App] Native directory picker returned null/undefined handle.');
                }
              } catch (error) {
                console.error('[App] ERROR: Native directory picker failed or was cancelled:', error);
                // User cancelled the picker, or an error occurred.
                // Do not open the custom explorer if no handle was selected.
              }
            }}
            title="Open custom file explorer"
          >
            Open File Explorer
          </button>

          <button
            className='button secondary'
            onClick={() => setShowSettings(prev => !prev)}
            title="Toggle settings panel visibility"
          >
            Toggle Settings
          </button>
        </div>

        {/* Settings panel */}
        <Settings
          className={showSettings ? '' : 'hidden'}
          modelsList={modelsList}
          setModelsList={setModelsList}
          selectedProvider={selectedProvider}
          setSelectedProvider={setSelectedProvider}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          apiKeys={apiKeys}
          setApiKeys={setApiKeys}
          appSettings={appSettings}
          setAppSettings={setAppSettings}
          totalEmbeddingsCount={totalEmbeddingsCount}
          handleIncrementMlWorkers={handleIncrementMlWorkers}
          handleDecrementMlWorkers={handleDecrementMlWorkers}
          handleIncrementInitialCandidates={handleIncrementInitialCandidates}
          handleDecrementInitialCandidates={handleDecrementInitialCandidates}
          handleIncrementFinalContextChunks={handleIncrementFinalContextChunks}
          handleDecrementFinalContextChunks={handleDecrementFinalContextChunks}
          handleToggleReranking={handleToggleReranking}
          handleToggleLogging={handleToggleLogging}
        />

        {/* Drop zone moved below buttons and settings */}
        <div
          className={`drag-drop-area glow-${glowType} ${isDragging ? 'dragging' : ''}`}
          onDrop={handleDropWithValidation}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {/* Speech bubble positioned relative to drop zone */}
          <SpeechBubble 
            filesCount={files.length}
            isProcessing={isProcessing}
            isEmbedding={isEmbedding}
          />
          <RejectionBubble show={showRejectionBubble} />
          <FloatingArrows show={files.length === 0 && !isProcessing} />
          <DigestParticles isActive={isEmbedding || activeJobCount > 0} />
          {isProcessing ? (
            <video
              ref={dropVideoRef}
              src={getThinkingVideo()}
              autoPlay
              loop
              muted
              className="drop-video drop-media-element"
              onError={(e) => {
                console.error('Thinking video loading error:', e);
                // Fallback to drop.png if thinking video fails to load
                setIsProcessing(false);
                console.log(`[App] Error loading thinking video: ${getThinkingVideo()}`);
              }}
            />
          ) : (
            <>
              {!showDropVideo && (
                <>
                  {/* Try to show idle video first, fallback to image */}
                  <video
                    key={`${getIdleVideo()}-${getMonsterState()}`} // Force re-render when state changes
                    src={getIdleVideo()}
                    autoPlay
                    loop
                    muted
                    className="drop-media-element idle-video"
                    onError={(e) => {
                      console.log(`[App] Idle video failed: ${getIdleVideo()}, showing fallback image`);
                      (e.target as HTMLVideoElement).style.display = 'none';
                      // Show the fallback image
                      const imgElement = (e.target as HTMLVideoElement).parentElement?.querySelector('.fallback-image') as HTMLImageElement;
                      if (imgElement) {
                        imgElement.style.display = 'block';
                      }
                    }}
                    onCanPlay={(e) => {
                      console.log(`[App] Idle video loaded successfully: ${getIdleVideo()}`);
                      // Hide fallback image when video loads
                      const imgElement = (e.target as HTMLVideoElement).parentElement?.querySelector('.fallback-image') as HTMLImageElement;
                      if (imgElement) {
                        imgElement.style.display = 'none';
                      }
                    }}
                    onLoadStart={() => {
                      // Start with video visible, fallback image hidden
                      const imgElement = document.querySelector('.fallback-image') as HTMLImageElement;
                      if (imgElement) {
                        imgElement.style.display = 'none';
                      }
                    }}
                  />
                  {/* Fallback image */}
                  <img
                    src={getMonsterImage()}
                    alt="Drop files here"
                    className="drop-media-element fallback-image"
                    style={{ display: 'block' }} // Show by default, hide if video loads
                    onLoad={() => {
                      // Check if video loaded, if so hide this image
                      const videoElement = document.querySelector('.idle-video') as HTMLVideoElement;
                      if (videoElement && videoElement.readyState >= 2) {
                        const imgElement = document.querySelector('.fallback-image') as HTMLImageElement;
                        if (imgElement) {
                          imgElement.style.display = 'none';
                        }
                      }
                    }}
                    onError={(e) => {
                      console.error('Fallback image loading error:', e);
                      const img = e.target as HTMLImageElement;
                      // Fallback logic: if fully_eaten.png fails, try half_full.png, then drop.png
                      if (img.src.includes('fully_eaten.png')) {
                        console.log('[App] fully_eaten.png failed, falling back to half_full.png');
                        img.src = '/assets/half_full.png';
                      } else if (img.src.includes('half_full.png')) {
                        console.log('[App] half_full.png failed, falling back to drop.png');
                        img.src = '/assets/drop.png';
                      } else {
                        console.log('[App] All monster images failed, hiding image');
                        img.style.display = 'none';
                      }
                    }}
                  />
                </>
              )}
              {showDropVideo && (
                <video
                  ref={dropVideoRef}
                  src={dropVideoSrc}
                  onEnded={() => setShowDropVideo(false)}
                  onError={(e) => {
                    console.error('Video loading error:', e);
                    setShowDropVideo(false); // Hide video on error
                    console.log(`[App] Error loading video: ${dropVideoSrc}`);
                  }}
                  autoPlay
                  muted
                  className="drop-video drop-media-element"
                />
              )}
            </>
          )}
        </div>
        
        {/* File input for legacy file selection */}
        <input
          ref={fileInputRef}
          type='file'
          {...{ webkitdirectory: 'true', directory: 'true' }}
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        {/* Action buttons */}
        <div className='flex gap-2'>
          <button
            className='button secondary'
            onClick={() => handleClearFiles(initialChatHistory)}
            disabled={files.length === 0 || isEmbedding}
            title="Clear all loaded files and conversation history."
          >
            <Trash2 size={16} /> Clear All
          </button>
          <button
            className='button secondary'
            onClick={handleClearConversation}
            disabled={chatHistory.length <= 1 || isLoading || isEmbedding}
            title="Clear the current conversation."
          >
            <X size={16} /> Clear Chat
          </button>
          <button
            className='button secondary'
            onClick={handleClearEmbeddings}
            title="Clear the embedding cache."
          >
            <Trash2 size={16} /> Clear Embeddings
          </button>
          <button
            className='button secondary'
            onClick={() => setIsCacheModalOpen(true)}
            title="Clear selected embeddings from the cache."
          >
            <Trash2 size={16} /> Clear embeddings...
          </button>
        </div>

        <div className='compute-status-indicator'>
          Compute: <span className={`status-${computeDevice}`}>{computeDevice.toUpperCase()}</span>
          <span className='status-cpu ml-worker-count'>({mlWorkerCount} ML)</span>
        </div>

        {isEmbedding && (
          <div className='embedding-status'>
            <BrainCircuit size={16} className='animate-pulse' />
            <span>Processing files in background...</span>
          </div>
        )}

        {rerankProgress && rerankProgress.progress < rerankProgress.total && (
          <div className='embedding-status'>
            <BrainCircuit size={16} className='animate-pulse' />
            <span>Reranking: {rerankProgress.progress} / {rerankProgress.total}</span>
            <div className="progress-bar-container">
              <progress value={rerankProgress.progress} max={rerankProgress.total}></progress>
            </div>
          </div>
        )}

        <div className='view-switcher'>
          <button
            className={viewMode === 'tree' ? 'active' : ''}
            onClick={() => setViewMode('tree')}
          >
            <LayoutGrid size={16} /> Tree
          </button>
          <button
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
          >
            <ListIcon size={16} /> List
          </button>
        </div>
        <div className='panel-content file-list-container'>
          {files.length > 0 ? (
            viewMode === 'tree' ? (
              <MemoizedFileTreeView
                tree={fileTree}
                selectedFile={selectedFile}
                onSelectFile={handleTreeViewFileSelect}
                jobProgress={jobProgress}
                jobTimers={jobTimers}
                onRemoveFile={handleRemoveFile}
                onShowSummary={handleShowSummary}
              />
            ) : (
              <MemoizedFileListView
                files={files}
                selectedFile={selectedFile}
                onSelectFile={handleTreeViewFileSelect}
                jobProgress={jobProgress}
                jobTimers={jobTimers}
                onRemoveFile={handleRemoveFile}
                onShowSummary={handleShowSummary}
              />
            )
          ) : (
            <div className='placeholder-text'>
              <FolderTree size={48} />
              <p>No files loaded.</p>
            </div>
          )}
        </div>
      </div>

      <div className='panel chat-panel'>
        <div className='chat-panel-header'>
          <div className='background-changer'>
            <button
              className='background-btn'
              onClick={prevBackground}
              disabled={backgroundImages.length === 0}
              title='Previous background'
            >
              <ChevronLeft size={16} />
            </button>
            <span className='background-label'>Change Background</span>
            <button
              className='background-btn'
              onClick={nextBackground}
              disabled={backgroundImages.length === 0}
              title='Next background'
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div
          className='panel-content'
          ref={chatHistoryRef}
          onClick={handleSourceClick}
          style={{
            backgroundImage: getCurrentBackground() ? `url('${getCurrentBackground()}')` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        >
          <div className='chat-history'>
            {chatHistory.map((msg, index) => (
              <div key={index} className={`message-container message-slide-in ${msg.role}`}>
                {msg.tokenUsage && (
                  <div className="message-meta">
                    <div className="timer-display">
                      Elapsed: {((msg.elapsedTime ?? 0) / 1000).toFixed(2)}s
                    </div>
                    <div className="token-usage-display-message">
                      <span>Prompt: {msg.tokenUsage.promptTokens}</span>
                      <span>|</span>
                      <span>Completion: {msg.tokenUsage.completionTokens}</span>
                      <span>|</span>
                      <span>Total: {msg.tokenUsage.promptTokens + msg.tokenUsage.completionTokens}</span>
                    </div>
                  </div>
                )}
                <div className={`chat-message ${msg.role} bubble-${appSettings.chatBubbleColor}`}>
                  <div className='avatar'>
                    {msg.role === 'model' ? (
                      <Bot size={20} />
                    ) : (
                      <User size={20} />
                    )}
                  </div>
                  <div className='message-content'>
                    {msg.role === 'model' ? (
                      <div
                        className='message-markup'
                        dangerouslySetInnerHTML={renderModelMessage(msg.content)}
                      />
                    ) : (
                      msg.content
                    )}
                  </div>
                  <div className="message-actions">
                    <button onClick={() => handleCopyMessage(index)} title="Copy message to clipboard" className="message-action-button">
                      <Copy size={14} />
                    </button>
                    <button onClick={() => handleDownloadMessage(index)} title="Download message as .txt" className="message-action-button">
                      <Download size={14} />
                    </button>
                    {msg.role === 'user' && (
                      <button onClick={() => handleRedo(index)} title="Redo query" className="message-action-button" disabled={isLoading || isEmbedding}>
                        <RefreshCw size={14} />
                      </button>
                    )}
                    <button onClick={() => handleRemoveMessage(index)} title="Remove message" className="message-action-button">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className={`chat-message model message-slide-in bubble-${appSettings.chatBubbleColor}`}>
                <div className='avatar'>
                  <BrainCircuit size={20} className='animate-pulse' />
                </div>
                <div className='message-content'>
                  <div className="typing-indicator">
                    <span>Thinking</span>
                    <div className="typing-dots">
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className='chat-input-area'>
          <form className='chat-input-form' onSubmit={handleSubmit}>
            <input
              type='text'
              className='chat-input'
              placeholder={
                isEmbedding
                  ? 'Processing files...'
                  : files.length > 0
                  ? 'Ask about your documents...'
                  : 'Load documents to begin chat'
              }
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              disabled={isLoading || files.length === 0}
            />
            <button
              type='submit'
              className='button'
              disabled={isLoading || !userInput.trim()}
            >
              <Send size={16} />
            </button>
          </form>
          <div className="token-usage-display">
            <span>Prompt: {tokenUsage.promptTokens.toLocaleString()}</span>
            <span>|</span>
            <span>Completion: {tokenUsage.completionTokens.toLocaleString()}</span>
            <span>|</span>
            <span>Total: {(tokenUsage.promptTokens + tokenUsage.completionTokens).toLocaleString()}</span>
          </div>
          <div className='setting-row deep-analysis-toggle'>
            <label htmlFor='deep-analysis-toggle'>Deep Analysis:</label>
            <button
              id='deep-analysis-toggle'
              onClick={() => setAppSettings(prev => ({ ...prev, isDeepAnalysisEnabled: !prev.isDeepAnalysisEnabled }))}
              className={`toggle-button ${appSettings.isDeepAnalysisEnabled ? 'active' : ''}`}
              title="Toggle Deep Analysis mode. When enabled, the agent will generate and search for sub-questions to provide a more comprehensive answer."
            >
              {appSettings.isDeepAnalysisEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <MemoizedDocViewer
          coordinator={coordinator.current}
          selectedFile={activeSource?.file ?? selectedFile}
          chunksToHighlight={activeSource?.chunks?.map(c => ({ start: c.start, end: c.end })) ?? []}
          docFontSize={docFontSize}
          setDocFontSize={setDocFontSize}
          appSettings={appSettings} // Pass appSettings to DocViewer
        />
      </Modal>
      <EmbeddingCacheModal isOpen={isCacheModalOpen} onClose={() => setIsCacheModalOpen(false)} />
      {summaryFile && (
        <SummaryModal
            isOpen={isSummaryModalOpen}
            onClose={() => setIsSummaryModalOpen(false)}
            summary={currentSummary}
            fileName={summaryFile.name}
        />
      )}
      <CustomFileExplorer
        isOpen={isExplorerOpen}
        onClose={() => setIsExplorerOpen(false)}
        rootDirectoryHandle={rootDirectoryHandle} // Pass the root handle
        onFilesSelected={async (items) => {
          const filesToEmbed: AppFile[] = [];
          for (const item of items) {
            if (item.kind === 'file' && item.fileHandle) {
              const file = await getFileFromHandle(item.fileHandle);
              if (file) {
                let content = '';
                if (file.name.endsWith('.docx')) {
                  const arrayBuffer = await file.arrayBuffer();
                  const result = await mammoth.extractRawText({ arrayBuffer });
                  content = result.value;
                } else if (file.name.endsWith('.pdf')) {
                  const arrayBuffer = await file.arrayBuffer();
                  const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
                  for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    content += textContent.items.map(item => (item as TextItem).str).join(' ');
                  }
                } else if (file.size < 5 * 1024 * 1024) { // Limit file size for direct text reading
                  try {
                    content = await file.text();
                  } catch (e) {
                    console.warn(`Could not read file ${item.path} as text, skipping content.`, e);
                  }
                } else {
                  console.log(`Skipping large file content read for: ${item.name}`);
                }

                filesToEmbed.push({
                  id: generateFileId({ path: item.path, name: item.name, size: file.size, lastModified: file.lastModified }),
                  path: item.path,
                  name: item.name,
                  content: content,
                  lastModified: file.lastModified,
                  size: file.size,
                  summaryStatus: 'missing',
                  language: 'unknown',
                  layoutStatus: 'pending',
                } as AppFile);
              } else {
                console.warn(`Could not get file object from handle for ${item.name}. Skipping.`);
              }
            }
          }
          addFilesAndEmbed(filesToEmbed);
          setIsExplorerOpen(false);
        }}
      />
      
      {/* API Recovery Dialog */}
      <RecoveryDialogContainer
        availableModels={modelsList}
        currentModel={selectedModel}
        apiKeys={apiKeys}
        onModelChange={(model, apiKey) => {
          setSelectedModel(model);
          if (apiKey) {
            setApiKeys(prev => ({ ...prev, [model.provider]: apiKey }));
          }
        }}
      />
    </div>
  )
}
