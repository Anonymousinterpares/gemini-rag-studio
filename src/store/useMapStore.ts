import { create } from 'zustand';
import { MapNode, MapEdge } from '../types';
import { useProjectStore } from './useProjectStore';
import { saveMap, loadMap } from '../utils/db';

const MAX_UNDO_STACK = 50;

export interface MapProgress {
    phase: number;
    batchCurrent: number;
    batchTotal: number;
    label: string;
}

export interface MapState {
    nodes: MapNode[];
    edges: MapEdge[];

    // Undo/Redo (session-memory only — NOT persisted)
    undoStack: { nodes: MapNode[]; edges: MapEdge[] }[];
    redoStack: { nodes: MapNode[]; edges: MapEdge[] }[];

    // Concurrency lock — only one AI job at a time
    jobLock: boolean;
    lockExpiresAt: number | null;

    // Progress indicator for multi-phase generation
    progress: MapProgress | null;

    // RAG Status
    isRagEnabled: boolean;
    isRagActive: boolean;
    isWebActive: boolean;
    isDeepActive: boolean;
    isRetrieving: boolean;
    setIsRagEnabled: (enabled: boolean) => void;
    setIsRagActive: (active: boolean) => void;
    setIsWebActive: (active: boolean) => void;
    setIsDeepActive: (active: boolean) => void;
    setIsRetrieving: (retrieving: boolean) => void;

    // Error Overlay
    mapError: string | null;
    setMapError: (error: string | null) => void;

    // Visual indicators for recent AI map updates
    lastChanges: {
        added: string[];
        updated: string[];
        disproven: string[]; // AI-removed nodes are marked "disproven"
    } | null;
    clearLastChanges: () => void;

    // Map UI Filter
    hideDisproven: boolean;
    setHideDisproven: (hide: boolean) => void;

