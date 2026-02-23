import { FC, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { CaseFileSection as CaseFileSectionType } from '../../types';
import { CaseFileCommentItem } from './CaseFileCommentItem';

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

    const handleSubmitComment = () => {
        if (!instruction.trim() || !onAddSectionComment) return;
        onAddSectionComment(section.id, instruction.trim());
        setInstruction('');
        setShowCommentForm(false);
    };

    return (
        <div className='cf-section' data-section-id={section.id}>

            {/* Rendered markdown – identical pipeline to chat bubble */}
            <div
                className='cf-section-content'
                dangerouslySetInnerHTML={renderFn(section.content)}
            />

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

            {/* Always-visible comment toolbar */}
            <div className='cf-section-toolbar'>
                {showCommentForm ? (
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
                ) : (
                    <button
                        className='cf-add-comment-btn'
                        title='Add a comment – the LLM will rewrite the whole section based on your instruction'
                        onClick={() => setShowCommentForm(true)}
                    >
                        <MessageSquarePlus size={14} />
                        Add Comment
                    </button>
                )}
            </div>
        </div>
    );
};
