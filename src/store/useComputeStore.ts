import { create } from 'zustand';
import { JobProgress, JobTimer } from '../types';

interface ComputeState {
  isEmbedding: boolean;
  jobProgress: Record<string, JobProgress>;
  rerankProgress: JobProgress | null;
  jobTimers: Record<string, JobTimer>;
  computeDevice: 'gpu' | 'cpu' | 'unknown';
  mlWorkerCount: number;
  totalMlWorkerCount: number;
  rerankerWorkerCount: number;
  isInitializingWorkers: boolean;
  activeJobCount: number;
  totalEmbeddingsCount: number;

  // Actions
  setIsEmbedding: (isEmbedding: boolean) => void;
  setJobProgress: (updater: Record<string, JobProgress> | ((prev: Record<string, JobProgress>) => Record<string, JobProgress>)) => void;
  setRerankProgress: (progress: JobProgress | null) => void;
  setJobTimers: (updater: Record<string, JobTimer> | ((prev: Record<string, JobTimer>) => Record<string, JobTimer>)) => void;
  setComputeDevice: (device: 'gpu' | 'cpu' | 'unknown') => void;
  setMlWorkerCount: (count: number) => void;
  setTotalMlWorkerCount: (count: number) => void;
  setRerankerWorkerCount: (count: number) => void;
  setIsInitializingWorkers: (isInitializing: boolean) => void;
  setActiveJobCount: (updater: number | ((prev: number) => number)) => void;
  setTotalEmbeddingsCount: (count: number) => void;
}

export const useComputeStore = create<ComputeState>((set) => ({
  isEmbedding: false,
  jobProgress: {},
  rerankProgress: null,
  jobTimers: {},
  computeDevice: 'unknown',
  mlWorkerCount: 0,
  totalMlWorkerCount: 0,
  rerankerWorkerCount: 0,
  isInitializingWorkers: false,
  activeJobCount: 0,
  totalEmbeddingsCount: 0,

  setIsEmbedding: (isEmbedding) => set({ isEmbedding }),
  
  setJobProgress: (updater) => set((state) => ({
    jobProgress: typeof updater === 'function' ? updater(state.jobProgress) : updater
  })),

  setRerankProgress: (rerankProgress) => set({ rerankProgress }),

  setJobTimers: (updater) => set((state) => ({
    jobTimers: typeof updater === 'function' ? updater(state.jobTimers) : updater
  })),

  setComputeDevice: (computeDevice) => set({ computeDevice }),

  setMlWorkerCount: (mlWorkerCount) => set({ mlWorkerCount }),

  setTotalMlWorkerCount: (totalMlWorkerCount) => set({ totalMlWorkerCount }),

  setRerankerWorkerCount: (rerankerWorkerCount) => set({ rerankerWorkerCount }),

  setIsInitializingWorkers: (isInitializingWorkers) => set({ isInitializingWorkers }),

  setActiveJobCount: (updater) => set((state) => ({
    activeJobCount: typeof updater === 'function' ? updater(state.activeJobCount) : updater
  })),

  setTotalEmbeddingsCount: (totalEmbeddingsCount) => set({ totalEmbeddingsCount }),
}));
