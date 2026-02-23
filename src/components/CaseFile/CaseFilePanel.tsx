import { FC, useEffect, useCallback } from 'react';
import { Save, Edit2, X } from 'lucide-react';
import { CaseFile, CaseFileComment } from '../../types';
import { useCaseFileComments } from '../../hooks/useCaseFileComments';
import { CaseFileSectionBlock } from './CaseFileSectionBlock';
import { useCaseFileStore } from '../../store/useCaseFileStore';
import { useCaseFileIO } from '../../hooks/useCaseFileIO';
import './CaseFilePanel.css';

interface CaseFilePanelProps {
    onResolveComment: (
        caseFile: CaseFile,
        sectionId: string,
        comment: CaseFileComment
    ) => Promise<void>;
    /** Same renderModelMessage from useChat – ensures identical markdown rendering to the chat bubble */
    renderModelMessage: (content: string) => { __html: string };
}

export const CaseFilePanel: FC<CaseFilePanelProps> = ({ onResolveComment, renderModelMessage }) => {
    const {
        caseFile, isOverlayOpen, setOverlayOpen, addComment, _fileHandle
    } = useCaseFileStore();
    const { handleSaveCaseFile, handleSaveAsCaseFile } = useCaseFileIO();

    const handleClose = useCallback(() => setOverlayOpen(false), [setOverlayOpen]);

    // Escape key to close
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleClose]);

    const {
        selectionPopover, setSelectionPopover,
        commentDraft, setCommentDraft,
        resolvingCommentId,
        handleMouseUp,
        handleOpenCommentInput,
        handleAddComment,
        handleEditComment,
        handleDeleteComment,
        handleResolveComment,
    } = useCaseFileComments(
        async (file, sectionId, comment) => {
            await onResolveComment(file, sectionId, comment);
        }
    );

    // Handler for the per-section "Add Comment" button (no text selection required)
    const handleAddSectionComment = useCallback((sectionId: string, instruction: string) => {
        if (!caseFile || !instruction.trim()) return;
        const comment: CaseFileComment = {
            id: `cfc-${Date.now()}`,
            sectionId,
            selectedText: '',   // no selection — whole section is the context
            instruction: instruction.trim(),
            createdAt: Date.now(),
        };
        addComment(sectionId, comment);
        // Schedule auto-save
        handleSaveCaseFile();
    }, [caseFile, addComment, handleSaveCaseFile]);

    if (!isOverlayOpen || !caseFile) return null;

    return (
        <div className='cf-overlay' onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
            <div className='cf-panel' role='dialog' aria-modal='true' aria-label={caseFile.title}>

                {/* ── Header ── */}
                <div className='cf-header'>
                    <h2>{caseFile.title}</h2>
                    <div className='cf-header-actions'>
                        <button
                            className='button secondary'
                            title={_fileHandle ? `Save – overwrite ${_fileHandle.name}` : 'Save case file'}
                            onClick={() => handleSaveCaseFile()}
                        >
                            <Save size={15} /> Save
                        </button>
                        <button
                            className='button secondary'
                            title='Save a copy under a different file name'
                            onClick={() => handleSaveAsCaseFile()}
                        >
                            <Save size={15} /> Save As…
                        </button>
                        <button className='cf-close-btn' title='Close (Escape)' onClick={handleClose}>
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* ── Hint bar ── */}
                <div className='cf-hint-bar'>
                    💡 <strong>Tip:</strong> Use the <em>Add Comment</em> button on any section to instruct the LLM to rewrite it. You can also <em>select text</em> to add targeted comments.
                </div>

                {/* ── Body ── */}
                <div className='cf-body' onMouseUp={handleMouseUp}>
                    {caseFile.sections.map((section) => (
                        <CaseFileSectionBlock
                            key={section.id}
                            section={section}
                            resolvingCommentId={resolvingCommentId}
                            onEditComment={handleEditComment}
                            onDeleteComment={handleDeleteComment}
                            onResolveComment={handleResolveComment}
                            onAddSectionComment={handleAddSectionComment}
                            renderFn={renderModelMessage}
                        />
                    ))}
                </div>

                {/* ── Selection popover (text-highlight shortcut) ── */}
                {selectionPopover && (
                    <div
                        className='cf-selection-popover'
                        style={{ top: selectionPopover.top, left: selectionPopover.left }}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        {selectionPopover.commentInputOpen ? (
                            <div className='cf-selection-popover-form'>
                                <div className='cf-selection-popover-preview'>
                                    Selected: <em>"{selectionPopover.selectedText.slice(0, 80)}{selectionPopover.selectedText.length > 80 ? '…' : ''}"</em>
                                </div>
                                <textarea
                                    className='cf-selection-popover-textarea'
                                    autoFocus
                                    placeholder='Instruction for the LLM — will rewrite the FULL section…'
                                    value={commentDraft}
                                    onChange={(e) => setCommentDraft(e.target.value)}
                                    rows={3}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleAddComment(selectionPopover.sectionId, selectionPopover.selectedText, commentDraft);
                                        }
                                        if (e.key === 'Escape') setCommentDraft('');
                                    }}
                                />
                                <div className='cf-selection-popover-actions'>
                                    <button
                                        className='button'
                                        onClick={() => handleAddComment(selectionPopover.sectionId, selectionPopover.selectedText, commentDraft)}
                                        disabled={!commentDraft.trim()}
                                    >
                                        Add Comment
                                    </button>
                                    <button className='button secondary' onClick={() => setSelectionPopover(null)}>
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button className='cf-selection-popover-btn' onClick={handleOpenCommentInput}>
                                <Edit2 size={14} /> Comment on Selection
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export type { CaseFilePanelProps };
