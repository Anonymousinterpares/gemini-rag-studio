import { FC, useState } from 'react';
import { marked } from 'marked';
import { MessageSquarePlus } from 'lucide-react';
import { CaseFileSection as CaseFileSectionType } from '../../types';
import { CaseFileCommentItem } from './CaseFileCommentItem';

interface Props {
    section: CaseFileSectionType;
    resolvingCommentId: string | null;
    onEditComment: (sectionId: string, commentId: string, newInstruction: string) => void;
    onDeleteComment: (sectionId: string, commentId: string) => void;
    onResolveComment: (sectionId: string, commentId: string) => void;
    /** Called when user clicks the "Add Comment" button on the section (no selection needed) */
    onAddSectionComment?: (sectionId: string, instruction: string) => void;
}

export const CaseFileSectionBlock: FC<Props> = ({
    section, resolvingCommentId,
    onEditComment, onDeleteComment, onResolveComment, onAddSectionComment
}) => {
    const [showCommentForm, setShowCommentForm] = useState(false);
    const [instruction, setInstruction] = useState('');

    // --- Markdown renderer (same as chat) ---
    const renderer = new marked.Renderer();
    const originalLink = renderer.link.bind(renderer);
    renderer.link = (href, title, text) => {
        const html = originalLink(href, title, text);
        return html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
    };
    const html = marked.parse(section.content, { renderer, gfm: true, breaks: true }) as string;

    const handleSubmitComment = () => {
        if (!instruction.trim() || !onAddSectionComment) return;
        onAddSectionComment(section.id, instruction.trim());
        setInstruction('');
        setShowCommentForm(false);
    };

    return (
        <div className='cf-section' data-section-id={section.id}>
            {/* Rendered markdown */}
            <div
                className='cf-section-content'
                dangerouslySetInnerHTML={{ __html: html }}
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

            {/* Comment toolbar – always visible at the bottom of each section */}
            <div className='cf-section-toolbar'>
                {showCommentForm ? (
                    <div className='cf-inline-comment-form'>
                        <textarea
                            className='cf-comment-edit-textarea'
                            autoFocus
                            rows={3}
                            placeholder='Instruct the LLM to rewrite this section… (Shift+Enter for newline)'
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
                        title='Add a comment to this section – the LLM will rewrite the whole section based on your instruction'
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