    // Actions — node/edge patching
    patchNodes: (patch: {
        add?: MapNode[];
        update?: (Partial<MapNode['data']> & { id: string })[];
        remove?: string[];      // Soft remove (sets certainty='disproven')
        hardRemove?: string[];  // Hard remove (deletes from store)
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
    resetMap: () => void;

    // Job lock
    acquireLock: (timeoutMs?: number) => boolean;   // returns false if already locked
    refreshLock: (timeoutMs?: number) => void;
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

let persistTimeout: ReturnType<typeof setTimeout> | null = null;
let lockSafetyTimeout: ReturnType<typeof setTimeout> | null = null;

export const useMapStore = create<MapState>((set, get) => ({
    nodes: [],
    edges: [],
    undoStack: [],
    redoStack: [],
    jobLock: false,
    lockExpiresAt: null,
    progress: null,
    isRagEnabled: false,
    isRagActive: false,
    isWebActive: false,
    isRetrieving: false,
    isDeepActive: false,
    mapError: null,
    lastChanges: null,
    hideDisproven: false,

    setHideDisproven: (hide) => set({ hideDisproven: hide }),

    setIsRagEnabled: (enabled) => set((state) => ({
        isRagEnabled: enabled,
        // Only auto-activate RAG on the FIRST transition to having files (when isRagActive was never set by user).
        // After that, isRagActive is exclusively the user's toggle — file events must not overwrite it.
        isRagActive: !state.isRagEnabled && enabled ? true : state.isRagActive,
        // NEVER touch isWebActive or isDeepActive — those are user-only preferences.
    })),
    setIsRagActive: (active) => { set({ isRagActive: active }); get().persistToDB(); },
    setIsWebActive: (active) => { set({ isWebActive: active }); get().persistToDB(); },
    setIsDeepActive: (active) => { set({ isDeepActive: active }); get().persistToDB(); },
    setIsRetrieving: (retrieving) => set({ isRetrieving: retrieving }),
    setMapError: (error) => {
        set({ mapError: error });
        if (error) {
            setTimeout(() => set({ mapError: null }), 1000);
        }
    },

    clearLastChanges: () => set({ lastChanges: null }),

    patchNodes: ({ add = [], update = [], remove = [], hardRemove = [] }) => {
        set((state) => {
            let nodes = [...state.nodes];

            // Accumulate changes if job is locked, else reset
            const baseChanges = (state.jobLock && state.lastChanges) ? state.lastChanges : { added: [] as string[], updated: [] as string[], disproven: [] as string[] };
            const changes = {
                added: [...baseChanges.added],
                updated: [...baseChanges.updated],
                disproven: [...baseChanges.disproven]
            };

            // Hard Remove
            if (hardRemove.length > 0) {
                const removeSet = new Set(hardRemove);
                nodes = nodes.filter(n => !removeSet.has(n.id));
            }

            // Soft Remove (AI removal becomes 'disproven')
            if (remove.length > 0) {
                const removeSet = new Set(remove);
                nodes = nodes.map(n => {
                    if (removeSet.has(n.id)) {
                        changes.disproven.push(n.id);
                        return {
                            ...n,
                            data: { ...n.data, certainty: 'disproven', lastUpdatedAt: Date.now() }
                        };
                    }
                    return n;
                });
            }

            // Update existing
            if (update.length > 0) {
                nodes = nodes.map(n => {
                    const patch = update.find(u => u.id === n.id);
                    if (!patch) return n;
                    const { id: _id, ...dataPatch } = patch;
                    changes.updated.push(n.id);
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
                truly_new.forEach(n => changes.added.push(n.id));
                nodes = [...nodes, ...truly_new];
            }

            const hasChanges = changes.added.length > 0 || changes.updated.length > 0 || changes.disproven.length > 0;

            // Notice we do NOT start a timeout here anymore. 
            // releaseLock will handle starting the 8-second visual clear timeout for AI jobs.

            return {
                nodes,
                lastChanges: hasChanges ? changes : null,
                ...checkpoint(state)
            };
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
                lastChanges: null, // Clear visual indicators on manual action
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
                lastChanges: null, // Clear visual indicators on manual action
                redoStack: state.redoStack.slice(0, -1),
                undoStack: [...state.undoStack, { nodes: state.nodes, edges: state.edges }].slice(-MAX_UNDO_STACK),
            };
        });
        get().persistToDB();
    },

    loadMap: (nodes, edges) => {
        set({ nodes, edges, undoStack: [], redoStack: [] });
    },

    clearMap: () => {
        set({ nodes: [], edges: [], undoStack: [], redoStack: [] });
        get().persistToDB();
    },

    resetMap: () => {
        set({ nodes: [], edges: [], undoStack: [], redoStack: [] });
    },

    acquireLock: (timeoutMs = 90000) => {
        const { jobLock } = get();
        if (jobLock) return false;
        
        set({ jobLock: true, lockExpiresAt: Date.now() + timeoutMs });

        if (lockSafetyTimeout) clearTimeout(lockSafetyTimeout);
        lockSafetyTimeout = setTimeout(() => {
            if (get().jobLock) {
                console.warn('[MapStore] Forcefully releasing stalled jobLock after timeout.');
                get().releaseLock();
                get().setMapError("Map process timed out.");
            }
        }, timeoutMs);

        return true;
    },

    refreshLock: (timeoutMs = 90000) => {
        const { jobLock } = get();
        if (!jobLock) return;

        set({ lockExpiresAt: Date.now() + timeoutMs });

        if (lockSafetyTimeout) clearTimeout(lockSafetyTimeout);
        lockSafetyTimeout = setTimeout(() => {
            if (get().jobLock) {
                console.warn('[MapStore] Forcefully releasing stalled jobLock after timeout (refreshed).');
                get().releaseLock();
                get().setMapError("Map process timed out.");
            }
        }, timeoutMs);
    },

    releaseLock: () => {
        if (lockSafetyTimeout) clearTimeout(lockSafetyTimeout);
        set({ jobLock: false, lockExpiresAt: null });
        if (get().lastChanges) {
            setTimeout(() => {
                get().clearLastChanges();
            }, 8000);
        }
    },

    setProgress: (progress) => set({ progress }),

    persistToDB: async () => {
        if (persistTimeout) clearTimeout(persistTimeout);

        persistTimeout = setTimeout(async () => {
            const activeProjectId = useProjectStore.getState().activeProjectId;
            if (!activeProjectId) return;

            const { nodes, edges, isRagActive, isWebActive, isDeepActive } = get();
            try {
                await saveMap(activeProjectId, { nodes, edges, isRagActive, isWebActive, isDeepActive });
            } catch (e) {
                console.error('[MapStore] Failed to persist map to IndexedDB:', e);
            }
        }, 500);
    },

    hydrateFromDB: async () => {
        const activeProjectId = useProjectStore.getState().activeProjectId;
        if (!activeProjectId) return;

        try {
            const data = await loadMap(activeProjectId);
            if (data) {
                set({
                    nodes: data.nodes,
                    edges: data.edges,
                    undoStack: [],
                    redoStack: [],
                    lastChanges: null,
                    progress: null,
                    jobLock: false,
                    lockExpiresAt: null,
                    isRagActive: data.isRagActive ?? true,
                    isWebActive: data.isWebActive ?? false,
                    isDeepActive: data.isDeepActive ?? false,
                });
            } else {
                set({
                    nodes: [],
                    edges: [],
                    undoStack: [],
                    redoStack: [],
                    lastChanges: null,
                    progress: null,
                    jobLock: false,
                    lockExpiresAt: null
                });
            }
        } catch (e) {
            console.error('[MapStore] Failed to hydrate map from IndexedDB:', e);
        }
    },
}));
