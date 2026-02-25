import { create } from 'zustand';
import { CaseFile } from '../types';
import { useMapStore } from './useMapStore';

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
    acceptProposedContent: (sectionId: string) => void;
    rejectProposedContent: (sectionId: string) => void;

    // Map seeding when a CaseFile is loaded (delegates to useMapStore)
    seedMapFromCaseFile: (nodes: import('../types').MapNode[], edges: import('../types').MapEdge[]) => void;

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

    loadCaseFile: (file, handle) => {
        set({ caseFile: file, undoStack: [], redoStack: [], isOverlayOpen: true, _fileHandle: handle ?? null });
        // Seed the independent map store with any existing map data embedded in the case file
        if (file.map && (file.map.nodes.length > 0 || file.map.edges.length > 0)) {
            // Use getState() to avoid a circular reference through the store interface
            useMapStore.getState().loadMap(file.map.nodes, file.map.edges);
        }
    },

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
            return {
                caseFile: {
                    ...state.caseFile,
                    sections: state.caseFile.sections.map((s) =>
                        s.id === sectionId
                            ? {
                                ...s,
                                proposedContent: newContent,
                                resolvingCommentId: commentId,
                            }
                            : s
                    ),
                }
            };
        }),

    acceptProposedContent: (sectionId) =>
        set((state) => {
            if (!state.caseFile) return state;
            const next: CaseFile = {
                ...state.caseFile,
                sections: state.caseFile.sections.map((s) =>
                    s.id === sectionId && s.proposedContent
                        ? {
                            ...s,
                            content: s.proposedContent,
                            proposedContent: undefined,
                            comments: s.resolvingCommentId ? s.comments.filter(c => c.id !== s.resolvingCommentId) : s.comments,
                            resolvingCommentId: undefined
                        }
                        : s
                ),
            };
            return push(state, next);
        }),

    rejectProposedContent: (sectionId) =>
        set((state) => {
            if (!state.caseFile) return state;
            return {
                caseFile: {
                    ...state.caseFile,
                    sections: state.caseFile.sections.map((s) =>
                        s.id === sectionId
                            ? {
                                ...s,
                                proposedContent: undefined,
                                resolvingCommentId: undefined
                            }
                            : s
                    ),
                }
            };
        }),

    seedMapFromCaseFile: (nodes, edges) => {
        const { loadMap } = useMapStore.getState();
        loadMap(nodes, edges);
    },

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
