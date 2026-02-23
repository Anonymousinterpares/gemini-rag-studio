import { FC, useEffect, useCallback, useState } from 'react';
import { Save, Edit2, X, FileText, Network, Maximize2, Minimize2 } from 'lucide-react';
import { CaseFile, CaseFileComment } from '../../types';
import { useCaseFileComments } from '../../hooks/useCaseFileComments';
import { CaseFileSectionBlock } from './CaseFileSectionBlock';
import { InvestigationMapCanvas } from './InvestigationMap/InvestigationMapCanvas';
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

    const [activeView, setActiveView] = useState<'document' | 'map'>('document');
    const [isMaximized, setIsMaximized] = useState(false);

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

    const panelStyle: React.CSSProperties = isMaximized
        ? { width: '100vw', height: '100vh', maxHeight: '100vh', borderRadius: 0 }
        : { height: activeView === 'map' ? '85vh' : undefined };

    return (
        <div className='cf-overlay' onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
            <div className='cf-panel' role='dialog' aria-modal='true' aria-label={caseFile.title} style={panelStyle}>

                {/* ── Header ── */}
                <div className='cf-header'>
                    <h2>{caseFile.title}</h2>
                    <div className='cf-view-toggle' style={{ display: 'flex', gap: '8px', background: 'var(--input-bg-color)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <button
                            className={`button ${activeView === 'document' ? '' : 'secondary'}`}
                            onClick={() => setActiveView('document')}
                            style={{ padding: '6px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            <FileText size={14} /> Document
                        </button>
                        <button
                            className={`button ${activeView === 'map' ? '' : 'secondary'}`}
                            onClick={() => setActiveView('map')}
                            style={{ padding: '6px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            <Network size={14} /> Map
                        </button>
                    </div>
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
                        <button
                            className='cf-close-btn'
                            title={isMaximized ? 'Restore Down' : 'Maximize'}
                            onClick={() => setIsMaximized(!isMaximized)}
                        >
                            {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
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
                {activeView === 'document' ? (
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
                ) : (
                    <div className='cf-body' style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <InvestigationMapCanvas />
                    </div>
                )}

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
