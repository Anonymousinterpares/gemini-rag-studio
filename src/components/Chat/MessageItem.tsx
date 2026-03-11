import { FC, useState, useEffect } from 'react';
import { Bot, User, Check, XCircle, Trash2, RefreshCw, Edit2, Copy, Download, FolderOpen, Plus, Network, Loader } from 'lucide-react';
import { ChatMessage } from '../../types';
import { sectionizeMessage, CITATION_REGEX } from '../../utils/chatUtils';
import { DownloadReportButton } from '../DownloadReportButton';
import { useDiffRenderer } from '../../hooks/useDiffRenderer';

const MessageSectionDiff: FC<{ originalContent: string; proposedContent: string; }> = ({ originalContent, proposedContent }) => {
    const renderedDiff = useDiffRenderer(originalContent, proposedContent);
    return <>{renderedDiff}</>;
};

export interface MessageItemHandlers {
    handleSaveAndRerun: (idx: number) => void;
    handleCancelEdit: () => void;
    handleUpdateMessage: (idx: number, update: Partial<ChatMessage>) => void;
    submitQuery: (query: string, history: ChatMessage[]) => void;
    handleRejectAllEdits: (idx: number) => void;
    handleConfirmAllEdits: (idx: number) => void;
    handleConfirmEdit: (idx: number, sectionId: string) => void;
    handleRejectEdit: (idx: number, sectionId: string) => void;
    renderModelMessage: (
        content: string,
        fullContent?: string | null,
        selectionComments?: import('../../types').SelectionComment[],
        hoveredSelectionId?: string | null,
        sharedDocNumbers?: Map<string, number>,
        sharedNextDocNumber?: { current: number }
    ) => { __html: string };
    setHoveredSelectionId: (id: string | null) => void;
    resendWithComments: (idx: number) => void;
    handleStartComment: (idx: number, sectionId: string) => void;
    handleAddComment: (idx: number, sectionId: string) => void;
    handleEditComment: (idx: number, sectionId: string, text: string) => void;
    handleDeleteComment: (idx: number, sectionId: string) => void;
    handleDeleteSelectionComment: (idx: number, id: string) => void;
    setActiveCommentInput: (input: { msgIndex: number, sectionId: string } | null) => void;
    setCommentText: (text: string) => void;
    handleCopy: (idx: number) => void;
    handleDownloadAction: (idx: number) => void;
    handleStartEdit: (idx: number, content: string) => void;
    handleRedo: (idx: number) => void;
    handleRemoveMessage: (idx: number) => void;
    handleMouseUp: (idx: number) => () => void;
    handleSourceClick: (e: React.MouseEvent<HTMLDivElement>) => void;
    /** Parse the case_file_report message content and open it in the overlay */
    onOpenInCaseFile: (content: string, title?: string) => void;
    /** Triggers a map update using this message's content as instructions */
    onUpdateMapFromMessage?: (content: string) => void;
    /** True if a map update is currently running */
    isMapProcessing?: boolean;
}

interface MessageItemProps {
    msg: ChatMessage;
    i: number;
    isLast: boolean;
    appSettings: import('../../config').AppSettings;
    isLoading: boolean;
    isEmbedding: boolean;
    editingIndex: number | null;
    editingContent: string;
    setEditingContent: (c: string) => void;
    activeCommentInput: { msgIndex: number, sectionId: string } | null;
    commentText: string;
    hoveredSelectionId: string | null;
    rootDirectoryHandle: FileSystemDirectoryHandle | null;
    chatHistory: ChatMessage[];
    handlers: MessageItemHandlers;
}

