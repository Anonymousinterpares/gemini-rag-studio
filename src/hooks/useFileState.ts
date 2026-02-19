import { useCallback } from 'react';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { TextItem } from 'pdfjs-dist/types/src/display/api';
import { AppFile, ChatMessage, CachedEmbedding } from '../types';
import { generateFileId, isAllowedFileType } from '../utils/fileUtils';
import { GitignoreParser } from '../utils/gitignoreParser';
import { VectorStore } from '../rag/pipeline';
import { embeddingCache } from '../cache/embeddingCache';
import { summaryCache } from '../cache/summaryCache';
import { ComputeCoordinator } from '../compute/coordinator';
import { chunkDocument } from '../rag/pipeline';
import { createFileTasks } from '../utils/taskFactory';
import { useFileStore, useSettingsStore, useChatStore, useComputeStore } from '../store';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

interface UseFileStateProps {
  vectorStore: React.MutableRefObject<VectorStore | null> | null;
  docFontSize: number;
  coordinator: React.MutableRefObject<ComputeCoordinator | null> | null;
  resetLLMResponseState: () => void;
}

export const useFileState = ({
  docFontSize,
  coordinator,
  vectorStore,
  resetLLMResponseState,
}: UseFileStateProps) => {
  const { 
    files, 
    setFiles, 
    setIsDragging, 
    setShowFolderReviewModal, 
    setFolderReviewTreeData, 
    setFilesToProcessAfterReview,
    filesToProcessAfterReview,
    removeFile,
    clearFiles
  } = useFileStore();

  const { appSettings, selectedModel, selectedProvider, apiKeys } = useSettingsStore();
  const { setChatHistory, setTokenUsage } = useChatStore();
  const { setIsEmbedding, setJobTimers } = useComputeStore();

  const addFilesAndEmbed = useCallback(async (newFiles: AppFile[]) => {
    if (!coordinator?.current) return;

    const filesToProcess: AppFile[] = [];
    const filesToLoadFromCache: { file: AppFile, cachedEmbedding: CachedEmbedding }[] = [];

    for (const newFile of newFiles) {
      if (files.some((existingFile) => existingFile.id === newFile.id)) continue;

      const cachedEmbedding = await embeddingCache.get(newFile.id);
      const cachedSummary = await summaryCache.get(newFile.id);

      const fileWithStatus: AppFile = {
        ...newFile,
        summaryStatus: cachedSummary && cachedSummary.lastModified === newFile.lastModified ? 'available' : 'missing',
        language: cachedEmbedding?.language || 'unknown',
        layoutStatus: 'pending',
      };

      if (cachedEmbedding && cachedEmbedding.lastModified === newFile.lastModified && cachedEmbedding.size === newFile.size) {
        filesToLoadFromCache.push({ file: fileWithStatus, cachedEmbedding });
      } else {
        filesToProcess.push(fileWithStatus);
      }
    }

    if (filesToProcess.length === 0 && filesToLoadFromCache.length === 0) return;

    const allNewFiles = [...filesToProcess, ...filesToLoadFromCache.map(f => f.file)];
    const existingIdsNow = new Set(files.map(f => f.id));
    const uniqueNewFiles = allNewFiles.filter(f => !existingIdsNow.has(f.id));

    setFiles((prevFiles) => [...prevFiles, ...uniqueNewFiles]);

    if (coordinator.current && uniqueNewFiles.length > 0) {
      try {
        const jobs = coordinator.current.getJobs();
        const existingLayoutJobs = new Set(jobs.filter(j => j.name.startsWith('Layout: ')).map(j => j.name));
        for (const nf of uniqueNewFiles) {
          const jobName = `Layout: ${nf.id}`;
          if (existingLayoutJobs.has(jobName)) continue;
          const layoutTasks = await createFileTasks(nf, 'layout', coordinator.current, docFontSize, selectedModel, selectedProvider, apiKeys, appSettings);
          coordinator.current.addJob(jobName, layoutTasks);
        }
      } catch (e) {
        if (appSettings.isLoggingEnabled) console.warn('[addFilesAndEmbed] Failed layout jobs:', e);
      }
    }

    if (filesToLoadFromCache.length > 0) {
      setChatHistory((prev: ChatMessage[]) => [...prev, { role: 'model', content: `Loading ${filesToLoadFromCache.length} file(s) from cache...` }]);
      for (const { file, cachedEmbedding } of filesToLoadFromCache) {
        if (cachedEmbedding.parentChunks && cachedEmbedding.childChunks) {
          vectorStore?.current?.addParentChunks(file.id, cachedEmbedding.parentChunks);
          for (let i = 0; i < cachedEmbedding.childChunks.length; i++) {
            const child = cachedEmbedding.childChunks[i];
            vectorStore?.current?.addChildChunkEmbedding(file.id, cachedEmbedding.embedding[i], { ...child, parentChunkIndex: child.parentChunkIndex ?? -1 });
          }
        } else {
          const chunks = await chunkDocument(file.content);
          if (chunks.length === cachedEmbedding.embedding.length) {
            for (let i = 0; i < chunks.length; i++) {
              vectorStore?.current?.addChunkEmbedding(chunks[i], file.id, cachedEmbedding.embedding[i]);
            }
          } else {
            filesToProcess.push(file);
            continue;
          }
        }

        if (coordinator.current && file.summaryStatus === 'missing') {
          const summaryTasks = await createFileTasks(file, 'summary', coordinator.current, docFontSize, selectedModel, selectedProvider, apiKeys, appSettings);
          coordinator.current.addJob(`Summary: ${file.id}`, summaryTasks);
        }
      }
    }

    if (filesToProcess.length > 0) {
      setIsEmbedding(true);
      setChatHistory((prev: ChatMessage[]) => [...prev, { role: 'model', content: `Adding ${filesToProcess.length} new file(s)...` }]);

      for (const file of filesToProcess) {
        const jobName = `Ingestion: ${file.id}`;
        setJobTimers((prev) => ({ ...prev, [jobName]: { startTime: Date.now(), elapsed: 0, isActive: true } }));
        if (coordinator.current) {
          const ingestionTasks = await createFileTasks(file, 'ingestion', coordinator.current, docFontSize, selectedModel, selectedProvider, apiKeys, appSettings);
          coordinator.current.addJob(jobName, ingestionTasks);
        }
      }
    }
  }, [files, docFontSize, appSettings, selectedModel, selectedProvider, apiKeys, setIsEmbedding, setChatHistory, coordinator, setJobTimers, setFiles, vectorStore]);

  const handleFolderReviewModalClose = useCallback(async (selectedFilePaths: string[] | null) => {
    setShowFolderReviewModal(false);
    if (selectedFilePaths) {
      const filteredFiles = filesToProcessAfterReview.filter(file => selectedFilePaths.includes(file.path));
      await addFilesAndEmbed(filteredFiles);
    } else {
      setChatHistory((prev: ChatMessage[]) => [...prev, { role: 'model', content: 'File ingestion cancelled by user.' }]);
    }
    setFilesToProcessAfterReview([]);
  }, [addFilesAndEmbed, filesToProcessAfterReview, setChatHistory, setShowFolderReviewModal, setFilesToProcessAfterReview]);

  const processDroppedItems = useCallback(async (items: DataTransferItemList): Promise<AppFile[]> => {
    const collectedFiles: AppFile[] = [];
    const processEntry = async (entry: FileSystemEntry, currentPath: string, currentGitignoreParsers: GitignoreParser[]): Promise<void> => {
      const fullPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      const shouldBeIgnored = currentGitignoreParsers.some(parser => parser.shouldIgnore(fullPath));
      if (shouldBeIgnored) return;

      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        const file = await new Promise<File>((resolve) => fileEntry.file(resolve));
        if (!isAllowedFileType(file.name)) return;
        if (!file.name.endsWith('.docx') && !file.name.endsWith('.pdf') && file.size > 5 * 1024 * 1024) return;

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
        } else {
          try { content = await file.text(); } catch { return; }
        }

        collectedFiles.push({
          id: generateFileId({ path: fullPath, name: file.name, size: file.size, lastModified: file.lastModified }),
          path: fullPath, name: file.name, content, lastModified: file.lastModified, size: file.size, summaryStatus: 'missing', language: 'unknown',
        });
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const dirReader = dirEntry.createReader();
        const entries = await new Promise<FileSystemEntry[]>((resolve) => dirReader.readEntries(resolve));
        const updatedGitignoreParsers = [...currentGitignoreParsers];
        const gitignoreFileEntry = entries.find(e => e.name === '.gitignore' && e.isFile) as FileSystemFileEntry;
        if (gitignoreFileEntry) {
          try {
            const gitignoreFile = await new Promise<File>((resolve) => gitignoreFileEntry.file(resolve));
            const gitignoreContent = await gitignoreFile.text();
            updatedGitignoreParsers.push(new GitignoreParser(gitignoreContent));
          } catch {
            // ignore
          }
        }
        await Promise.all(entries.map((child) => processEntry(child, fullPath, updatedGitignoreParsers)));
      }
    };

    const entries = Array.from(items).map((item) => item.webkitGetAsEntry()).filter(Boolean);
    await Promise.all(entries.map((entry) => (entry ? processEntry(entry, '', []) : Promise.resolve())));
    return collectedFiles;
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newFiles: AppFile[] = [];
    for (const file of Array.from(e.target.files)) {
      const fullPath = file.name;
      if (!isAllowedFileType(file.name)) continue;
      let content = '';
      try {
        if (file.name.endsWith('.docx')) { content = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value; }
        else if (file.name.endsWith('.pdf')) {
          const pdf = await pdfjsLib.getDocument(await file.arrayBuffer()).promise;
          for (let i = 1; i <= pdf.numPages; i++) content += (await (await pdf.getPage(i)).getTextContent()).items.map(it => (it as TextItem).str).join(' ');
        } else { content = await file.text(); }
      } catch { continue; }
      newFiles.push({
        id: generateFileId({ path: fullPath, name: file.name, size: file.size, lastModified: file.lastModified }),
        path: fullPath, name: file.name, content, lastModified: file.lastModified, size: file.size, summaryStatus: 'missing', language: 'unknown', layoutStatus: 'pending',
      });
    }
    await addFilesAndEmbed(newFiles);
    e.target.value = '';
  }, [addFilesAndEmbed]);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    if (e.dataTransfer.items) {
      const processedFiles = await processDroppedItems(e.dataTransfer.items);
      if (processedFiles.length === 0) return;
      if (processedFiles.length > 30) {
        if (window.confirm(`${processedFiles.length} files. Review?`)) {
          setFilesToProcessAfterReview(processedFiles);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reviewTree: any = {};
          processedFiles.forEach(file => {
            const parts = file.path.split('/').filter(p => p);
            let level = reviewTree;
            let path = '';
            parts.forEach((p, i) => {
              path = path ? `${path}/${p}` : p;
              if (i === parts.length - 1) level[p] = { name: p, path: file.path, isDirectory: false, isChecked: true, isIndeterminate: false };
              else { if (!level[p]) level[p] = { name: p, path, isDirectory: true, isChecked: true, isIndeterminate: false, children: {} }; level = level[p].children; }
            });
          });
          setFolderReviewTreeData(reviewTree); setShowFolderReviewModal(true);
        } else await addFilesAndEmbed(processedFiles);
      } else await addFilesAndEmbed(processedFiles);
    }
  }, [processDroppedItems, setIsDragging, setFilesToProcessAfterReview, setFolderReviewTreeData, setShowFolderReviewModal, addFilesAndEmbed]);

  const handleClearFiles = useCallback((initialHistory: ChatMessage[]) => {
    if (window.confirm('Clear all?')) {
      clearFiles(); setChatHistory(initialHistory); setTokenUsage({ promptTokens: 0, completionTokens: 0 });
      setJobTimers({}); vectorStore?.current?.clear(); resetLLMResponseState();
    }
  }, [clearFiles, setChatHistory, setTokenUsage, setJobTimers, vectorStore, resetLLMResponseState]);

  const handleRemoveFile = useCallback((fileToRemove: AppFile) => {
    removeFile(fileToRemove.id); vectorStore?.current?.removeDocument(fileToRemove.id);
  }, [removeFile, vectorStore]);

  return {
    handleFileSelect, handleDrop, handleClearFiles, addFilesAndEmbed, handleRemoveFile, handleFolderReviewModalClose,
  };
};
