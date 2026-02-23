import { useState, useRef, useEffect, FC, useCallback } from 'react';
import { getStoredDirectoryHandle, storeDirectoryHandle, clearStoredDirectoryHandle } from './utils/db';
import { Trash2, X, RefreshCw, LayoutGrid, List as ListIcon, FolderTree, ChevronLeft, ChevronRight, User, Bot, Send, Copy, Download, Info, Square, Edit2, Check, XCircle, RotateCcw } from 'lucide-react';
import { useFileState, useCompute, useChat } from './hooks';
import { AppFile, ViewMode, SearchResult, Model } from './types';
import { embeddingCache } from './cache/embeddingCache';
import { summaryCache } from './cache/summaryCache';
import Settings from './components/Settings';
import CustomFileExplorer from './components/CustomFileExplorer';
import { downloadMessage, processExplorerItems } from './utils/appActions';
import MemoizedFileTreeView from './components/FileTreeView';
import MemoizedFileListView from './components/FileListView';
import MemoizedDocViewer from './components/DocViewer';
import Modal from './Modal';
import EmbeddingCacheModal from './components/EmbeddingCacheModal';
import SummaryModal from './components/SummaryModal';
import { SpeechBubble, DigestParticles, FloatingArrows, RejectionBubble } from './components/Monster';
import RecoveryDialogContainer from './components/RecoveryDialogContainer';
import { useSettingsStore, useFileStore, useComputeStore } from './store';
import { createFuzzyRegex, sectionizeMessage, findExactMatchLenient, isMarkdownTable, parseMarkdownTable, generateMarkdownTable } from './utils/chatUtils';
import './style.css';
import './progress-bar.css';
import './Modal.css';

