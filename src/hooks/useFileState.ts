import { useState, useCallback, useEffect } from 'react';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { TextItem } from 'pdfjs-dist/types/src/display/api';
import { AppFile, FileTree, ChatMessage, JobTimer, TokenUsage, CachedEmbedding, Model, Provider, ReviewFileTreeItem } from '../types';
import { buildFileTree } from '../utils/fileTree';
import { generateFileId, isAllowedFileType } from '../utils/fileUtils';
import { GitignoreParser } from '../utils/gitignoreParser';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;
import { VectorStore } from '../rag/pipeline';
import { embeddingCache } from '../cache/embeddingCache';
import { summaryCache } from '../cache/summaryCache';
import { AppSettings } from '../config';
import { ComputeCoordinator } from '../compute/coordinator';
import { chunkDocument } from '../rag/pipeline';
import { createFileTasks } from '../utils/taskFactory';

interface UseFileStateProps {
  setChatHistory: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  setTokenUsage: (updater: (prev: TokenUsage) => TokenUsage) => void;
  vectorStore: React.MutableRefObject<VectorStore | null> | null;
  appSettings: AppSettings;
  selectedModel: Model;
  selectedProvider: Provider;
  apiKeys: Record<string, string>;
  docFontSize: number;
  setIsEmbedding: (isEmbedding: boolean) => void;
  setJobTimers: (updater: (prev: Record<string, JobTimer>) => Record<string, JobTimer>) => void;
  coordinator: React.MutableRefObject<ComputeCoordinator | null> | null;
  files: AppFile[];
  setFiles: React.Dispatch<React.SetStateAction<AppFile[]>>;
  setDropVideoSrc: React.Dispatch<React.SetStateAction<string>>;
  setShowDropVideo: React.Dispatch<React.SetStateAction<boolean>>;
  resetLLMResponseState: () => void;
}


