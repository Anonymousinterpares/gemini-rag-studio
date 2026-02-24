import { FC, useState } from 'react';
import { Plus, Check, X } from 'lucide-react';
import { CaseFileSection as CaseFileSectionType } from '../../types';
import { CaseFileCommentItem } from './CaseFileCommentItem';
import { useDiffRenderer } from '../../hooks/useDiffRenderer';
import { useCaseFileStore } from '../../store/useCaseFileStore';

interface Props {
    section: CaseFileSectionType;
    resolvingCommentId: string | null;
    onEditComment: (sectionId: string, commentId: string, newInstruction: string) => void;
    onDeleteComment: (sectionId: string, commentId: string) => void;
    onResolveComment: (sectionId: string, commentId: string) => void;
    onAddSectionComment?: (sectionId: string, instruction: string) => void;
    /**
     * The same renderModelMessage function from useChat – ensures Source citations,
     * selection highlights, and all markdown processing are identical to the chat.
     */
    renderFn: (content: string) => { __html: string };
}

export const CaseFileSectionBlock: FC<Props> = ({
    section, resolvingCommentId,
    onEditComment, onDeleteComment, onResolveComment, onAddSectionComment, renderFn
}) => {
    const [showCommentForm, setShowCommentForm] = useState(false);
    const [instruction, setInstruction] = useState('');
    const [isHovered, setIsHovered] = useState(false);

    const { acceptProposedContent, rejectProposedContent } = useCaseFileStore();
    const renderedDiff = useDiffRenderer(section.content || '', section.proposedContent || '');

    const handleSubmitComment = () => {
        if (!instruction.trim() || !onAddSectionComment) return;
        onAddSectionComment(section.id, instruction.trim());
        setInstruction('');
        setShowCommentForm(false);
    };

    return (
        <div
            className='cf-section'
            data-section-id={section.id}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{ position: 'relative' }}
        >
            {isHovered && !showCommentForm && !section.proposedContent && (
                <button
                    className='icon-btn'
                    title='Instruct the LLM to rewrite this section'
                    onClick={() => setShowCommentForm(true)}
                    style={{ position: 'absolute', top: '8px', right: '8px', background: '#8e44ad', color: 'white', border: 'none', borderRadius: '4px', padding: '4px', zIndex: 10 }}
                >
                    <Plus size={14} />
                </button>
            )}

            {section.proposedContent ? (
                <div>
                    <div style={{ fontWeight: 'bold', fontSize: '0.85rem', color: 'var(--warning-orange)', marginBottom: '8px' }}>
                        Proposed Changes:
                    </div>
                    <div
                        className='cf-section-content proposed-diff'
                        style={{ background: 'rgba(255, 255, 0, 0.05)', border: '1px dotted rgba(255,255,0,0.3)', padding: '10px', borderRadius: '4px' }}
                    >
                        {renderedDiff}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
                        <button className="button" style={{ background: '#10b981', color: 'white', border: 'none' }} onClick={() => acceptProposedContent(section.id)}>
                            <Check size={14} style={{ marginRight: '4px' }} /> Accept
                        </button>
                        <button className="button secondary" onClick={() => rejectProposedContent(section.id)}>
                            <X size={14} style={{ marginRight: '4px' }} /> Reject
                        </button>
                    </div>
                </div>
            ) : (
                <div
                    className='cf-section-content'
                    dangerouslySetInnerHTML={renderFn(section.content)}
                />
            )}

            {/* Comments attached to this section */}
            {section.comments.length > 0 && (
                <div className='cf-comments-area'>
                    {section.comments.map(c => (
                        <CaseFileCommentItem
                            key={c.id}
                            comment={c}
                            sectionId={section.id}
                            isResolving={resolvingCommentId === c.id}
                            onEdit={onEditComment}
                            onDelete={onDeleteComment}
                            onResolve={onResolveComment}
                        />
                    ))}
                </div>
            )}

            {/* Inline comment toolbar */}
            {showCommentForm && (
                <div className='cf-section-toolbar'>
                    <div className='cf-inline-comment-form'>
                        <textarea
                            className='cf-comment-edit-textarea'
                            autoFocus
                            rows={3}
                            placeholder='Instruct the LLM to rewrite this section… (Shift+Enter for newline, Enter to submit)'
                            value={instruction}
                            onChange={e => setInstruction(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitComment(); }
                                if (e.key === 'Escape') { setShowCommentForm(false); setInstruction(''); }
                            }}
                        />
                        <div className='cf-comment-actions'>
                            <button className='button' onClick={handleSubmitComment} disabled={!instruction.trim()}>
                                Save Comment
                            </button>
                            <button className='button secondary' onClick={() => { setShowCommentForm(false); setInstruction(''); }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
