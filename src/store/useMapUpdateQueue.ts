import { create } from 'zustand';
import type { SearchResult as WebSearchResult } from '../utils/search';

interface MapUpdateQueueState {
    /** Each item is a batch of web search results from a single search_web call */
    pendingUpdates: WebSearchResult[][];
    enqueueUpdate: (results: WebSearchResult[]) => void;
    dequeueUpdate: () => WebSearchResult[] | null;
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
