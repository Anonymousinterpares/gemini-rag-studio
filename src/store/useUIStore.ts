import { create } from 'zustand';
import { AppFile, ViewMode, SearchResult } from '../types';

type SetStateAction<S> = S | ((prevState: S) => S);

interface UIState {
  // Panel States
  viewMode: ViewMode;
  showSettings: boolean;
  isPinned: boolean;
  isExplorerOpen: boolean;
  isDossierOpen: boolean;
  isMapPanelOpen: boolean;
  
  // Modal States
  isDocModalOpen: boolean;
  isCacheModalOpen: boolean;
  isSummaryModalOpen: boolean;
  
  // Active Content States
  currentSummary: string;
  summaryFile: AppFile | null;
  activeSource: { file: AppFile; chunks: SearchResult[] } | null;
  docFontSize: number;
  
  // Chat Editing State
  editingIndex: number | null;
  editingContent: string;

  // Actions
  setViewMode: (mode: SetStateAction<ViewMode>) => void;
  setShowSettings: (show: SetStateAction<boolean>) => void;
  setIsPinned: (pinned: SetStateAction<boolean>) => void;
  setIsExplorerOpen: (open: SetStateAction<boolean>) => void;
  setIsDossierOpen: (open: SetStateAction<boolean>) => void;
  setIsMapPanelOpen: (open: SetStateAction<boolean>) => void;
  
  setDocModalOpen: (open: SetStateAction<boolean>) => void;
  setCacheModalOpen: (open: SetStateAction<boolean>) => void;
  setSummaryModalOpen: (open: SetStateAction<boolean>) => void;
  
  setCurrentSummary: (summary: SetStateAction<string>) => void;
  setSummaryFile: (file: SetStateAction<AppFile | null>) => void;
  setActiveSource: (source: SetStateAction<{ file: AppFile; chunks: SearchResult[] } | null>) => void;
  setDocFontSize: (size: SetStateAction<number>) => void;
  
  setEditingIndex: (index: SetStateAction<number | null>) => void;
  setEditingContent: (content: SetStateAction<string>) => void;
  
  // Convenience Actions
  openSummary: (file: AppFile, summary: string) => void;
  closeSummary: () => void;
  openDocViewer: (file: AppFile, chunks: SearchResult[]) => void;
}

const resolveAction = <T,>(action: SetStateAction<T>, prevState: T): T => {
  return typeof action === 'function' ? (action as (prev: T) => T)(prevState) : action;
};

export const useUIStore = create<UIState>((set) => ({
  viewMode: 'tree',
  showSettings: true,
  isPinned: false,
  isExplorerOpen: false,
  isDossierOpen: false,
  isMapPanelOpen: false,
  
  isDocModalOpen: false,
  isCacheModalOpen: false,
  isSummaryModalOpen: false,
  
  currentSummary: '',
  summaryFile: null,
  activeSource: null,
  docFontSize: 0.9,
  
  editingIndex: null,
  editingContent: '',

  setViewMode: (viewMode) => set((s) => ({ viewMode: resolveAction(viewMode, s.viewMode) })),
  setShowSettings: (show) => set((s) => ({ showSettings: resolveAction(show, s.showSettings) })),
  setIsPinned: (isPinned) => set((s) => ({ isPinned: resolveAction(isPinned, s.isPinned) })),
  setIsExplorerOpen: (isExplorerOpen) => set((s) => ({ isExplorerOpen: resolveAction(isExplorerOpen, s.isExplorerOpen) })),
  setIsDossierOpen: (isDossierOpen) => set((s) => ({ isDossierOpen: resolveAction(isDossierOpen, s.isDossierOpen) })),
  setIsMapPanelOpen: (isMapPanelOpen) => set((s) => ({ isMapPanelOpen: resolveAction(isMapPanelOpen, s.isMapPanelOpen) })),
  
  setDocModalOpen: (isDocModalOpen) => set((s) => ({ isDocModalOpen: resolveAction(isDocModalOpen, s.isDocModalOpen) })),
  setCacheModalOpen: (isCacheModalOpen) => set((s) => ({ isCacheModalOpen: resolveAction(isCacheModalOpen, s.isCacheModalOpen) })),
  setSummaryModalOpen: (isSummaryModalOpen) => set((s) => ({ isSummaryModalOpen: resolveAction(isSummaryModalOpen, s.isSummaryModalOpen) })),
  
  setCurrentSummary: (currentSummary) => set((s) => ({ currentSummary: resolveAction(currentSummary, s.currentSummary) })),
  setSummaryFile: (summaryFile) => set((s) => ({ summaryFile: resolveAction(summaryFile, s.summaryFile) })),
  setActiveSource: (activeSource) => set((s) => ({ activeSource: resolveAction(activeSource, s.activeSource) })),
  setDocFontSize: (size) => set((s) => ({ docFontSize: resolveAction(size, s.docFontSize) })),
  
  setEditingIndex: (editingIndex) => set((s) => ({ editingIndex: resolveAction(editingIndex, s.editingIndex) })),
  setEditingContent: (editingContent) => set((s) => ({ editingContent: resolveAction(editingContent, s.editingContent) })),
  
  openSummary: (file, summary) => set({
    summaryFile: file,
    currentSummary: summary,
    isSummaryModalOpen: true
  }),
  closeSummary: () => set({
    isSummaryModalOpen: false,
    summaryFile: null,
    currentSummary: ''
  }),
  openDocViewer: (file, chunks) => set({
    activeSource: { file, chunks },
    isDocModalOpen: true
  })
}));
