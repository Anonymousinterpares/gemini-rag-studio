import { FC, useState } from 'react';
import { Trash2, Edit2, CheckCircle, X } from 'lucide-react';
import { CaseFileComment as CaseFileCommentType } from '../../types';

interface Props {
    comment: CaseFileCommentType;
    sectionId: string;
    isResolving: boolean;
    onEdit: (sectionId: string, commentId: string, newInstruction: string) => void;
    onDelete: (sectionId: string, commentId: string) => void;
    onResolve: (sectionId: string, commentId: string) => void;
}

export const CaseFileCommentItem: FC<Props> = ({
    comment, sectionId, isResolving, onEdit, onDelete, onResolve
}) => {
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState(comment.instruction);

    const handleSaveEdit = () => {
        if (editValue.trim()) {
            onEdit(sectionId, comment.id, editValue.trim());
        }
        setEditing(false);
    };

    return (
        <div className='cf-comment-bubble'>
            {comment.selectedText && (
                <div className='cf-comment-selected-text'>
                    "{comment.selectedText.length > 120
                        ? comment.selectedText.slice(0, 120) + '…'
                        : comment.selectedText}"
                </div>
            )}

            {editing ? (
                <div className='cf-comment-edit-area'>
                    <textarea
                        className='cf-comment-edit-textarea'
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
                            if (e.key === 'Escape') { setEditing(false); setEditValue(comment.instruction); }
                        }}
                    />
                    <div className='cf-comment-actions'>
                        <button className='button' onClick={handleSaveEdit} disabled={!editValue.trim()}>
                            <CheckCircle size={13} /> Save
                        </button>
                        <button className='button secondary' onClick={() => { setEditing(false); setEditValue(comment.instruction); }}>
                            <X size={13} /> Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <div className='cf-comment-header'>
                    <span className='cf-comment-instruction'>{comment.instruction}</span>
                    <div className='cf-comment-actions'>
                        <button
                            className='button secondary'
                            title='Resolve with LLM – rewrites the full section'
                            disabled={isResolving}
                            onClick={() => onResolve(sectionId, comment.id)}
                        >
                            {isResolving
                                ? <><span className='cf-spinner' /> Resolving…</>
                                : '✨ Resolve'}
                        </button>
                        <button
                            className='button secondary'
                            title='Edit comment'
                            disabled={isResolving}
                            onClick={() => { setEditing(true); setEditValue(comment.instruction); }}
                        >
                            <Edit2 size={13} />
                        </button>
                        <button
                            className='button secondary'
                            title='Delete comment'
                            disabled={isResolving}
                            onClick={() => onDelete(sectionId, comment.id)}
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