const DownloadReportButton: FC<{ content: string; index: number; rootDirectoryHandle: FileSystemDirectoryHandle | null }> = ({ content, index, rootDirectoryHandle }) => {
  const [format, setFormat] = useState<'txt' | 'md' | 'docx'>('md');
  const [isSaving, setIsSaving] = useState(false);

  const handleDownload = async () => {
    setIsSaving(true);
    try {
      // Stripping internal RAG metadata if any
      const cleanContent = content.replace(/<!--searchResults:(.*?)-->/, '');
      await downloadMessage(cleanContent, index, rootDirectoryHandle, format);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="download-report-container">
      <div className="format-selector">
        <button className={`format-option ${format === 'txt' ? 'active' : ''}`} onClick={() => setFormat('txt')}>.TXT</button>
        <button className={`format-option ${format === 'md' ? 'active' : ''}`} onClick={() => setFormat('md')}>.MD</button>
        <button className={`format-option ${format === 'docx' ? 'active' : ''}`} onClick={() => setFormat('docx')}>.DOCX</button>
      </div>
      <button className="download-report-btn" onClick={handleDownload} disabled={isSaving}>
        <Download size={16} />
        {isSaving ? 'Saving...' : 'Download Report File'}
      </button>
    </div>
  );
};

export const App: FC = () => {
  const { appSettings, setAppSettings, modelsList, selectedModel, setSelectedModel, apiKeys, setApiKeys } = useSettingsStore();
  const { files, setFiles, fileTree, selectedFile, isDragging } = useFileStore();
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

  const {
    userInput, setUserInput,
    chatHistory, setChatHistory,
    undo, historyStack,
    tokenUsage, setTokenUsage,
    currentContextTokens,
    isLoading,
    submitQuery,
    handleRedo, handleSubmit, handleSourceClick, renderModelMessage,
    stopGeneration,
    handleClearConversation, handleRemoveMessage,
    handleUpdateMessage, handleTruncateHistory,
    initialChatHistory,
    caseFileState, setCaseFileState,
    resendWithComments,
    hoveredSelectionId, setHoveredSelectionId
  } = useChat({
    coordinator, vectorStore, queryEmbeddingResolver, rerankPromiseResolver, setRerankProgress: () => { }, setActiveSource, setIsModalOpen
  });

  const [activeCommentInput, setActiveCommentInput] = useState<{ msgIndex: number, sectionId: string } | null>(null);
  const [commentText, setCommentText] = useState('');
  const [selectionPopover, setSelectionPopover] = useState<{
    top: number;
    left: number;
    text: string;
    msgIndex: number;
    sectionId: string;
  } | null>(null);

  const handleMouseUp = (msgIndex: number) => () => {
    if (msgIndex !== chatHistory.length - 1) return;

    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Find the parent message-section to get its ID
      let node = range.commonAncestorContainer as Node | null;
      while (node && !(node instanceof HTMLElement && node.classList.contains('message-section-wrapper'))) {
        node = node.parentNode;
      }

      let sectionId = 'sec-0'; // Fallback

      // Better way: find the closest row and its key
      let row = range.commonAncestorContainer as Node | null;
      while (row && !(row instanceof HTMLElement && row.getAttribute('data-section-id'))) {
        row = row.parentNode;
      }

      if (row instanceof HTMLElement) {
        sectionId = row.getAttribute('data-section-id') || 'sec-0';
      }

      // Extract text, preserving table structure if applicable
      let extractedText = selection.toString().trim();
      try {
        const container = document.createElement('div');
        container.appendChild(range.cloneContents());

        // If selection contains table elements, try to format as markdown table
        if (container.querySelector('td') || container.querySelector('th')) {
          const rows = container.querySelectorAll('tr');
          if (rows.length > 0) {
            extractedText = Array.from(rows).map(tr => {
              const cells = tr.querySelectorAll('td, th');
              return '| ' + Array.from(cells).map(c => (c.textContent || '').trim().replace(/\\n/g, ' ')).join(' | ') + ' |';
            }).join('\\n');
          } else {
            // Partial row selection
            const cells = container.querySelectorAll('td, th');
            if (cells.length > 0) {
              extractedText = '| ' + Array.from(cells).map(c => (c.textContent || '').trim().replace(/\\n/g, ' ')).join(' | ') + ' |';
            }
          }
        }
      } catch (e) {
        console.error("Failed to extract tabular selection:", e);
      }

      setSelectionPopover({
        top: rect.top + window.scrollY - 40,
        left: rect.left + window.scrollX + rect.width / 2,
        text: extractedText,
        msgIndex,
        sectionId
      });
    }
  };

  // Clear selection popover when clicking elsewhere
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (selectionPopover && !(e.target as HTMLElement).closest('.selection-popover')) {
        setSelectionPopover(null);
      }
    };
    window.addEventListener('mousedown', handleGlobalClick);
    return () => window.removeEventListener('mousedown', handleGlobalClick);
  }, [selectionPopover]);

  const handleAddSelectionComment = (msgIndex: number, text: string, sectionId: string) => {
    const comment = window.prompt(`Add a review comment for: "${text}"`);
    if (!comment) {
      setSelectionPopover(null);
      return;
    }

    const msg = chatHistory[msgIndex];
    const selectionComments = msg.selectionComments || [];
    const newComment = {
      id: `sel-${Date.now()}`,
      sectionId,
      text,
      comment
    };

    handleUpdateMessage(msgIndex, {
      selectionComments: [...selectionComments, newComment]
    });
    setSelectionPopover(null);
  };

  const handleDeleteSelectionComment = (msgIndex: number, id: string) => {
    if (!window.confirm("Delete this selection review?")) return;
    const msg = chatHistory[msgIndex];
    const updated = (msg.selectionComments || []).filter(sc => sc.id !== id);
    handleUpdateMessage(msgIndex, { selectionComments: updated });
  };

  const handleStartComment = (msgIndex: number, sectionId: string) => {
    // Only latest model output can have comments
    if (msgIndex !== chatHistory.length - 1) return;
    setActiveCommentInput({ msgIndex, sectionId });
    setCommentText('');
  };

  const handleAddComment = (msgIndex: number, sectionId: string) => {
    if (!commentText.trim()) return;
    const msg = chatHistory[msgIndex];
    const sections = msg.sections || sectionizeMessage(msg.content || '');
    const updatedSections = sections.map(s => s.id === sectionId ? { ...s, comment: commentText.trim(), isEditingComment: false } : s);
    handleUpdateMessage(msgIndex, { sections: updatedSections });
    setActiveCommentInput(null);
  };

  const handleEditComment = (msgIndex: number, sectionId: string, text: string) => {
    const msg = chatHistory[msgIndex];
    const updatedSections = (msg.sections || []).map(s => s.id === sectionId ? { ...s, isEditingComment: true } : s);
    handleUpdateMessage(msgIndex, { sections: updatedSections });
    setCommentText(text);
    setActiveCommentInput({ msgIndex, sectionId });
  };

  const handleDeleteComment = (msgIndex: number, sectionId: string) => {
    if (!window.confirm("Are you sure you want to delete this comment?")) return;
    const msg = chatHistory[msgIndex];
    const updatedSections = (msg.sections || []).map(s => s.id === sectionId ? { ...s, comment: undefined } : s);
    handleUpdateMessage(msgIndex, { sections: updatedSections });
  };

  // ─── Edit Apply Logic ─────────────────────────────────────────────────────

  /**
   * Applies a single pending edit to a sections array.
   * Handles both table edits (via the codec) and plain-text fragment replacement.
   * Returns the updated [sections, selectionComments] tuple.
   */
  const applyEditToSections = (
    edit: NonNullable<typeof chatHistory[number]['pendingEdits']>[number],
    sections: typeof chatHistory[number]['sections'] & object,
    selectionComments: NonNullable<typeof chatHistory[number]['selectionComments']>
  ) => {
    let updatedSections = [...sections];
    let updatedComments = [...selectionComments];

    if (edit.tableEdit) {
      // ── Structured table row replacement ──────────────────────────────────
      updatedSections = updatedSections.map(s => {
        if (s.id !== edit.sectionId) return s;
        if (!isMarkdownTable(s.content)) return s;
        const table = parseMarkdownTable(s.content);
        if (!table) return s;
        const newRows = table.rows.map((row, i) =>
          i === edit.tableEdit!.rowIndex ? edit.tableEdit!.cells : row
        );
        return { ...s, content: generateMarkdownTable({ ...table, rows: newRows }) };
      });
      if (edit.fragmentId) {
        updatedComments = updatedComments.filter(sc => sc.id !== edit.fragmentId);
      }
    } else if (edit.fragmentId && edit.newContent !== undefined) {
      // ── Fragment replacement (plain text OR table row via codec) ──────────────────
      const selection = updatedComments.find(sc => sc.id === edit.fragmentId);
      if (selection) {
        const targetId = selection.sectionId || edit.sectionId;
        updatedSections = updatedSections.map(s => {
          if (s.id !== targetId) return s;

          const newContentTrimmed = edit.newContent!.trim();
          const isFullRowReply = /^\|.*\|$/.test(newContentTrimmed);

          if (isMarkdownTable(s.content) && isFullRowReply) {
            // CRITICAL: if section is a table and newContent is a full row, we MUST use
            // the codec path. We NEVER let this fall through to fuzzy regex — that path
            // would greedily eat rows and silently corrupt the table.
            const table = parseMarkdownTable(s.content);
            if (!table) return s; // can't parse → bail out unchanged

            // Extract significant cells from selection text (min 4 chars, strip outer pipes)
            const selCells = selection.text.trim()
              .replace(/^\|\s*/, '')
              .replace(/\s*\|$/, '')
              .split('|')
              .map(c => c.trim())
              .filter(c => c.length >= 4);

            const rowIndex = table.rows.findIndex(row => {
              // Strategy 1: full pipe-wrapped row contains the selection text
              const rowFull = '| ' + row.join(' | ') + ' |';
              if (findExactMatchLenient(rowFull, selection.text.trim()) !== null) return true;

              // Strategy 2: any significant cell from selection appears in a row cell
              // (handles single-column selections with pipes)
              if (selCells.some(selCell => row.some(cell => findExactMatchLenient(cell, selCell) !== null))) return true;

              // Strategy 3: selection text (no pipes) is a substring of the row's flattened text
              // (handles multi-column HTML-rendered selections where browser strips pipes)
              const rowFlat = row.join(' ');
              if (findExactMatchLenient(rowFlat, selection.text.trim()) !== null) return true;

              // Strategy 4: strip ALL markdown formatting from both sides before comparing
              // (handles browser-rendered text where ** bold, <br>, HTML tags are invisible)
              const stripMd = (t: string) => t
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/<[^>]+>/g, ' ')
                .replace(/[*_~`]+/g, '')
                .replace(/\s+/g, ' ')
                .trim();
              const rowStripped = stripMd(rowFlat);
              const selStripped = stripMd(selection.text.trim());
              return rowStripped.toLowerCase().includes(selStripped.toLowerCase().slice(0, 80));
            });

            if (rowIndex === -1) {
              // Row not identified — abort safely rather than risk corrupting the table
              console.warn('[applyEditToSections] Table row not found for selection, skipping replacement', {
                selectionText: selection.text,
                rowCount: table.rows.length
              });
              return s; // Return section UNCHANGED
            }

            // Parse new cells from newContent
            const newCells = newContentTrimmed
              .slice(1, -1)
              .split('|')
              .map((c: string) => c.trim());

            console.log('[applyEditToSections] newCells parsed:', JSON.stringify(newCells), 'headers:', table.headers.length);

            // Handle column-count mismatch: merge only the cells the LLM changed
            let mergedCells = [...table.rows[rowIndex]];
            if (newCells.length === table.headers.length) {
              mergedCells = newCells;
            } else {
              // If LLM gave FEWER cells, do positional merge preserving unlisted cells
              console.warn('[applyEditToSections] Column count mismatch. Expected:', table.headers.length, 'Got:', newCells.length);
              newCells.forEach((newCell: string, newIdx: number) => {
                if (!newCell) return;
                const matchIdx = mergedCells.findIndex((existing: string) =>
                  findExactMatchLenient(newCell, existing) !== null ||
                  findExactMatchLenient(existing, newCell) !== null
                );
                if (matchIdx !== -1) {
                  mergedCells[matchIdx] = newCell;
                } else if (newIdx < mergedCells.length) {
                  mergedCells[newIdx] = newCell;
                }
              });
            }

            // Defensive guard: ensure final cell count is correct
            if (mergedCells.length !== table.headers.length) {
              console.error('[applyEditToSections] Merged cells length mismatch — aborting to prevent table corruption', {
                expected: table.headers.length, got: mergedCells.length, mergedCells
              });
              return s;
            }

            const newRows = table.rows.map((row, i) => i === rowIndex ? mergedCells : row);
            console.log(`[applyEditToSections] Table row edit at rowIndex=${rowIndex}`, { mergedCells });
            return { ...s, content: generateMarkdownTable({ ...table, rows: newRows }) };
          }

          // ── Plain-text fragment replacement (non-table sections only) ──────────
          const lenientMatch = findExactMatchLenient(s.content, selection.text.trim());
          let content = s.content;
          if (lenientMatch) {
            content = s.content.replace(lenientMatch, edit.newContent!);
          } else {
            content = s.content.replace(createFuzzyRegex(selection.text, 'markdown'), edit.newContent!);
          }
          if (content === s.content) {
            console.warn('[applyEditToSections] Replacement did not change content', selection.text);
          }
          return { ...s, content };
        });
        updatedComments = updatedComments.filter(sc => sc.id !== edit.fragmentId);
      }
    } else if (edit.newContent !== undefined) {
      // ── Whole-section replacement (section comment) ───────────────────────
      updatedSections = updatedSections.map(s =>
        s.id === edit.sectionId ? { ...s, content: edit.newContent!, comment: undefined } : s
      );
    }

    return [updatedSections, updatedComments] as const;
  };

  const handleConfirmEdit = (msgIndex: number, sectionId: string) => {
    const msg = chatHistory[msgIndex];
    if (!msg.pendingEdits) return;
    const edit = msg.pendingEdits.find(e => e.sectionId === sectionId);
    if (!edit) return;

    const sections = msg.sections?.length ? [...msg.sections] : sectionizeMessage(msg.content || '');
    const [updatedSections, updatedComments] = applyEditToSections(edit, sections, msg.selectionComments || []);

    handleUpdateMessage(msgIndex, {
      content: updatedSections.map(s => s.content).join('\n\n'),
      sections: updatedSections,
      selectionComments: updatedComments,
      pendingEdits: msg.pendingEdits.filter(e => e !== edit)
    });
  };

  const handleRejectEdit = (msgIndex: number, sectionId: string) => {
    const msg = chatHistory[msgIndex];
    if (!msg.pendingEdits) return;
    handleUpdateMessage(msgIndex, { pendingEdits: msg.pendingEdits.filter(e => e.sectionId !== sectionId) });
  };

  const handleConfirmAllEdits = (msgIndex: number) => {
    const msg = chatHistory[msgIndex];
    if (!msg.pendingEdits) return;

    let sections = msg.sections?.length ? [...msg.sections] : sectionizeMessage(msg.content || '');
    let comments = [...(msg.selectionComments || [])];

    for (const edit of msg.pendingEdits) {
      [sections, comments] = applyEditToSections(edit, sections, comments) as [typeof sections, typeof comments];
    }

    handleUpdateMessage(msgIndex, {
      content: sections.map(s => s.content).join('\n\n'),
      sections,
      selectionComments: comments,
      pendingEdits: []
    });
  };

  const handleRejectAllEdits = (msgIndex: number) => {
    handleUpdateMessage(msgIndex, { pendingEdits: [] });
  };

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
      } catch (e) { console.error(e); }
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

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');

  const handleStartEdit = (idx: number, content: string) => {
    setEditingIndex(idx);
    setEditingContent(content);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditingContent('');
  };

  const handleSaveAndRerun = async (idx: number) => {
    if (!editingContent.trim()) return;
    handleUpdateMessage(idx, { content: editingContent });
    handleTruncateHistory(idx);
    setEditingIndex(null);
    setEditingContent('');
    // Need to trigger the redo for the modified message
    await handleRedo(idx);
  };

  const { handleDrop, handleClearFiles, addFilesAndEmbed } = useFileState({
    vectorStore, docFontSize, coordinator, resetLLMResponseState: () => setHasLLMResponded(false)
  });

  const dropVideoRef = useRef<HTMLVideoElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const loadChatInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (chatInputRef.current) {
      chatInputRef.current.style.height = 'auto';
      chatInputRef.current.style.height = `${chatInputRef.current.scrollHeight}px`;
    }
  }, [userInput]);

  const handleCopy = useCallback(async (idx: number) => {
    const msg = chatHistory[idx];
    if (msg?.content) await navigator.clipboard.writeText(msg.content);
  }, [chatHistory]);

  const handleDownloadAction = useCallback(async (idx: number) => {
    const msg = chatHistory[idx];
    if (msg?.content) await downloadMessage(msg.content, idx, rootDirectoryHandle);
  }, [chatHistory, rootDirectoryHandle]);

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
      setChatHistory((prev) => (prev[prev.length - 1]?.content?.startsWith('Knowledge base updated') ?? false) ? prev : [...prev, { role: 'model', content: `Knowledge base updated.` }]);
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
      if (last.role === 'model' && !isLoading && !isEmbedding && isUser && !['Loading', 'Adding', 'Knowledge base'].some(s => (last.content || '').includes(s))) {
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
        <div className={`drag-drop-area glow-${glowType} ${isDragging ? 'dragging' : ''}`} onDrop={handleDropValidate} onDragOver={(e) => e.preventDefault()} onDragLeave={() => { }}>
          <SpeechBubble filesCount={files.length} isProcessing={activeJobCount > 0 || isLoading} isEmbedding={isEmbedding} />
          <RejectionBubble show={showRejectionBubble} />
          <FloatingArrows show={files.length === 0 && activeJobCount === 0 && !isLoading} />
          <DigestParticles isActive={isEmbedding || activeJobCount > 0} />
          {isLoading || activeJobCount > 0 ? <video src='/assets/thinking.mp4' autoPlay loop muted className="drop-media-element" /> : (showDropVideo ? <video ref={dropVideoRef} src={dropVideoSrc} onEnded={() => setShowDropVideo(false)} autoPlay muted className="drop-media-element" /> : <img src="/assets/drop.png" className="drop-media-element" />)}
        </div>
        <div className='flex gap-2'>
          <button className='button secondary' onClick={() => handleClearFiles(initialChatHistory)} disabled={files.length === 0 || isEmbedding} title="Clear Files"><Trash2 size={16} /></button>
          <button className='button secondary' onClick={handleClearConversation} disabled={chatHistory.length <= 1 || isLoading || isEmbedding} title="Clear Chat"><X size={16} /></button>
          <button className='button secondary' onClick={undo} disabled={historyStack.length === 0 || isLoading || isEmbedding} title="Undo last action"><RotateCcw size={16} /></button>
          <button className='button secondary' onClick={handleClear} title="Reset App"><RefreshCw size={16} /></button>
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
        <div className='chat-panel-header'><div className='background-changer'><button className='background-btn' onClick={() => setAppSettings(p => ({ ...p, backgroundIndex: p.backgroundIndex === 0 ? backgroundImages.length : p.backgroundIndex - 1 }))}><ChevronLeft size={16} /></button><button className='background-btn' onClick={() => setAppSettings(p => ({ ...p, backgroundIndex: (p.backgroundIndex + 1) % (backgroundImages.length + 1) }))}><ChevronRight size={16} /></button></div></div>
        <div className='panel-content' onClick={handleSourceClick} style={{ backgroundImage: backgroundImages[appSettings.backgroundIndex - 1] ? `url('${backgroundImages[appSettings.backgroundIndex - 1]}')` : 'none', backgroundSize: 'cover' }}>
          <div className='chat-history'>
            {chatHistory.map((msg, i) => ({ msg, i })).filter(({ msg }) => {
              // Hide intermediate tool calls and tool results from the UI
              if (msg.role === 'tool') return false;
              if (msg.role === 'model' && msg.tool_calls && msg.tool_calls.length > 0) return false;
              if (msg.isInternal) return false;
              return true;
            }).map(({ msg, i }) => (
              <div key={i} className={`message-container ${msg.role}`} onMouseUp={handleMouseUp(i)}>
                <div className={`chat-message ${msg.role} bubble-${appSettings.chatBubbleColor}`}>
                  <div className='avatar'>{msg.role === 'model' ? <Bot size={20} /> : <User size={20} />}</div>
                  <div className='message-content'>
                    {editingIndex === i ? (
                      <div className="edit-message-area">
                        <textarea
                          className="edit-message-textarea"
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          autoFocus
                        />
                        <div className="edit-message-actions">
                          <button onClick={() => handleSaveAndRerun(i)} title="Save and Rerun"><Check size={14} /></button>
                          <button onClick={handleCancelEdit} title="Cancel"><XCircle size={14} /></button>
                        </div>
                      </div>
                    ) : (
                      <div className="message-row">
                        <div className="message-main-content">
                          {msg.role === 'model' ? (() => {
                            const sections = msg.sections || sectionizeMessage(msg.content || '');
                            return (
                              <div className='message-markup'>
                                {msg.pendingEdits?.some(e => e.sectionId === 'REWRITE') ? (
                                  <div className="message-section-row">
                                    <div className="message-main-content">
                                      <div className="message-section highlight-pending">
                                        <div style={{ fontWeight: 'bold', borderBottom: '1px solid var(--border-color)', marginBottom: '0.5rem', paddingBottom: '0.25rem' }}>FULL REWRITE REQUEST:</div>
                                        <p>{msg.pendingEdits.find(e => e.sectionId === 'REWRITE')?.newContent}</p>
                                        <div className="edit-actions-floating" style={{ marginTop: '1rem' }}>
                                          <button className="button" onClick={() => {
                                            handleUpdateMessage(i, { pendingEdits: [] });
                                            submitQuery("Please perform the full rewrite as you suggested.", chatHistory.slice(0, i + 1));
                                          }}>Confirm Rewrite</button>
                                          <button className="button secondary" onClick={() => handleRejectAllEdits(i)}>Reject Rewrite</button>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="section-comment-area" />
                                  </div>
                                ) : sections.map((section) => {
                                  const pendingEdit = msg.pendingEdits?.find(e => e.sectionId === section.id);
                                  const isActiveInput = activeCommentInput?.msgIndex === i && activeCommentInput?.sectionId === section.id;

                                  return (
                                    <div key={section.id} className="message-section-row" data-section-id={section.id}>
                                      <div className="message-main-content">
                                        <div className="message-section-wrapper">
                                          <div className={`message-section ${pendingEdit ? 'highlight-pending' : ''}`}>
                                            <div dangerouslySetInnerHTML={renderModelMessage(section.content, msg.content, msg.selectionComments, hoveredSelectionId)} />
                                            {pendingEdit && (() => {
                                              // Build a human-readable preview for both edit types
                                              let previewContent: string | null = null;
                                              if (pendingEdit.tableEdit) {
                                                previewContent = `*Row ${pendingEdit.tableEdit.rowIndex + 1} update:* | ${pendingEdit.tableEdit.cells.join(' | ')} |`;
                                              } else if (pendingEdit.newContent != null) {
                                                previewContent = pendingEdit.newContent;
                                              }
                                              return previewContent ? (
                                                <div className="pending-edit-preview">
                                                  <div style={{ fontWeight: 'bold', fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--warning-orange)' }}>PROPOSED CHANGE:</div>
                                                  <div dangerouslySetInnerHTML={renderModelMessage(previewContent, msg.content, msg.selectionComments, hoveredSelectionId)} />
                                                  <div className="edit-actions-floating">
                                                    <button className="button btn-confirm-edit" onClick={() => handleConfirmEdit(i, section.id)} title="Confirm Change"><Check size={12} /> Confirm</button>
                                                    <button className="button btn-reject-edit" onClick={() => handleRejectEdit(i, section.id)} title="Reject Change"><XCircle size={12} /> Reject</button>
                                                  </div>
                                                </div>
                                              ) : null;
                                            })()}
                                          </div>
                                          {!pendingEdit && i === chatHistory.length - 1 && (
                                            <button className="add-comment-trigger" onClick={() => handleStartComment(i, section.id)} title="Add Comment">+</button>
                                          )}
                                        </div>
                                      </div>

                                      <div className="section-comment-area">
                                        {(section.comment || isActiveInput) && (
                                          <div className="comment-box">
                                            {isActiveInput ? (
                                              <div className="comment-input-overlay">
                                                <textarea
                                                  className="comment-textarea"
                                                  value={commentText}
                                                  onChange={(e) => setCommentText(e.target.value)}
                                                  placeholder="Type your comment here..."
                                                  autoFocus
                                                />
                                                <div className="comment-actions">
                                                  <button className="button" onClick={() => handleAddComment(i, section.id)}>
                                                    {section.isEditingComment ? 'Save' : 'Add Comment'}
                                                  </button>
                                                  <button className="button secondary" onClick={() => setActiveCommentInput(null)}>Cancel</button>
                                                </div>
                                              </div>
                                            ) : (
                                              <>
                                                <div className="comment-content">{section.comment}</div>
                                                <div className="comment-actions">
                                                  <button onClick={() => handleEditComment(i, section.id, section.comment || '')} title="Edit"><Edit2 size={12} /></button>
                                                  <button onClick={() => handleDeleteComment(i, section.id)} title="Delete"><Trash2 size={12} /></button>
                                                  <button
                                                    className="button resend-with-comments-btn-mini"
                                                    onClick={() => resendWithComments(i)}
                                                    title="Resend entire message with all comments"
                                                    disabled={isLoading}
                                                  >
                                                    <RefreshCw size={12} /> Resend
                                                  </button>
                                                </div>
                                              </>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}

                                {msg.selectionComments && msg.selectionComments.length > 0 && (
                                  <div className="message-section-row">
                                    <div className="message-main-content" />
                                    <div className="section-comment-area">
                                      <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#8e44ad', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Selection Reviews:</div>
                                      {msg.selectionComments.map(sc => (
                                        <div
                                          key={sc.id}
                                          className="comment-box"
                                          style={{ borderLeft: '3px solid #8e44ad', marginBottom: '0.5rem' }}
                                          onMouseEnter={() => setHoveredSelectionId(sc.id)}
                                          onMouseLeave={() => setHoveredSelectionId(null)}
                                        >
                                          <div className="selection-comment-sidebar-text">"{sc.text}"</div>
                                          <div className="comment-content">{sc.comment}</div>
                                          <div className="comment-actions">
                                            <button onClick={() => handleDeleteSelectionComment(i, sc.id)} title="Delete"><Trash2 size={12} /></button>
                                            <button
                                              className="button resend-with-comments-btn-mini"
                                              onClick={() => resendWithComments(i)}
                                              title="Resend entire message with all comments"
                                              disabled={isLoading}
                                            >
                                              <RefreshCw size={12} /> Resend
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                <div className="message-section-row">
                                  <div className="message-main-content">
                                    {msg.pendingEdits && msg.pendingEdits.length > 0 && (
                                      <div className="edit-message-actions" style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
                                        <button onClick={() => handleConfirmAllEdits(i)} className="button">Confirm All Edits</button>
                                        <button onClick={() => handleRejectAllEdits(i)} className="button secondary">Reject All Edits</button>
                                      </div>
                                    )}
                                    {(sections.some(s => s.comment) || (msg.selectionComments && msg.selectionComments.length > 0)) && i === chatHistory.length - 1 && (
                                      <button className="button resend-with-comments-btn" onClick={() => resendWithComments(i)}>
                                        <RefreshCw size={14} style={{ marginRight: '6px' }} /> Resend with Comments
                                      </button>
                                    )}
                                  </div>
                                  <div className="section-comment-area" />
                                </div>
                              </div>
                            );
                          })() : msg.content}
                          {msg.content && (msg.type === 'case_file_report' || msg.content.startsWith('# Case File')) && (
                            <DownloadReportButton content={msg.content} index={i} rootDirectoryHandle={rootDirectoryHandle} />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="message-actions">
                    <button onClick={() => handleCopy(i)} title="Copy"><Copy size={14} /></button>
                    <button onClick={() => handleDownloadAction(i)} title="Download"><Download size={14} /></button>
                    {msg.role === 'user' && editingIndex !== i && (
                      <>
                        <button onClick={() => handleStartEdit(i, msg.content || '')} title="Edit"><Edit2 size={14} /></button>
                        <button onClick={() => handleRedo(i)} disabled={isLoading || isEmbedding} title="Redo"><RefreshCw size={14} /></button>
                      </>
                    )}
                    <button onClick={() => handleRemoveMessage(i)} title="Remove"><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className='chat-message model'>
                {caseFileState.isAwaitingFeedback ? "Composing Case File... this may take a minute." : "Thinking..."}
              </div>
            )}
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
              <button type='submit' className='button' disabled={!userInput.trim() || activeJobCount > 0}><Send size={16} /></button>
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
            <button onClick={() => setAppSettings(p => ({ ...p, isDeepAnalysisEnabled: !p.isDeepAnalysisEnabled }))} className={`toggle-button ${appSettings.isDeepAnalysisEnabled ? 'active' : ''}`}>Deep Analysis: {appSettings.isDeepAnalysisEnabled ? 'ON' : 'OFF'}</button>
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
          <div className='setting-row' style={{ marginTop: '0.5rem' }}>
            <button className="button secondary" onClick={handleSaveChatHistory} style={{ flex: 1 }}>
              <Download size={14} style={{ marginRight: '6px' }} /> Download Session
            </button>
            <button className="button secondary" onClick={() => loadChatInputRef.current?.click()} style={{ flex: 1, marginLeft: '10px' }}>
              <Edit2 size={14} style={{ marginRight: '6px' }} /> Load Session
            </button>
            <input
              type="file"
              ref={loadChatInputRef}
              style={{ display: 'none' }}
              accept=".json"
              onChange={handleLoadChatHistory}
            />
          </div>
        </div>
      </div>
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

      {selectionPopover && (
        <div
          className="selection-popover"
          style={{ top: selectionPopover.top, left: selectionPopover.left }}
          onClick={() => handleAddSelectionComment(selectionPopover.msgIndex, selectionPopover.text, selectionPopover.sectionId)}
        >
          <Edit2 size={14} /> Review Selection
        </div>
      )}
    </div>
  );
};
