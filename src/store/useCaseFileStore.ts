import { create } from 'zustand';
import { CaseFile } from '../types';

const MAX_STACK = 50;

interface CaseFileState {
    caseFile: CaseFile | null;
    undoStack: CaseFile[];
    redoStack: CaseFile[];
    isOverlayOpen: boolean;
    /** Remembered file handle for auto-save (not serializable, transient) */
    _fileHandle: FileSystemFileHandle | null;

    // Actions
    loadCaseFile: (file: CaseFile, handle?: FileSystemFileHandle) => void;
    patchSection: (sectionId: string, newContent: string) => void;
    addComment: (sectionId: string, comment: import('../types').CaseFileComment) => void;
    editComment: (sectionId: string, commentId: string, newInstruction: string) => void;
    deleteComment: (sectionId: string, commentId: string) => void;
    resolveComment: (sectionId: string, commentId: string, newContent: string) => void;

    // Map Actions
    initializeMap: () => void;
    updateMapNodes: (updater: import('../types').MapNode[] | ((prev: import('../types').MapNode[]) => import('../types').MapNode[])) => void;
    updateMapEdges: (updater: import('../types').MapEdge[] | ((prev: import('../types').MapEdge[]) => import('../types').MapEdge[])) => void;

    undo: () => void;
    redo: () => void;
    setOverlayOpen: (open: boolean) => void;
    setFileHandle: (handle: FileSystemFileHandle | null) => void;
}

/** Push current state to undo stack; clear redo stack on every mutation */
function push(state: CaseFileState, next: CaseFile): Partial<CaseFileState> {
    return {
        caseFile: next,
        undoStack: state.caseFile
            ? [...state.undoStack, state.caseFile].slice(-MAX_STACK)
            : state.undoStack,
        redoStack: [],
    };
}

export const useCaseFileStore = create<CaseFileState>((set) => ({
    caseFile: null,
    undoStack: [],
    redoStack: [],
    isOverlayOpen: false,
    _fileHandle: null,

    loadCaseFile: (file, handle) =>
        set({ caseFile: file, undoStack: [], redoStack: [], isOverlayOpen: true, _fileHandle: handle ?? null }),

    patchSection: (sectionId, newContent) =>
        set((state) => {
            if (!state.caseFile) return state;
            const next: CaseFile = {
                ...state.caseFile,
                sections: state.caseFile.sections.map((s) =>
                    s.id === sectionId ? { ...s, content: newContent } : s
                ),
            };
            return push(state, next);
        }),

    addComment: (sectionId, comment) =>
        set((state) => {
            if (!state.caseFile) return state;
            const next: CaseFile = {
                ...state.caseFile,
                sections: state.caseFile.sections.map((s) =>
                    s.id === sectionId ? { ...s, comments: [...s.comments, comment] } : s
                ),
            };
            return push(state, next);
        }),

    editComment: (sectionId, commentId, newInstruction) =>
        set((state) => {
            if (!state.caseFile) return state;
            const next: CaseFile = {
                ...state.caseFile,
                sections: state.caseFile.sections.map((s) =>
                    s.id === sectionId
                        ? {
                            ...s,
                            comments: s.comments.map((c) =>
                                c.id === commentId ? { ...c, instruction: newInstruction } : c
                            ),
                        }
                        : s
                ),
            };
            return push(state, next);
        }),

    deleteComment: (sectionId, commentId) =>
        set((state) => {
            if (!state.caseFile) return state;
            const next: CaseFile = {
                ...state.caseFile,
                sections: state.caseFile.sections.map((s) =>
                    s.id === sectionId
                        ? { ...s, comments: s.comments.filter((c) => c.id !== commentId) }
                        : s
                ),
            };
            return push(state, next);
        }),

    resolveComment: (sectionId, commentId, newContent) =>
        set((state) => {
            if (!state.caseFile) return state;
            const next: CaseFile = {
                ...state.caseFile,
                sections: state.caseFile.sections.map((s) =>
                    s.id === sectionId
                        ? {
                            ...s,
                            content: newContent,
                            comments: s.comments.filter((c) => c.id !== commentId),
                        }
                        : s
                ),
            };
            return push(state, next);
        }),

    initializeMap: () =>
        set((state) => {
            if (!state.caseFile || state.caseFile.map) return state;
            const next: CaseFile = {
                ...state.caseFile,
                map: { id: `map-${Date.now()}`, caseFileId: state.caseFile.title, nodes: [], edges: [] }
            };
            return push(state, next);
        }),

    updateMapNodes: (updater) =>
        set((state) => {
            if (!state.caseFile || !state.caseFile.map) return state;
            const nextNodes = typeof updater === 'function' ? (updater as (prev: import('../types').MapNode[]) => import('../types').MapNode[])(state.caseFile.map.nodes) : updater;
            const next: CaseFile = {
                ...state.caseFile,
                map: { ...state.caseFile.map, nodes: nextNodes }
            };
            return push(state, next);
        }),

    updateMapEdges: (updater) =>
        set((state) => {
            if (!state.caseFile || !state.caseFile.map) return state;
            const nextEdges = typeof updater === 'function' ? (updater as (prev: import('../types').MapEdge[]) => import('../types').MapEdge[])(state.caseFile.map.edges) : updater;
            const next: CaseFile = {
                ...state.caseFile,
                map: { ...state.caseFile.map, edges: nextEdges }
            };
            return push(state, next);
        }),

    undo: () =>
        set((state) => {
            if (state.undoStack.length === 0) return state;
            const previous = state.undoStack[state.undoStack.length - 1];
            return {
                caseFile: previous,
                undoStack: state.undoStack.slice(0, -1),
                redoStack: state.caseFile
                    ? [...state.redoStack, state.caseFile].slice(-MAX_STACK)
                    : state.redoStack,
            };
        }),

    redo: () =>
        set((state) => {
            if (state.redoStack.length === 0) return state;
            const next = state.redoStack[state.redoStack.length - 1];
            return {
                caseFile: next,
                redoStack: state.redoStack.slice(0, -1),
                undoStack: state.caseFile
                    ? [...state.undoStack, state.caseFile].slice(-MAX_STACK)
                    : state.undoStack,
            };
        }),

    setOverlayOpen: (open) => set({ isOverlayOpen: open }),
    setFileHandle: (handle) => set({ _fileHandle: handle }),
}));
