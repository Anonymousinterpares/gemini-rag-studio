import { create } from 'zustand';
import { SearchResult } from '../types';

interface MapUpdateQueueState {
    pendingUpdates: SearchResult[][];
    enqueueUpdate: (results: SearchResult[]) => void;
    dequeueUpdate: () => SearchResult[] | null;
    clearQueue: () => void;
}

export const useMapUpdateQueue = create<MapUpdateQueueState>((set, get) => ({
    pendingUpdates: [],

    enqueueUpdate: (results) =>
        set((state) => ({ pendingUpdates: [...state.pendingUpdates, results] })),

    dequeueUpdate: () => {
        const { pendingUpdates } = get();
        if (pendingUpdates.length === 0) return null;
        const [first, ...rest] = pendingUpdates;
        set({ pendingUpdates: rest });
        return first;
    },

    clearQueue: () => set({ pendingUpdates: [] }),
}));
