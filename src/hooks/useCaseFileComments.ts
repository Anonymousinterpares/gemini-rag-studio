import { useState, useEffect } from 'react';
import { CaseFile, CaseFileComment } from '../types';
import { useCaseFileStore } from '../store/useCaseFileStore';
import { useCaseFileIO } from './useCaseFileIO';

interface SelectionPopoverState {
    top: number;
    left: number;
    selectedText: string;
    sectionId: string;
    commentInputOpen: boolean;
}

/**
 * Mirrors useChatComments but operates on CaseFile sections.
 * Text selection identifies the SECTION only – the LLM will always
 * rewrite the full section, never just the selected fragment.
 */
export const useCaseFileComments = (
    /** Called to run the LLM for a comment resolution */
    onResolveComment: (
        caseFile: CaseFile,
        sectionId: string,
        comment: CaseFileComment
    ) => Promise<void>
) => {
    const { caseFile, addComment, editComment, deleteComment } = useCaseFileStore();
    const { scheduleAutoSave } = useCaseFileIO();

    const [selectionPopover, setSelectionPopover] = useState<SelectionPopoverState | null>(null);
    const [commentDraft, setCommentDraft] = useState('');
    const [resolvingCommentId, setResolvingCommentId] = useState<string | null>(null);

    // ── Clear popover on outside click ───────────────────────────────────────
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (selectionPopover && !(e.target as HTMLElement).closest('.cf-selection-popover')) {
                setSelectionPopover(null);
            }
        };
        window.addEventListener('mousedown', handler);
        return () => window.removeEventListener('mousedown', handler);
    }, [selectionPopover]);

    // ── Mouse-up handler (attach to the overlay body element) ────────────────
    const handleMouseUp = () => {
        const selection = window.getSelection();
        if (!selection || selection.toString().trim().length === 0) return;

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // Walk up to find data-section-id
        let node: Node | null = range.commonAncestorContainer;
        while (node && !(node instanceof HTMLElement && node.getAttribute('data-section-id'))) {
            node = node.parentNode;
        }
        if (!(node instanceof HTMLElement)) return;

        const sectionId = node.getAttribute('data-section-id') || 'sec-0';
        const selectedText = selection.toString().trim();

        setSelectionPopover({
            top: rect.top + window.scrollY - 44,
            left: rect.left + window.scrollX + rect.width / 2,
            selectedText,
            sectionId,
            commentInputOpen: false,
        });
    };

    const handleOpenCommentInput = () => {
        setCommentDraft('');
        setSelectionPopover((prev) => (prev ? { ...prev, commentInputOpen: true } : null));
    };

    // ── CRUD ─────────────────────────────────────────────────────────────────

    const handleAddComment = (sectionId: string, selectedText: string, instruction: string) => {
        if (!instruction.trim() || !caseFile) return;
        const comment: CaseFileComment = {
            id: `cfc-${Date.now()}`,
            sectionId,
            selectedText,
            instruction: instruction.trim(),
            createdAt: Date.now(),
        };
        addComment(sectionId, comment);
        scheduleAutoSave({ ...caseFile });
        setSelectionPopover(null);
        setCommentDraft('');
    };

    const handleEditComment = (sectionId: string, commentId: string, newInstruction: string) => {
        if (!caseFile) return;
        editComment(sectionId, commentId, newInstruction);
        scheduleAutoSave({ ...caseFile });
    };

    const handleDeleteComment = (sectionId: string, commentId: string) => {
        if (!caseFile) return;
        if (!window.confirm('Delete this comment?')) return;
        deleteComment(sectionId, commentId);
        scheduleAutoSave({ ...caseFile });
    };

    // ── LLM Resolution ────────────────────────────────────────────────────────

    const handleResolveComment = async (sectionId: string, commentId: string) => {
        if (!caseFile || resolvingCommentId) return;
        const section = caseFile.sections.find((s) => s.id === sectionId);
        const comment = section?.comments.find((c) => c.id === commentId);
        if (!comment) return;

        setResolvingCommentId(commentId);
        try {
            await onResolveComment(caseFile, sectionId, comment);
        } finally {
            setResolvingCommentId(null);
        }
    };

    return {
        selectionPopover, setSelectionPopover,
        commentDraft, setCommentDraft,
        resolvingCommentId,
        handleMouseUp,
        handleOpenCommentInput,
        handleAddComment,
        handleEditComment,
        handleDeleteComment,
        handleResolveComment,
    };
};
