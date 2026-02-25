import { create } from 'zustand';
import { MapNode, MapEdge } from '../types';
import { saveMap, loadMap } from '../utils/db';

const MAX_UNDO_STACK = 50;

export interface MapProgress {
    phase: 1 | 2;
    batchCurrent: number;
    batchTotal: number;
    label: string;
}

interface MapState {
    nodes: MapNode[];
    edges: MapEdge[];

    // Undo/Redo (session-memory only — NOT persisted)
    undoStack: { nodes: MapNode[]; edges: MapEdge[] }[];
    redoStack: { nodes: MapNode[]; edges: MapEdge[] }[];

    // Concurrency lock — only one AI job at a time
    jobLock: boolean;

    // Progress indicator for multi-phase generation
    progress: MapProgress | null;

    // Actions — node/edge patching
    patchNodes: (patch: {
        add?: MapNode[];
        update?: (Partial<MapNode['data']> & { id: string })[];
        remove?: string[];
    }) => void;
    patchEdges: (patch: {
        add?: MapEdge[];
        remove?: string[];
    }) => void;

    // Undo / Redo
    undo: () => void;
    redo: () => void;

    // Bulk load from a CaseFile map or on startup
    loadMap: (nodes: MapNode[], edges: MapEdge[]) => void;
    clearMap: () => void;

    // Job lock
    acquireLock: () => boolean;   // returns false if already locked
    releaseLock: () => void;

    // Progress
    setProgress: (p: MapProgress | null) => void;

    // Persistence
    persistToDB: () => Promise<void>;
    hydrateFromDB: () => Promise<void>;
}

function checkpoint(state: MapState) {
    return {
        undoStack: [...state.undoStack, { nodes: state.nodes, edges: state.edges }].slice(-MAX_UNDO_STACK),
        redoStack: [] as typeof state.redoStack,
    };
}

export const useMapStore = create<MapState>((set, get) => ({
    nodes: [],
    edges: [],
    undoStack: [],
    redoStack: [],
    jobLock: false,
    progress: null,

    patchNodes: ({ add = [], update = [], remove = [] }) => {
        set((state) => {
            let nodes = [...state.nodes];

            // Remove
            if (remove.length > 0) {
                const removeSet = new Set(remove);
                nodes = nodes.filter(n => !removeSet.has(n.id));
            }

            // Update existing
            if (update.length > 0) {
                nodes = nodes.map(n => {
                    const patch = update.find(u => u.id === n.id);
                    if (!patch) return n;
                    const { id: _id, ...dataPatch } = patch;
                    return {
                        ...n,
                        data: { ...n.data, ...dataPatch, lastUpdatedAt: Date.now() },
                    };
                });
            }

            // Add new (dedup guard)
            if (add.length > 0) {
                const existingIds = new Set(nodes.map(n => n.id));
                const truly_new = add.filter(n => {
                    if (existingIds.has(n.id)) {
                        console.warn(`[MapStore] Dedup: node "${n.id}" already exists — skipped.`);
                        return false;
                    }
                    return true;
                });
                nodes = [...nodes, ...truly_new];
            }

            return { nodes, ...checkpoint(state) };
        });
        get().persistToDB();
    },

    patchEdges: ({ add = [], remove = [] }) => {
        set((state) => {
            let edges = [...state.edges];

            // Remove
            if (remove.length > 0) {
                const removeSet = new Set(remove);
                edges = edges.filter(e => !removeSet.has(e.id));
            }

            // Add new (dedup guard by source-target pair)
            if (add.length > 0) {
                const existingPairs = new Set(edges.map(e => `${e.source}::${e.target}`));
                const truly_new = add.filter(e => {
                    const key = `${e.source}::${e.target}`;
                    if (existingPairs.has(key)) {
                        console.warn(`[MapStore] Dedup: edge "${key}" already exists — skipped.`);
                        return false;
                    }
                    return true;
                });
                edges = [...edges, ...truly_new];
            }

            return { edges, ...checkpoint(state) };
        });
        get().persistToDB();
    },

    undo: () => {
        set((state) => {
            if (state.undoStack.length === 0) return state;
            const prev = state.undoStack[state.undoStack.length - 1];
            return {
                nodes: prev.nodes,
                edges: prev.edges,
                undoStack: state.undoStack.slice(0, -1),
                redoStack: [...state.redoStack, { nodes: state.nodes, edges: state.edges }],
            };
        });
        get().persistToDB();
    },

    redo: () => {
        set((state) => {
            if (state.redoStack.length === 0) return state;
            const next = state.redoStack[state.redoStack.length - 1];
            return {
                nodes: next.nodes,
                edges: next.edges,
                redoStack: state.redoStack.slice(0, -1),
                undoStack: [...state.undoStack, { nodes: state.nodes, edges: state.edges }].slice(-MAX_UNDO_STACK),
            };
        });
        get().persistToDB();
    },

    loadMap: (nodes, edges) => {
        set({ nodes, edges, undoStack: [], redoStack: [] });
        get().persistToDB();
    },

    clearMap: () => {
        set({ nodes: [], edges: [], undoStack: [], redoStack: [] });
        get().persistToDB();
    },

    acquireLock: () => {
        const { jobLock } = get();
        if (jobLock) return false;
        set({ jobLock: true });
        return true;
    },

    releaseLock: () => set({ jobLock: false }),

    setProgress: (progress) => set({ progress }),

    persistToDB: async () => {
        const { nodes, edges } = get();
        try {
            await saveMap({ nodes, edges });
        } catch (e) {
            console.error('[MapStore] Failed to persist map to IndexedDB:', e);
        }
    },

    hydrateFromDB: async () => {
        try {
            const data = await loadMap();
            if (data) {
                set({ nodes: data.nodes, edges: data.edges });
            }
        } catch (e) {
            console.error('[MapStore] Failed to hydrate map from IndexedDB:', e);
        }
    },
}));