export const MessageItem: FC<MessageItemProps> = ({
    msg, i, isLast, appSettings, isLoading, isEmbedding, editingIndex, editingContent, setEditingContent,
    activeCommentInput, commentText, hoveredSelectionId, rootDirectoryHandle, chatHistory, handlers
}) => {
    // Typewriter effect state
    const [displayLength, setDisplayLength] = useState(() => (msg.isStreaming && msg.role === 'model') ? 0 : (msg.content?.length || 0));
    const [isTyping, setIsTyping] = useState(!!msg.isStreaming);

    useEffect(() => {
        if (msg.isStreaming && msg.role === 'model' && msg.content && displayLength < msg.content.length) {
            setIsTyping(true);
        } else if (!msg.isStreaming) {
            setDisplayLength(msg.content?.length || 0);
            setIsTyping(false);
        }
    }, [msg.isStreaming, msg.content, msg.role, displayLength]);

    // SEPARATE EFFECT: Handle the "Finished Streaming" state change to avoid React warnings
    useEffect(() => {
        if (msg.isStreaming && displayLength >= (msg.content?.length || 0)) {
            // Wait for next tick to ensure we're not in middle of a render
            const t = setTimeout(() => {
                if (handlers.handleUpdateMessage) {
                    handlers.handleUpdateMessage(i, { isStreaming: false });
                    setIsTyping(false);
                }
            }, 0);
            return () => clearTimeout(t);
        }
    }, [displayLength, msg.content, msg.isStreaming, i, handlers]);

    useEffect(() => {
        if (isTyping && msg.content && msg.isStreaming) {
            const interval = setInterval(() => {
                setDisplayLength(prev => {
                    const content = msg.content!;
                    if (prev >= content.length) {
                        clearInterval(interval);
                        return content.length;
                    }

                    // Look ahead for "Atomic Blocks": Citations, Metadata, Markdown Links, Bold/Italic
                    // We specifically include the search results metadata comment here.
                    const SEARCH_METADATA_PATTERN = '<!--searchResults:[\\s\\S]*?-->';
                    const ATOMIC_BLOCK_REGEX = new RegExp(`${SEARCH_METADATA_PATTERN}|${CITATION_REGEX.source}|(\\[.*?\\]\\(.*?\\))|(\\*+.*?\\*+)|(\`+.*?\`+)`, 'gi');
                    
                    let nextIdx = prev;
                    
                    // 1. Determine base jump (standard word)
                    const nextSpace = content.indexOf(' ', prev + 1);
                    const nextNewline = content.indexOf('\n', prev + 1);
                    let baseNext = content.length;
                    if (nextSpace !== -1 && nextSpace < baseNext) baseNext = nextSpace;
                    if (nextNewline !== -1 && nextNewline < baseNext) baseNext = nextNewline;
                    if (baseNext < content.length) baseNext++; // Include the space/newline

                    nextIdx = baseNext;

                    // 2. Atomic Look-ahead
                    ATOMIC_BLOCK_REGEX.lastIndex = 0;
                    let match;
                    while ((match = ATOMIC_BLOCK_REGEX.exec(content)) !== null) {
                        const start = match.index;
                        const end = start + match[0].length;

                        if (prev >= start && prev < end) {
                            return end;
                        }
                        if (start >= prev && start < nextIdx) {
                            return end; 
                        }
                    }

                    return nextIdx;
                });
            }, 15);
            return () => clearInterval(interval);
        }
    }, [isTyping, msg.content, msg.isStreaming, i]);

    const activeContent = (msg.isStreaming && isTyping)
        ? (msg.content || '').substring(0, displayLength)
        : msg.content;

    return (
        <div className={`message-container ${msg.role}`} onMouseUp={handlers.handleMouseUp(i)}>
            <div className={`chat-message ${msg.role} bubble-${appSettings.chatBubbleColor}`}>
                <div className='avatar'>{msg.role === 'model' ? <Bot size={20} /> : <User size={20} />}</div>
                <div className='message-content'>
                    {editingIndex === i ? (
                        <div className="edit-message-area">
                            <textarea
                                className="edit-message-textarea"
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                autoFocus
                            />
                            <div className="edit-message-actions">
                                <button onClick={() => handlers.handleSaveAndRerun(i)} title="Save and Rerun"><Check size={14} /></button>
                                <button onClick={handlers.handleCancelEdit} title="Cancel"><XCircle size={14} /></button>
                            </div>
                        </div>
                    ) : (
                        <div className="message-row">
                            <div className="message-main-content">
                                {msg.role === 'model' ? (() => {
                                    const sections = (isLast && msg.role === 'model' && isTyping)
                                        ? sectionizeMessage(activeContent || '')
                                        : (msg.sections || sectionizeMessage(msg.content || ''));

                                    const docNumbers = new Map<string, number>();
                                    const nextDocNumber = { current: 1 };

                                    return (
                                        <div className='message-markup' onClick={handlers.handleSourceClick}>
                                            {msg.pendingEdits?.some(e => e.sectionId === 'REWRITE') ? (
                                                <div className="message-section-row">
                                                    <div className="message-main-content">
                                                        <div className="message-section highlight-pending">
                                                            <div style={{ fontWeight: 'bold', borderBottom: '1px solid var(--border-color)', marginBottom: '0.5rem', paddingBottom: '0.25rem' }}>FULL REWRITE REQUEST:</div>
                                                            <p>{msg.pendingEdits.find(e => e.sectionId === 'REWRITE')?.newContent}</p>
                                                            <div className="edit-actions-floating" style={{ marginTop: '1rem' }}>
                                                                <button className="button" onClick={() => {
                                                                    handlers.handleUpdateMessage(i, { pendingEdits: [] });
                                                                    handlers.submitQuery("Please perform the full rewrite as you suggested.", chatHistory.slice(0, i + 1));
                                                                }}>Confirm Rewrite</button>
                                                                <button className="button secondary" onClick={() => handlers.handleRejectAllEdits(i)}>Reject Rewrite</button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="section-comment-area" />
                                                </div>
                                            ) : sections.map((section) => {
                                                const pendingEdit = msg.pendingEdits?.find(e => e.sectionId === section.id);
                                                const isActiveInput = activeCommentInput?.msgIndex === i && activeCommentInput?.sectionId === section.id;

                                                return (
                                                    <div key={section.id} className="message-section-row" data-section-id={section.id}>
                                                        <div className="message-main-content">
                                                            <div className="message-section-wrapper">
                                                                <div className={`message-section ${pendingEdit ? 'highlight-pending' : ''}`}>
                                                                    <div dangerouslySetInnerHTML={handlers.renderModelMessage(
                                                                        section.content,
                                                                        msg.content,
                                                                        msg.selectionComments?.filter(sc => sc.sectionId === section.id),
                                                                        hoveredSelectionId,
                                                                        docNumbers,
                                                                        nextDocNumber
                                                                    )} />
                                                                    {pendingEdit && (() => {
                                                                        let previewContent: string | null = null;
                                                                        if (pendingEdit.tableEdit) {
                                                                            previewContent = `*Row ${pendingEdit.tableEdit.rowIndex + 1} update:* | ${pendingEdit.tableEdit.cells.join(' | ')} |`;
                                                                        } else if (pendingEdit.newContent != null) {
                                                                            previewContent = pendingEdit.newContent;
                                                                        }
                                                                        return previewContent ? (
                                                                            <div className="pending-edit-preview">
                                                                                <div style={{ fontWeight: 'bold', fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--warning-orange)' }}>PROPOSED CHANGE (Diff):</div>
                                                                                <div
                                                                                    className="cf-section-content proposed-diff"
                                                                                    style={{ background: 'rgba(255, 255, 0, 0.05)', border: '1px dotted rgba(255,255,0,0.3)', padding: '10px', borderRadius: '4px', marginTop: '8px' }}
                                                                                >
                                                                                    <MessageSectionDiff originalContent={section.content} proposedContent={previewContent} />
                                                                                </div>
                                                                                <div className="edit-actions-floating">
                                                                                    <button className="button btn-confirm-edit" onClick={() => handlers.handleConfirmEdit(i, section.id)} title="Confirm Change"><Check size={12} /> Confirm</button>
                                                                                    <button className="button btn-reject-edit" onClick={() => handlers.handleRejectEdit(i, section.id)} title="Reject Change"><XCircle size={12} /> Reject</button>
                                                                                </div>
                                                                            </div>
                                                                        ) : null;
                                                                    })()}
                                                                </div>
                                                                {!pendingEdit && (
                                                                    <button className="add-comment-trigger" onClick={() => handlers.handleStartComment(i, section.id)} title="Add Comment"><Plus size={14} /></button>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="section-comment-area">
                                                            {msg.selectionComments && msg.selectionComments.length > 0 &&
                                                                msg.selectionComments.filter(sc => sc.sectionId === section.id).map(sc => (
                                                                    <div
                                                                        key={sc.id}
                                                                        className="comment-box"
                                                                        style={{ borderLeft: '3px solid #8e44ad', marginBottom: '0.5rem' }}
                                                                        onMouseEnter={() => handlers.setHoveredSelectionId(sc.id)}
                                                                        onMouseLeave={() => handlers.setHoveredSelectionId(null)}
                                                                    >
                                                                        <div className="selection-comment-sidebar-text">"{sc.text}"</div>
                                                                        <div className="comment-content">{sc.comment}</div>
                                                                        <div className="comment-actions">
                                                                            <button onClick={() => handlers.handleDeleteSelectionComment(i, sc.id)} title="Delete"><Trash2 size={12} /></button>
                                                                            <button
                                                                                className="button resend-with-comments-btn-mini"
                                                                                onClick={() => handlers.resendWithComments(i)}
                                                                                title="Resend entire message with all comments"
                                                                                disabled={isLoading}
                                                                            >
                                                                                <RefreshCw size={12} /> Resend
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ))}

                                                            {(section.comment || isActiveInput) && (
                                                                <div className="comment-box">
                                                                    {isActiveInput ? (
                                                                        <div className="comment-input-overlay">
                                                                            <textarea
                                                                                className="comment-textarea"
                                                                                value={commentText}
                                                                                onChange={(e) => handlers.setCommentText(e.target.value)}
                                                                                placeholder="Type your comment here..."
                                                                                autoFocus
                                                                            />
                                                                            <div className="comment-actions">
                                                                                <button className="button" onClick={() => handlers.handleAddComment(i, section.id)}>
                                                                                    {section.isEditingComment ? 'Save' : 'Add Comment'}
                                                                                </button>
                                                                                <button className="button secondary" onClick={() => handlers.setActiveCommentInput(null)}>Cancel</button>
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <>
                                                                            <div className="comment-content">{section.comment}</div>
                                                                            <div className="comment-actions">
                                                                                <button onClick={() => handlers.handleEditComment(i, section.id, section.comment || '')} title="Edit"><Edit2 size={12} /></button>
                                                                                <button onClick={() => handlers.handleDeleteComment(i, section.id)} title="Delete"><Trash2 size={12} /></button>
                                                                                <button
                                                                                    className="button resend-with-comments-btn-mini"
                                                                                    onClick={() => handlers.resendWithComments(i)}
                                                                                    title="Resend entire message with all comments"
                                                                                    disabled={isLoading}
                                                                                >
                                                                                    <RefreshCw size={12} /> Resend
                                                                                </button>
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            <div className="message-section-row">
                                                <div className="message-main-content">
                                                    {msg.pendingEdits && msg.pendingEdits.length > 0 && (
                                                        <div className="edit-message-actions" style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
                                                            <button onClick={() => handlers.handleConfirmAllEdits(i)} className="button">Confirm All Edits</button>
                                                            <button onClick={() => handlers.handleRejectAllEdits(i)} className="button secondary">Reject All Edits</button>
                                                        </div>
                                                    )}
                                                    {(sections.some(s => s.comment) || (msg.selectionComments && msg.selectionComments.length > 0)) && isLast && (
                                                        <button className="button resend-with-comments-btn" onClick={() => handlers.resendWithComments(i)}>
                                                            <RefreshCw size={14} style={{ marginRight: '6px' }} /> Resend with Comments
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="section-comment-area" />
                                            </div>
                                        </div>
                                    );
                                })() : msg.content}
                                {msg.content && (msg.type === 'case_file_report' || msg.content.startsWith('# Case File')) && (
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                                        <DownloadReportButton content={msg.content} index={i} rootDirectoryHandle={rootDirectoryHandle} />
                                        <button
                                            className='button secondary'
                                            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}
                                            title='Parse this report and open it in the Case File overlay'
                                            onClick={() => handlers.onOpenInCaseFile(
                                                msg.content || '',
                                                msg.content?.match(/^#+ ([^\n]+)/)?.[1] ?? 'Case File'
                                            )}
                                        >
                                            <FolderOpen size={14} /> Open in Case File
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
                <div className="message-actions">
                    <div className="message-actions-inner">
                        <button onClick={() => handlers.handleCopy(i)} title="Copy"><Copy size={14} /></button>
                        <button onClick={() => handlers.handleDownloadAction(i)} title="Download"><Download size={14} /></button>
                        {msg.role === 'model' && handlers.onUpdateMapFromMessage && (
                            <button
                                onClick={() => handlers.onUpdateMapFromMessage!(msg.content || '')}
                                title="Update Investigation Map from this message"
                                disabled={handlers.isMapProcessing || !msg.content}
                            >
                                {handlers.isMapProcessing ? <Loader size={14} className="animate-spin" /> : <Network size={14} />}
                            </button>
                        )}
                        {msg.role === 'user' && editingIndex !== i && (
                            <>
                                <button onClick={() => handlers.handleStartEdit(i, msg.content || '')} title="Edit"><Edit2 size={14} /></button>
                                <button onClick={() => handlers.handleRedo(i)} disabled={isLoading || isEmbedding} title="Redo"><RefreshCw size={14} /></button>
                            </>
                        )}
                        <button onClick={() => handlers.handleRemoveMessage(i)} title="Remove"><Trash2 size={14} /></button>
                    </div>
                </div>
            </div>
        </div>
    );
};
