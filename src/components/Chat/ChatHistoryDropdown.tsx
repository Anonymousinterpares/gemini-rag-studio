import { FC, useState, useRef, useEffect } from 'react';
import { History, Plus, Trash2, Check, X, Edit2 } from 'lucide-react';
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

    const activeSessionTitle = sessionList.find(s => s.id === activeSessionId)?.title || 'New Conversation';

    const handleStartRename = (id: string, currentTitle: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(id);
        setEditTitle(currentTitle);
        setConfirmDeleteId(null);
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

    return (
        <div className="chat-history-dropdown-container" ref={dropdownRef}>
            <button
                className={`button secondary chat-history-trigger ${isOpen ? 'active' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                title="Chat History"
            >
                <History size={16} style={{ marginRight: '6px' }} />
                <span className="truncate" style={{ maxWidth: '150px' }}>
                    {activeSessionTitle.length > 28 ? activeSessionTitle.substring(0, 25) + '...' : activeSessionTitle}
                </span>
            </button>

            {isOpen && (
                <div className="chat-history-dropdown-menu">
                    <div className="chat-history-dropdown-header">
                        <button className="button chat-history-new-btn" onClick={() => { createNewSession(); setIsOpen(false); }}>
                            <Plus size={14} style={{ marginRight: '4px' }} /> New Conversation
                        </button>
                    </div>

                    <div className="chat-history-list">
                        {sessionList.length === 0 ? (
                            <div className="chat-history-empty">No past conversations</div>
                        ) : (
                            sessionList.map(session => (
                                <div
                                    key={session.id}
                                    className={`chat-history-item ${session.id === activeSessionId ? 'active' : ''}`}
                                    onClick={() => {
                                        if (editingId !== session.id && confirmDeleteId !== session.id) {
                                            handleSwitch(session.id);
                                        }
                                    }}
                                >
                                    <div className="chat-history-item-main">
                                        {editingId === session.id ? (
                                            <input
                                                autoFocus
                                                value={editTitle}
                                                onChange={e => setEditTitle(e.target.value)}
                                                onBlur={() => handleCommitRename(session.id)}
                                                onKeyDown={(e) => handleKeyDownRename(e, session.id)}
                                                onClick={e => e.stopPropagation()}
                                                className="chat-history-rename-input"
                                            />
                                        ) : (
                                            <div
                                                className="chat-history-item-title truncate"
                                                onDoubleClick={(e) => handleStartRename(session.id, session.title, e)}
                                                title="Double-click to rename"
                                            >
                                                {session.title}
                                            </div>
                                        )}
                                        <div className="chat-history-item-date">
                                            {new Date(session.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </div>
                                    </div>

                                    {confirmDeleteId === session.id ? (
                                        <div className="chat-history-delete-confirm">
                                            <button className="icon-btn action-check" onClick={(e) => { e.stopPropagation(); deleteSession(session.id); setConfirmDeleteId(null); }} title="Confirm Delete"><Check size={14} /></button>
                                            <button className="icon-btn action-x" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }} title="Cancel"><X size={14} /></button>
                                        </div>
                                    ) : (
                                        <div className="chat-history-actions">
                                            <button
                                                className="icon-btn chat-history-action-btn"
                                                onClick={(e) => handleStartRename(session.id, session.title, e)}
                                                title="Rename Conversation"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                className="icon-btn chat-history-action-btn delete"
                                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(session.id); }}
                                                title="Delete Conversation"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
