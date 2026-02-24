import { FC, useState, useRef, useEffect } from 'react';
import { History, Plus, Trash2, Check, X } from 'lucide-react';
import { useChatStore } from '../../store/useChatStore';
import { useChatHistoryIO } from '../../hooks/useChatHistoryIO';

export const ChatHistoryDropdown: FC = () => {
    const { sessionList, activeSessionId } = useChatStore();
    const { createNewSession, switchSession, deleteSession, renameSession } = useChatHistoryIO();

    const [isOpen, setIsOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setEditingId(null);
                setConfirmDeleteId(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleStartRename = (id: string, currentTitle: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(id);
        setEditTitle(currentTitle);
    };

    const handleCommitRename = async (id: string) => {
        if (editTitle.trim() && editTitle !== sessionList.find(s => s.id === id)?.title) {
            await renameSession(id, editTitle.trim());
        }
        setEditingId(null);
    };

    const handleKeyDownRename = (e: React.KeyboardEvent, id: string) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleCommitRename(id);
        } else if (e.key === 'Escape') {
            setEditingId(null);
        }
    };

    const handleSwitch = (id: string) => {
        switchSession(id);
        setIsOpen(false);
    };

    const timeAgo = (dateInput: number) => {
        const diffInSeconds = Math.floor((Date.now() - dateInput) / 1000);
        if (diffInSeconds < 60) return `just now`;
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} mins ago`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hrs ago`;
        return `${Math.floor(diffInSeconds / 86400)} days ago`;
    };

    const activeSession = sessionList.find(s => s.id === activeSessionId);
    const recentSessions = sessionList.filter(s => s.id !== activeSessionId).slice(0, 5);
    const olderSessions = sessionList.filter(s => s.id !== activeSessionId).slice(5);

    return (
        <div className="chat-history-container" style={{ display: 'flex', gap: '4px', alignItems: 'center' }} ref={dropdownRef}>
            <button
                className="icon-btn"
                onClick={() => { createNewSession(); setIsOpen(false); }}
                title="Start a New Conversation (Ctrl+Shift+L)"
            >
                <Plus size={16} />
            </button>
            <div className="chat-history-dropdown-container">
                <button
                    className={`icon-btn chat-history-trigger ${isOpen ? 'active' : ''}`}
                    onClick={() => setIsOpen(!isOpen)}
                    title="Chat History"
                >
                    <History size={16} />
                </button>

                {isOpen && (
                    <div className="chat-history-quick-pick">
                        <div className="chat-history-qp-header">
                            <input type="text" placeholder="Select a conversation" readOnly className="chat-history-qp-input" />
                        </div>

                        <div className="chat-history-qp-body">
                            {/* Current */}
                            {activeSession && (
                                <div className="chat-history-qp-section">
                                    <div className="chat-history-qp-section-title">Current</div>
                                    <div className="chat-history-qp-item active">
                                        <div className="chat-history-qp-item-title" title="Double-click to rename" onDoubleClick={(e) => handleStartRename(activeSession.id, activeSession.title, e)}>
                                            {editingId === activeSession.id ? (
                                                <input autoFocus value={editTitle} onChange={e => setEditTitle(e.target.value)} onBlur={() => handleCommitRename(activeSession.id)} onKeyDown={(e) => handleKeyDownRename(e, activeSession.id)} onClick={e => e.stopPropagation()} className="chat-history-rename-input" />
                                            ) : activeSession.title}
                                        </div>
                                        <div className="chat-history-qp-meta">
                                            <span>{timeAgo(activeSession.updatedAt)}</span>
                                            {confirmDeleteId === activeSession.id ? (
                                                <>
                                                    <button className="icon-btn action-check" onClick={(e) => { e.stopPropagation(); deleteSession(activeSession.id); setConfirmDeleteId(null); }} title="Confirm Delete"><Check size={14} /></button>
                                                    <button className="icon-btn action-x" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }} title="Cancel"><X size={14} /></button>
                                                </>
                                            ) : (
                                                <button className="icon-btn delete" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(activeSession.id); }} title="Delete"><Trash2 size={14} /></button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Recent */}
                            {recentSessions.length > 0 && (
                                <div className="chat-history-qp-section">
                                    <div className="chat-history-qp-section-title">Recent in RAG Studio</div>
                                    {recentSessions.map(session => (
                                        <div key={session.id} className="chat-history-qp-item" onClick={() => handleSwitch(session.id)}>
                                            <div className="chat-history-qp-item-title" title="Double-click to rename" onDoubleClick={(e) => handleStartRename(session.id, session.title, e)}>
                                                {editingId === session.id ? (
                                                    <input autoFocus value={editTitle} onChange={e => setEditTitle(e.target.value)} onBlur={() => handleCommitRename(session.id)} onKeyDown={(e) => handleKeyDownRename(e, session.id)} onClick={e => e.stopPropagation()} className="chat-history-rename-input" />
                                                ) : session.title}
                                            </div>
                                            <div className="chat-history-qp-meta">
                                                <span>{timeAgo(session.updatedAt)}</span>
                                                {confirmDeleteId === session.id ? (
                                                    <>
                                                        <button className="icon-btn action-check" onClick={(e) => { e.stopPropagation(); deleteSession(session.id); setConfirmDeleteId(null); }} title="Confirm Delete"><Check size={14} /></button>
                                                        <button className="icon-btn action-x" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }} title="Cancel"><X size={14} /></button>
                                                    </>
                                                ) : (
                                                    <button className="icon-btn delete" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(session.id); }} title="Delete"><Trash2 size={14} /></button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {olderSessions.length > 0 && (
                                        <div className="chat-history-qp-item show-more">
                                            Show {olderSessions.length} more...
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Older */}
                            {olderSessions.length > 0 && (
                                <div className="chat-history-qp-section">
                                    <div className="chat-history-qp-section-title">Other Conversations</div>
                                    {olderSessions.map(session => (
                                        <div key={session.id} className="chat-history-qp-item" onClick={() => handleSwitch(session.id)}>
                                            <div className="chat-history-qp-item-title" title="Double-click to rename" onDoubleClick={(e) => handleStartRename(session.id, session.title, e)}>
                                                {editingId === session.id ? (
                                                    <input autoFocus value={editTitle} onChange={e => setEditTitle(e.target.value)} onBlur={() => handleCommitRename(session.id)} onKeyDown={(e) => handleKeyDownRename(e, session.id)} onClick={e => e.stopPropagation()} className="chat-history-rename-input" />
                                                ) : session.title}
                                            </div>
                                            <div className="chat-history-qp-meta">
                                                <span>{timeAgo(session.updatedAt)}</span>
                                                {confirmDeleteId === session.id ? (
                                                    <>
                                                        <button className="icon-btn action-check" onClick={(e) => { e.stopPropagation(); deleteSession(session.id); setConfirmDeleteId(null); }} title="Confirm Delete"><Check size={14} /></button>
                                                        <button className="icon-btn action-x" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }} title="Cancel"><X size={14} /></button>
                                                    </>
                                                ) : (
                                                    <button className="icon-btn delete" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(session.id); }} title="Delete"><Trash2 size={14} /></button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {sessionList.length === 0 && (
                                <div className="chat-history-empty" style={{ padding: '2rem', textAlign: 'center', opacity: 0.5 }}>No past conversations</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