export const useFileState = ({
  appSettings,
  selectedModel,
  selectedProvider,
  apiKeys,
  docFontSize,
  setIsEmbedding,
  setChatHistory,
  setTokenUsage,
  files,
  setFiles,
  setJobTimers,
  coordinator,
  vectorStore,
  setDropVideoSrc,
  setShowDropVideo,
  resetLLMResponseState,
}: UseFileStateProps) => {
  const [fileTree, setFileTree] = useState<FileTree>({});
  const [selectedFile, setSelectedFile] = useState<AppFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showFolderReviewModal, setShowFolderReviewModal] = useState(false);
  const [folderReviewTreeData, setFolderReviewTreeData] = useState<{ [key: string]: ReviewFileTreeItem }>({});
  const [filesToProcessAfterReview, setFilesToProcessAfterReview] = useState<AppFile[]>([]);

  useEffect(() => {
    setFileTree(buildFileTree(files));
  }, [files]);

  
    const addFilesAndEmbed = useCallback(async (newFiles: AppFile[]) => {
      if (!coordinator?.current || !setJobTimers) return;
  
      const filesToProcess: AppFile[] = [];
      const filesToLoadFromCache: { file: AppFile, cachedEmbedding: CachedEmbedding }[] = [];
  
      for (const newFile of newFiles) {
        // Check if a file with the same unique ID already exists in the current state
        if (files.some((existingFile) => existingFile.id === newFile.id)) {
          console.log(`Skipping duplicate file (by ID): ${newFile.id}`);
          continue;
        }
  
        const cachedEmbedding = await embeddingCache.get(newFile.id);
        const cachedSummary = await summaryCache.get(newFile.id);
  
        const fileWithStatus: AppFile = {
          ...newFile,
          summaryStatus: cachedSummary && cachedSummary.lastModified === newFile.lastModified ? 'available' : 'missing',
          language: cachedEmbedding?.language || 'unknown',
          layoutStatus: 'pending', // Default to pending
        };
  
        if (cachedEmbedding && cachedEmbedding.lastModified === newFile.lastModified && cachedEmbedding.size === newFile.size) {
          filesToLoadFromCache.push({ file: fileWithStatus, cachedEmbedding });
        } else {
          filesToProcess.push(fileWithStatus);
        }
      }
  
      console.log(`[DEBUG] addFilesAndEmbed: Starting processing.`);
      console.log(`[DEBUG] addFilesAndEmbed: Found ${filesToProcess.length} files to process from scratch.`);
      console.log(`[DEBUG] addFilesAndEmbed: Found ${filesToLoadFromCache.length} files to load from cache.`);

      if (filesToProcess.length === 0 && filesToLoadFromCache.length === 0) {
        console.log(`[DEBUG] addFilesAndEmbed: No new files to process or load. Exiting.`);
        return;
      }
  
      const allNewFiles = [...filesToProcess, ...filesToLoadFromCache.map(f => f.file)];

      // Determine which are truly new vs. already present
      const existingIdsNow = new Set(files.map(f => f.id));
      const uniqueNewFiles = allNewFiles.filter(f => !existingIdsNow.has(f.id));

      setFiles((prevFiles) => {
        console.log(`[DEBUG] addFilesAndEmbed: Adding ${uniqueNewFiles.length} unique new files to state.`);
        return [...prevFiles, ...uniqueNewFiles];
      });

      // Precompute layout opportunistically for all newly added files
      if (coordinator.current && uniqueNewFiles.length > 0) {
        try {
          const jobs = coordinator.current.getJobs();
          const existingLayoutJobs = new Set(jobs.filter(j => j.name.startsWith('Layout: ')).map(j => j.name));
          for (const nf of uniqueNewFiles) {
            const jobName = `Layout: ${nf.id}`;
            if (existingLayoutJobs.has(jobName)) {
              continue; // already queued
            }
            // Queue low-priority layout calculation; this runs on GP workers (P2)
            const layoutTasks = await createFileTasks(nf, 'layout', coordinator.current, docFontSize, selectedModel, selectedProvider, apiKeys, appSettings);
            coordinator.current.addJob(jobName, layoutTasks);
          }
          console.log(`[DEBUG] addFilesAndEmbed: Queued layout jobs for ${uniqueNewFiles.length} new file(s).`);
        } catch (e) {
          console.warn('[DEBUG] addFilesAndEmbed: Failed to queue layout jobs:', e);
        }
      }
  
      if (filesToLoadFromCache.length > 0) {
        console.log(`[DEBUG] addFilesAndEmbed: Processing ${filesToLoadFromCache.length} files from cache.`);
        setChatHistory((prev: ChatMessage[]) => [
          ...prev,
          { role: 'model', content: `Loading ${filesToLoadFromCache.length} file(s) from cache...` },
        ]);
        for (const { file, cachedEmbedding } of filesToLoadFromCache) {
          console.log(`[DEBUG] addFilesAndEmbed: Loading cached data for ${file.id}`);
          if (cachedEmbedding.parentChunks && cachedEmbedding.childChunks) {
            vectorStore?.current?.addParentChunks(file.id, cachedEmbedding.parentChunks);
            for (let i = 0; i < cachedEmbedding.childChunks.length; i++) {
              const child = cachedEmbedding.childChunks[i];
              vectorStore?.current?.addChildChunkEmbedding(file.id, cachedEmbedding.embedding[i], {
                ...child,
                parentChunkIndex: child.parentChunkIndex ?? -1,
              });
            }
          } else {
            const chunks = await chunkDocument(file.content);
            if (chunks.length === cachedEmbedding.embedding.length) {
              for (let i = 0; i < chunks.length; i++) {
                vectorStore?.current?.addChunkEmbedding(chunks[i], file.id, cachedEmbedding.embedding[i]);
              }
            } else {
              console.error(`[DEBUG] [Cache] Mismatch for ${file.id}, re-embedding.`);
              filesToProcess.push(file); // Re-process if mismatch
              continue;
            }
          }
  
          // For cached files, we still need to check if summary is done. Layout is handled by useLayoutManager.
          if (coordinator.current && file.summaryStatus === 'missing') {
            console.log(`[DEBUG] addFilesAndEmbed: Queueing summary task for cached file ${file.id}`);
            const summaryTasks = await createFileTasks(file, 'summary', coordinator.current, docFontSize, selectedModel, selectedProvider, apiKeys, appSettings);
            coordinator.current.addJob(`Summary: ${file.id}`, summaryTasks);
          }
        }
      }
  
      if (filesToProcess.length > 0) {
        console.log(`[DEBUG] addFilesAndEmbed: Processing ${filesToProcess.length} new files.`);
        setIsEmbedding(true);
        setChatHistory((prev: ChatMessage[]) => [
          ...prev,
          { role: 'model', content: `Adding ${filesToProcess.length} new file(s). Processing in background...` },
        ]);
  
        for (const file of filesToProcess) {
          const jobName = `Ingestion: ${file.id}`;
          console.log(`[DEBUG] addFilesAndEmbed: Creating ingestion job "${jobName}" for file ${file.id}`);
          setJobTimers((prev) => ({ ...prev, [jobName]: { startTime: Date.now(), elapsed: 0, isActive: true } }));
          if (coordinator.current) {
            const ingestionTasks = await createFileTasks(file, 'ingestion', coordinator.current, docFontSize, selectedModel, selectedProvider, apiKeys, appSettings);
            console.log(`[DEBUG] addFilesAndEmbed: Adding job "${jobName}" to coordinator with ${ingestionTasks.length} tasks.`);
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
        setChatHistory((prev: ChatMessage[]) => [
          ...prev,
          {
            role: 'model',
            content: 'File ingestion cancelled by user.',
          },
        ]);
      }
      setFilesToProcessAfterReview([]); // Clear the temporary storage
    }, [addFilesAndEmbed, filesToProcessAfterReview, setChatHistory]);
  
    const processDroppedItems = useCallback(async (items: DataTransferItemList): Promise<AppFile[]> => { // Changed return type and removed addFilesFn
      const collectedFiles: AppFile[] = []; // Collect files here
    const processEntry = async (
      entry: FileSystemEntry,
      currentPath: string,
      currentGitignoreParsers: GitignoreParser[]
    ): Promise<void> => {
      const fullPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

      // Check if the current entry (file or directory) should be ignored by any active .gitignore
      const shouldBeIgnored = currentGitignoreParsers.some(parser => parser.shouldIgnore(fullPath));
      if (shouldBeIgnored) {
        console.log(`Skipping ignored path: ${fullPath}`);
        return;
      }

      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        const file = await new Promise<File>((resolve) => fileEntry.file(resolve));

        if (!isAllowedFileType(file.name)) {
          console.log(`Skipping disallowed file type: ${file.name}`);
          return;
        }

        // Check for large files that are not docx/pdf (which are handled by their specific parsers)
        if (!file.name.endsWith('.docx') && !file.name.endsWith('.pdf') && file.size > 5 * 1024 * 1024) {
          console.log(`Skipping large file: ${file.name}`);
          return;
        }

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
          try {
            content = await file.text();
          } catch (e) {
            console.warn(`Could not read file ${fullPath} as text, skipping.`, e);
            return;
          }
        }

        const newAppFile: AppFile = {
          id: generateFileId({ path: fullPath, name: file.name, size: file.size, lastModified: file.lastModified }),
          path: fullPath,
          name: file.name,
          content,
          lastModified: file.lastModified,
          size: file.size,
          summaryStatus: 'missing',
          language: 'unknown',
        };
        console.log('[DEBUG] Collected file:', { path: newAppFile.path, id: newAppFile.id });
        collectedFiles.push(newAppFile); // Push to collectedFiles
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const dirReader = dirEntry.createReader();
        const entries = await new Promise<FileSystemEntry[]>((resolve) =>
          dirReader.readEntries(resolve)
        );

        const updatedGitignoreParsers = [...currentGitignoreParsers]; // Use const
        // Check for .gitignore file in the current directory
        const gitignoreFileEntry = entries.find(e => e.name === '.gitignore' && e.isFile) as FileSystemFileEntry;
        if (gitignoreFileEntry) {
          try {
            const gitignoreFile = await new Promise<File>((resolve) => gitignoreFileEntry.file(resolve));
            const gitignoreContent = await gitignoreFile.text();
            updatedGitignoreParsers.push(new GitignoreParser(gitignoreContent));
            console.log(`Loaded .gitignore from: ${fullPath}/.gitignore`);
          } catch (e) {
            console.warn(`Could not read .gitignore file in ${fullPath}, skipping.`, e);
          }
        }

        await Promise.all(
          entries.map((child) => processEntry(child, fullPath, updatedGitignoreParsers))
        );
      }
    };

    const entries = Array.from(items)
      .map((item) => item.webkitGetAsEntry())
      .filter(Boolean);
    await Promise.all(
      entries.map((entry) => (entry ? processEntry(entry, '', []) : Promise.resolve())) // Initial call with empty gitignore parsers
    );

    console.log('[DEBUG] processDroppedItems collected files:', collectedFiles);
    return collectedFiles; // Return the collected files
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      console.log(`[DEBUG] handleFileSelect: Processing ${e.target.files.length} selected files.`);

      const newFiles: AppFile[] = [];
      for (const file of Array.from(e.target.files)) {
        const fullPath = file.name;
        if (!isAllowedFileType(file.name)) {
          console.log(`[DEBUG] Skipping disallowed file type: ${file.name}`);
          continue;
        }

        let content = '';
        try {
          if (file.name.endsWith('.docx')) {
            const arrayBuffer = await file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });
            content = result.value;
          } else if (file.name.endsWith('.pdf')) {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
            let textContent = '';
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const pageText = await page.getTextContent();
              textContent += pageText.items.map(item => (item as TextItem).str).join(' ');
            }
            content = textContent;
          } else {
            content = await file.text();
          }
        } catch (err) {
          console.warn(`[DEBUG] Could not read file ${fullPath}, skipping.`, err);
          continue;
        }

        const newAppFile: AppFile = {
          id: generateFileId({ path: fullPath, name: file.name, size: file.size, lastModified: file.lastModified }),
          path: fullPath,
          name: file.name,
          content,
          lastModified: file.lastModified,
          size: file.size,
          summaryStatus: 'missing',
          language: 'unknown',
          layoutStatus: 'pending', // Default to pending
        };
        console.log('[DEBUG] Collected file from select:', { path: newAppFile.path, id: newAppFile.id });
        newFiles.push(newAppFile);
      }

      console.log(`[DEBUG] handleFileSelect: Calling addFilesAndEmbed with ${newFiles.length} processed files.`);
      await addFilesAndEmbed(newFiles);
      e.target.value = '';
    },
    [addFilesAndEmbed]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      // Determine monster state for appropriate videos
      const getAcceptedVideo = () => {
        if (files.length > 10) return '/assets/drop_accepted_fully_eaten.mp4';
        if (files.length > 5) return '/assets/drop_accepted_half_full.mp4';
        return '/assets/drop_accepted.mp4';
      };

      const getRejectedVideo = () => {
        if (files.length > 10) return '/assets/drop_NOT_accepted_fully_eaten.mp4';
        if (files.length > 5) return '/assets/drop_NOT_accepted_half_full.mp4';
        return '/assets/drop_NOT_accepted.mp4';
      };

      if (e.dataTransfer.items) {
        const processedFiles = await processDroppedItems(e.dataTransfer.items);
        console.log('[DEBUG] handleDrop received processed files:', processedFiles);

        if (processedFiles.length === 0) {
          setDropVideoSrc(getRejectedVideo());
          setShowDropVideo(true);
          setChatHistory((prev: ChatMessage[]) => [
            ...prev,
            {
              role: 'model',
              content: 'No allowed files found in the dropped items.',
            },
          ]);
          return;
        }

        setDropVideoSrc(getAcceptedVideo());
        setShowDropVideo(true);

        if (processedFiles.length > 30) {
          const confirmUpload = window.confirm(
            `${processedFiles.length} allowed files will be uploaded. Proceed?`
          );

          if (!confirmUpload) {
            const reviewFiles = window.confirm('Do you want to review the files/folders before proceeding?');
            if (reviewFiles) {
              setFilesToProcessAfterReview(processedFiles);
              // Build the ReviewFileTreeItem structure
              const reviewTree: { [key: string]: ReviewFileTreeItem } = {};
              processedFiles.forEach(file => {
                const parts = file.path.split('/').filter(p => p);
                let currentLevel = reviewTree;
                let currentPath = '';
                parts.forEach((part, index) => {
                  currentPath = currentPath ? `${currentPath}/${part}` : part;
                  if (index === parts.length - 1) {
                    // It's a file
                    currentLevel[part] = {
                      name: part,
                      path: file.path,
                      isDirectory: false,
                      isChecked: true, // Default to checked
                      isIndeterminate: false,
                    };
                  } else {
                    // It's a directory
                    if (!currentLevel[part]) {
                      currentLevel[part] = {
                        name: part,
                        path: currentPath,
                        isDirectory: true,
                        isChecked: true, // Default to checked
                        isIndeterminate: false,
                        children: {},
                      };
                    }
                    currentLevel = currentLevel[part].children!;
                  }
                });
              });
              setFolderReviewTreeData(reviewTree);
              setShowFolderReviewModal(true);
            } else {
              setChatHistory((prev: ChatMessage[]) => [
                ...prev,
                {
                  role: 'model',
                  content: 'File ingestion cancelled by user.',
                },
              ]);
            }
          } else {
            await addFilesAndEmbed(processedFiles);
          }
        } else {
          await addFilesAndEmbed(processedFiles);
        }
      }
    },
    [processDroppedItems, setDropVideoSrc, setShowDropVideo, files.length, setChatHistory, addFilesAndEmbed]
  );

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleClearFiles = useCallback((initialHistory: ChatMessage[]) => {
    if (
      window.confirm(
        'Are you sure you want to clear all loaded files and chat history?'
      )
    ) {
      setFiles([]);
      setFileTree({});
      setSelectedFile(null);
      setChatHistory(() => initialHistory);
      setTokenUsage(() => ({ promptTokens: 0, completionTokens: 0 }));
      setJobTimers(() => ({}));
      vectorStore?.current?.clear();
      resetLLMResponseState(); // Reset LLM response tracking
      if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [App] Cleared all files and reset vector store.`);
    }
  }, [appSettings, setFiles, setJobTimers, vectorStore, setChatHistory, setSelectedFile, setTokenUsage, resetLLMResponseState]);

  const handleRemoveFile = useCallback((fileToRemove: AppFile) => {
    setFiles(prevFiles => prevFiles.filter(file => file.id !== fileToRemove.id));
    vectorStore?.current?.removeDocument(fileToRemove.id);
    if (selectedFile?.id === fileToRemove.id) {
      setSelectedFile(null);
    }
  }, [selectedFile, setFiles, vectorStore]);

  return {
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
    showFolderReviewModal, // Expose modal state
    folderReviewTreeData, // Expose modal data
    handleFolderReviewModalClose, // Expose modal close handler
    filesToProcessAfterReview, // Expose for debugging/testing if needed
  };
};