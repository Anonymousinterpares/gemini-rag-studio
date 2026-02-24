import React, { useState } from 'react';
import { useDossierStore } from '../../store/useDossierStore';
import { Plus, Trash2, FileText, User, Users, MapPin, Calendar, Hash, ExternalLink, X, Search, SortDesc, SortAsc, CaseSensitive } from 'lucide-react';
import { marked } from 'marked';
import { DossierType, DossierSection } from '../../types';
import { useDiffRenderer } from '../../hooks/useDiffRenderer';
import { useDossierAI } from '../../hooks/useDossierAI';
import './DossierPanel.css';

const TypeIcon = ({ type, size = 16 }: { type: DossierType, size?: number }) => {
    switch (type) {
        case 'person': return <User size={size} />;
        case 'organization': return <Users size={size} />;
        case 'location': return <MapPin size={size} />;
        case 'event': return <Calendar size={size} />;
        case 'topic': return <Hash size={size} />;
        default: return <FileText size={size} />;
    }
};

const DossierSectionView: React.FC<{
    section: DossierSection;
    dossierId: string;
    onSectionUpdate: (instruction: string) => void;
}> = ({ section, dossierId, onSectionUpdate }) => {
    const { acceptDossierSectionUpdate, rejectDossierSectionUpdate } = useDossierStore();
    const renderedDiff = useDiffRenderer(section.content || '', section.proposedContent || '');
    const [isHovered, setIsHovered] = useState(false);
    const [isDrafting, setIsDrafting] = useState(false);
    const [instruction, setInstruction] = useState('');

    const formatDate = (ts: number) => {
        return new Date(ts).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    return (
        <div
            className="dossier-section"
            data-section-id={section.id}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{ position: 'relative' }}
        >
            <div className="dossier-section-header">
                {section.title}
                <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--text-color-secondary)' }}>
                    {formatDate(section.updatedAt)}
                </span>
            </div>

            {/* The + Button on Hover */}
            {isHovered && !isDrafting && !section.proposedContent && !section.isProcessing && (
                <button
                    className="icon-btn"
                    onClick={() => setIsDrafting(true)}
                    style={{ position: 'absolute', top: '12px', right: '12px', background: '#8e44ad', color: 'white', border: 'none', borderRadius: '4px', padding: '4px' }}
                    title="Instruct AI to edit this section"
                >
                    <Plus size={14} />
                </button>
            )}

            <div className="dossier-section-content">
                {section.isProcessing ? (
                    <div style={{ padding: '1rem', textAlign: 'center', fontStyle: 'italic', color: 'var(--text-color-secondary)' }}>
                        AI is compiling updates for this section...
                    </div>
                ) : section.proposedContent ? (
                    <div>
                        <div style={{ padding: '12px', background: 'rgba(255, 255, 0, 0.05)', border: '1px solid rgba(255, 255, 0, 0.2)', borderRadius: '4px', marginBottom: '12px' }}>
                            {renderedDiff}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button className="button" style={{ background: '#10b981', color: 'white', border: 'none' }} onClick={() => acceptDossierSectionUpdate(dossierId, section.id)}>
                                Accept
                            </button>
                            <button className="button secondary" onClick={() => rejectDossierSectionUpdate(dossierId, section.id)}>
                                Reject
                            </button>
                        </div>
                    </div>
                ) : (
                    <div dangerouslySetInnerHTML={{ __html: marked.parse(section.content || '*No content generated yet.*') as string }} />
                )}

                {isDrafting && (
                    <div style={{ marginTop: '1rem', padding: '12px', background: 'rgba(0,0,0,0.1)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        <textarea
                            autoFocus
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            placeholder={`Instructions for AI to modify ${section.title}...`}
                            style={{ width: '100%', minHeight: '60px', background: 'transparent', border: 'none', resize: 'vertical', color: 'var(--text-color)' }}
                        />
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                            <button className="button" disabled={!instruction.trim()} onClick={() => {
                                onSectionUpdate(instruction);
                                setIsDrafting(false);
                                setInstruction('');
                            }}>
                                Submit
                            </button>
                            <button className="button secondary" onClick={() => { setIsDrafting(false); setInstruction(''); }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {section.sources && section.sources.length > 0 && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-color-secondary)' }}>Sources:</span>
                        {section.sources.map((source, idx) => (
                            <a key={idx} href={source.url || '#'} className="dossier-source-tag" title={source.snippet}>
                                {source.type === 'web' ? <ExternalLink size={12} /> : <FileText size={12} />}
                                {source.label}
                            </a>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

interface DossierPanelProps {
    isOpen: boolean;
    onClose: () => void;
    submitQuery: (query: string) => void;
}

export const DossierPanel: React.FC<DossierPanelProps> = ({ isOpen, onClose, submitQuery }) => {
    const { dossiers, activeDossierId, createDossier, setActiveDossier, deleteDossier } = useDossierStore();
    const [isCreating, setIsCreating] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newType, setNewType] = useState<DossierType>('person');
    const [dossierChatInput, setDossierChatInput] = useState('');

    // Filtering & Sorting State
    const [searchQuery, setSearchQuery] = useState('');
    const [isCaseSensitive, setIsCaseSensitive] = useState(false);
    const [sortBy, setSortBy] = useState<'updatedAt' | 'title'>('updatedAt');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    const [selectionPopover, setSelectionPopover] = useState<{
        top: number;
        left: number;
        text: string;
        sectionId: string;
        commentInputOpen: boolean;
    } | null>(null);
    const [commentDraft, setCommentDraft] = useState('');

    const activeDossier = dossiers.find(d => d.id === activeDossierId);

    const filteredAndSortedDossiers = React.useMemo(() => {
        let result = dossiers;

        // Search Filter
        if (searchQuery) {
            result = result.filter(d => {
                const title = isCaseSensitive ? d.title : d.title.toLowerCase();
                const query = isCaseSensitive ? searchQuery : searchQuery.toLowerCase();
                const titleMatch = title.includes(query);
                const contentMatch = d.sections.some(s => {
                    const content = isCaseSensitive ? s.content : s.content.toLowerCase();
                    return content.includes(query);
                });
                return titleMatch || contentMatch;
            });
        }

        // Sort
        result = [...result].sort((a, b) => {
            let comparison = 0;
            if (sortBy === 'title') {
                comparison = a.title.localeCompare(b.title);
            } else if (sortBy === 'updatedAt') {
                comparison = a.updatedAt - b.updatedAt;
            }
            return sortOrder === 'asc' ? comparison : -comparison;
        });

        return result;
    }, [dossiers, searchQuery, isCaseSensitive, sortBy, sortOrder]);

    const handleCreate = (e: React.FormEvent) => {
        e.preventDefault();
        if (newTitle.trim()) {
            createDossier(newTitle.trim(), newType);
            setNewTitle('');
            setIsCreating(false);
        }
    };

    const formatDate = (ts: number) => {
        return new Date(ts).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    // Escape key to close
    React.useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    if (!isOpen) return null;

    return (
        <div className="dossier-panel-overlay" onClick={onClose} style={{
            position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)'
        }}>
            <div className="dossier-panel-container" onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: '1200px', height: '100%', backgroundColor: 'var(--bg-color)', display: 'flex', borderLeft: '1px solid var(--border-color)', boxShadow: '-5px 0 25px rgba(0,0,0,0.5)'
            }}>
                <button className="icon-btn" onClick={onClose} style={{ position: 'absolute', top: '1rem', right: '1.5rem', zIndex: 10 }} title="Close">
                    <X size={24} />
                </button>
                {/* Sidebar List */}
                <div className="dossier-sidebar">
                    <div className="dossier-sidebar-header">
                        <h2>Knowledge Base</h2>
                        <button className="new-dossier-btn" onClick={() => setIsCreating(!isCreating)} title="Create New Dossier">
                            <Plus size={18} />
                        </button>
                    </div>

                    <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0 8px' }}>
                            <Search size={14} style={{ color: 'var(--text-color-secondary)' }} />
                            <input
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search dossiers..."
                                style={{ flex: 1, background: 'transparent', border: 'none', padding: '6px', color: 'var(--text-color)', minWidth: 0 }}
                            />
                            <button
                                className={`icon-btn ${isCaseSensitive ? 'active' : ''}`}
                                onClick={() => setIsCaseSensitive(!isCaseSensitive)}
                                title={`Case Sensitive: ${isCaseSensitive ? 'ON' : 'OFF'}`}
                                style={{ padding: '0', background: isCaseSensitive ? 'var(--panel-bg-color)' : 'transparent', display: 'flex', alignItems: 'center' }}
                            >
                                <CaseSensitive size={18} />
                            </button>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <select
                                value={sortBy}
                                onChange={e => setSortBy(e.target.value as any)}
                                style={{ flex: 1, padding: '4px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--panel-bg-color)', color: 'var(--text-color)' }}
                            >
                                <option style={{ background: 'var(--panel-bg-color)' }} value="updatedAt">By Date</option>
                                <option style={{ background: 'var(--panel-bg-color)' }} value="title">By Title</option>
                            </select>
                            <button
                                className="icon-btn"
                                onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                                title={`Sort: ${sortOrder === 'desc' ? 'Descending' : 'Ascending'}`}
                                style={{ padding: '4px', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                            >
                                {sortOrder === 'desc' ? <SortDesc size={14} /> : <SortAsc size={14} />}
                            </button>
                        </div>
                    </div>

                    {isCreating && (
                        <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(0,0,0,0.1)' }}>
                            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <input
                                    autoFocus
                                    value={newTitle}
                                    onChange={e => setNewTitle(e.target.value)}
                                    placeholder="Dossier Subject..."
                                    style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }}
                                />
                                <select
                                    value={newType}
                                    onChange={e => setNewType(e.target.value as DossierType)}
                                    style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }}
                                >
                                    <option value="person">Person</option>
                                    <option value="organization">Organization</option>
                                    <option value="location">Location</option>
                                    <option value="event">Event</option>
                                    <option value="topic">Topic</option>
                                </select>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button type="submit" style={{ flex: 1, padding: '0.4rem', background: '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Create</button>
                                    <button type="button" onClick={() => setIsCreating(false)} style={{ flex: 1, padding: '0.4rem', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-color)', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                                </div>
                            </form>
                        </div>
                    )}

                    <div className="dossier-list">
                        {filteredAndSortedDossiers.length === 0 && !isCreating && (
                            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-color-secondary)', fontSize: '0.9rem' }}>
                                {dossiers.length === 0 ? 'No dossiers created yet. Select "Ask AI to Compile Dossier" from the chat or create one manually.' : 'No dossiers match your search.'}
                            </div>
                        )}
                        {filteredAndSortedDossiers.map(dossier => (
                            <div
                                key={dossier.id}
                                className={`dossier-list-item ${activeDossierId === dossier.id ? 'active' : ''}`}
                                onClick={() => setActiveDossier(dossier.id)}
                            >
                                <div className="dossier-list-item-main">
                                    <div className="dossier-title">{dossier.title}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} className="dossier-type">
                                        <TypeIcon type={dossier.dossierType} size={12} />
                                        {dossier.dossierType}
                                    </div>
                                </div>
                                <button
                                    className="delete-dossier-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm(`Delete dossier "${dossier.title}"?`)) {
                                            deleteDossier(dossier.id);
                                        }
                                    }}
                                    title="Delete Dossier"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Main Content Area */}
                {activeDossier ? (
                    <div
                        className="dossier-main-content"
                        style={{ position: 'relative' }}
                        onMouseUp={() => {
                            const selection = window.getSelection();
                            if (selection && selection.toString().trim().length > 0) {
                                const range = selection.getRangeAt(0);
                                const rect = range.getBoundingClientRect();
                                const text = selection.toString();

                                // Find closest section parent
                                let sectionId = '';
                                let node = selection.anchorNode as HTMLElement | null;
                                while (node && node !== document.body) {
                                    if (node.classList && node.classList.contains('dossier-section')) {
                                        // Since we don't have data-section-id on the div yet, we should add it in DossierSectionView
                                        const id = node.getAttribute('data-section-id');
                                        if (id) sectionId = id;
                                        break;
                                    }
                                    node = node.parentElement;
                                }

                                if (sectionId) {
                                    setSelectionPopover({
                                        top: rect.bottom + window.scrollY + 5,
                                        left: rect.left + window.scrollX,
                                        text: text,
                                        sectionId: sectionId,
                                        commentInputOpen: false
                                    });
                                }
                            } else {
                                setSelectionPopover(null);
                            }
                        }}
                    >
                        <div className="dossier-top-bar">
                            <div className="dossier-header-left">
                                <h1>{activeDossier.title}</h1>
                                <div className="dossier-meta">
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', textTransform: 'capitalize' }}>
                                        <TypeIcon type={activeDossier.dossierType} size={14} />
                                        {activeDossier.dossierType}
                                    </span>
                                    <span>•</span>
                                    <span>Updated {formatDate(activeDossier.updatedAt)}</span>
                                </div>
                            </div>
                        </div>

                        <div className="dossier-scroll-area" style={{ paddingBottom: '80px' }}>
                            {activeDossier.sections.map(section => (
                                <DossierSectionView
                                    key={section.id}
                                    section={section}
                                    dossierId={activeDossier.id}
                                    onSectionUpdate={(inst) => {
                                        submitQuery(`[Dossier: ${activeDossier.title} | ${section.title}] ${inst}`);
                                    }}
                                />
                            ))}
                            {activeDossier.sections.length === 0 && (
                                <div className="dossier-empty-state" style={{ flex: 'none', padding: '3rem 0' }}>
                                    <FileText size={48} style={{ opacity: 0.2 }} />
                                    <p>This dossier is empty.</p>
                                    <p style={{ fontSize: '0.9rem', maxWidth: '400px', textAlign: 'center' }}>
                                        Ask the AI in the chat panel to "Compile a dossier on {activeDossier.title}" to populate this view.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Sticky Chat Input */}
                        <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0, padding: '16px',
                            background: 'var(--bg-color)', borderTop: '1px solid var(--border-color)', boxShadow: '0 -4px 12px rgba(0,0,0,0.1)'
                        }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                                <textarea
                                    value={dossierChatInput}
                                    onChange={e => {
                                        setDossierChatInput(e.target.value);
                                        e.target.style.height = 'auto';
                                        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                                    }}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            if (dossierChatInput.trim()) {
                                                submitQuery(`[Dossier: ${activeDossier.title}] ${dossierChatInput}`);
                                                setDossierChatInput('');
                                                e.currentTarget.style.height = 'auto';
                                            }
                                        }
                                    }}
                                    rows={1}
                                    placeholder={`Ask AI to update ${activeDossier.title} or compile new info...`}
                                    style={{ flex: 1, padding: '10px 16px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg-color)', color: 'var(--text-color)', resize: 'none', overflowY: 'auto', maxHeight: '120px', display: 'block' }}
                                />
                                <button className="button" style={{ borderRadius: '12px', padding: '10px 20px', height: 'fit-content' }} disabled={!dossierChatInput.trim()} onClick={() => {
                                    if (dossierChatInput.trim()) {
                                        submitQuery(`[Dossier: ${activeDossier.title}] ${dossierChatInput}`);
                                        setDossierChatInput('');
                                    }
                                }}>
                                    Send
                                </button>
                            </div>
                        </div>

                        {/* Selection Popover */}
                        {selectionPopover && (
                            <div
                                className="selection-popover"
                                style={{ top: selectionPopover.top, left: selectionPopover.left }}
                                onMouseUp={e => e.stopPropagation()}
                                onMouseDown={e => e.stopPropagation()}
                            >
                                {selectionPopover.commentInputOpen ? (
                                    <div className="selection-popover-form" onMouseDown={e => e.stopPropagation()}>
                                        <textarea
                                            className="selection-popover-textarea"
                                            autoFocus
                                            placeholder="Instruct AI to edit based on selection..."
                                            value={commentDraft}
                                            onChange={e => setCommentDraft(e.target.value)}
                                            rows={3}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    if (commentDraft.trim()) {
                                                        const section = activeDossier.sections.find(s => s.id === selectionPopover.sectionId);
                                                        submitQuery(`[Dossier: ${activeDossier.title} | ${section?.title}] Regarding the text "${selectionPopover.text}": ${commentDraft}`);
                                                        setSelectionPopover(null);
                                                        setCommentDraft('');
                                                    }
                                                }
                                                if (e.key === 'Escape') setSelectionPopover(null);
                                            }}
                                        />
                                        <div className="selection-popover-actions">
                                            <button
                                                className="button"
                                                onClick={() => {
                                                    if (commentDraft.trim()) {
                                                        const section = activeDossier.sections.find(s => s.id === selectionPopover.sectionId);
                                                        submitQuery(`[Dossier: ${activeDossier.title} | ${section?.title}] Regarding the text "${selectionPopover.text}": ${commentDraft}`);
                                                        setSelectionPopover(null);
                                                        setCommentDraft('');
                                                    }
                                                }}
                                                disabled={!commentDraft.trim()}
                                            >Submit</button>
                                            <button className="button secondary" onClick={() => setSelectionPopover(null)}>Cancel</button>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <button className="selection-popover-btn button secondary" style={{ padding: '6px 12px', textAlign: 'left', display: 'flex', gap: '6px', alignItems: 'center', border: 'none' }} onClick={() => setSelectionPopover(prev => prev ? { ...prev, commentInputOpen: true } : null)}>
                                            <Plus size={14} /> Review & Edit
                                        </button>
                                        <button className="selection-popover-btn button secondary" style={{ padding: '6px 12px', textAlign: 'left', display: 'flex', gap: '6px', alignItems: 'center', border: 'none' }} onClick={() => {
                                            useDossierAI().generateContextualDossier(selectionPopover.text);
                                            setSelectionPopover(null);
                                        }}>
                                            <FileText size={14} /> Compile New Dossier
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="dossier-empty-state">
                        <User size={64} style={{ opacity: 0.2 }} />
                        <h2 style={{ margin: 0, fontWeight: 500 }}>Knowledge Base</h2>
                        <p style={{ margin: 0 }}>Select a dossier from the sidebar or create a new one.</p>
                        <button className="create-first-btn" onClick={() => setIsCreating(true)}>
                            <Plus size={18} /> Create First Dossier
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
