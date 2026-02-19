import { create } from 'zustand';
import { AppFile, FileTree, ReviewFileTreeItem } from '../types';
import { buildFileTree } from '../utils/fileTree';

interface FileState {
  files: AppFile[];
  fileTree: FileTree;
  selectedFile: AppFile | null;
  isDragging: boolean;
  showFolderReviewModal: boolean;
  folderReviewTreeData: Record<string, ReviewFileTreeItem>;
  filesToProcessAfterReview: AppFile[];

  // Actions
  setFiles: (updater: AppFile[] | ((prev: AppFile[]) => AppFile[])) => void;
  setSelectedFile: (file: AppFile | null) => void;
  setIsDragging: (isDragging: boolean) => void;
  setShowFolderReviewModal: (show: boolean) => void;
  setFolderReviewTreeData: (data: Record<string, ReviewFileTreeItem>) => void;
  setFilesToProcessAfterReview: (files: AppFile[]) => void;
  removeFile: (fileId: string) => void;
  clearFiles: () => void;
}

export const useFileStore = create<FileState>((set) => ({
  files: [],
  fileTree: {},
  selectedFile: null,
  isDragging: false,
  showFolderReviewModal: false,
  folderReviewTreeData: {},
  filesToProcessAfterReview: [],

  setFiles: (updater) => set((state) => {
    const nextFiles = typeof updater === 'function' ? updater(state.files) : updater;
    return {
      files: nextFiles,
      fileTree: buildFileTree(nextFiles)
    };
  }),

  setSelectedFile: (file) => set({ selectedFile: file }),
  
  setIsDragging: (isDragging) => set({ isDragging }),
  
  setShowFolderReviewModal: (show) => set({ showFolderReviewModal: show }),
  
  setFolderReviewTreeData: (data) => set({ folderReviewTreeData: data }),
  
  setFilesToProcessAfterReview: (files) => set({ filesToProcessAfterReview: files }),

  removeFile: (fileId) => set((state) => {
    const nextFiles = state.files.filter(f => f.id !== fileId);
    return {
      files: nextFiles,
      fileTree: buildFileTree(nextFiles),
      selectedFile: state.selectedFile?.id === fileId ? null : state.selectedFile
    };
  }),

  clearFiles: () => set({
    files: [],
    fileTree: {},
    selectedFile: null,
    filesToProcessAfterReview: [],
    folderReviewTreeData: {}
  }),
}));
