import React, { useState } from 'react';
import { useDossierStore } from '../../store/useDossierStore';
import { useProjectStore } from '../../store/useProjectStore';
import { Plus, Trash2, RefreshCw, FileText, User, Users, MapPin, Calendar, Hash, ExternalLink, X, Search, SortDesc, SortAsc, CaseSensitive, Loader2 } from 'lucide-react';
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
                    <div
                        onClick={(e) => {
                            const target = e.target as HTMLElement;
                            const a = target.closest('a');
                            if (a && a.href && !a.href.startsWith(window.location.origin)) {
                                e.preventDefault();
                                window.open(a.href, '_blank', 'noopener,noreferrer');
                            }
                        }}
                        dangerouslySetInnerHTML={{ __html: marked.parse(section.content || '*No content generated yet.*') as string }}
                    />
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
                            <a key={idx} href={source.url || '#'} target="_blank" rel="noopener noreferrer" className="dossier-source-tag" title={source.snippet}>
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
}

export const DossierPanel: React.FC<DossierPanelProps> = ({ isOpen, onClose }) => {
    const { dossiers, activeDossierId, createDossier, setActiveDossier, deleteDossier } = useDossierStore();
    const { activeProjectId } = useProjectStore();
    const [isCreating, setIsCreating] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newType, setNewType] = useState<DossierType>('person');
    const [dossierChatInput, setDossierChatInput] = useState('');

    const [localChatState, setLocalChatState] = useState<'idle' | 'processing' | 'clarification'>('idle');
    const [localChatResponse, setLocalChatResponse] = useState('');
    const { generateContextualDossier, chatWithDossier } = useDossierAI();

    const handleLocalQuerySubmit = async (query: string) => {
        if (!query.trim() || !activeDossierId) return;
        setLocalChatState('processing');
        try {
            const result = await chatWithDossier(activeDossierId, query);
            if (result.didEdit) {
                setLocalChatState('idle');
            } else if (result.text && result.text.trim()) {
                setLocalChatResponse(result.text);
                setLocalChatState('clarification');
            } else {
                setLocalChatState('idle');
            }
        } catch (e) {
            setLocalChatState('idle');
            console.error(e);
        }
    };

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
        let result = dossiers.filter(d => d.projectId === activeProjectId);

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
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    <button
                                        className="delete-dossier-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            generateContextualDossier(dossier.title, dossier.id);
                                        }}
                                        title="Regenerate Dossier"
                                    >
                                        <RefreshCw size={14} />
                                    </button>
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
                                        handleLocalQuerySubmit(`[Section: ${section.title}] ${inst}`);
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

                        {/* Sticky Chat Input Wrapper */}
                        <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            background: 'var(--bg-color)', borderTop: '1px solid var(--border-color)', boxShadow: '0 -4px 12px rgba(0,0,0,0.1)',
                            zIndex: 10
                        }}>
                            {/* Sliding Clarification Overlay */}
                            <div style={{
                                position: 'absolute', bottom: '100%', left: 0, right: 0,
                                background: 'var(--panel-bg-color)', borderTop: '1px solid var(--border-color)',
                                maxHeight: localChatState !== 'idle' ? '300px' : '0px',
                                opacity: localChatState !== 'idle' ? 1 : 0,
                                overflowY: 'auto',
                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                borderTopLeftRadius: '12px',
                                borderTopRightRadius: '12px',
                                visibility: localChatState !== 'idle' ? 'visible' : 'hidden'
                            }}>
                                <div style={{ padding: '16px', position: 'relative' }}>
                                    {localChatState === 'processing' ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-color-secondary)' }}>
                                            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: '#8e44ad' }} />
                                            AI is processing your request...
                                        </div>
                                    ) : (
                                        <div style={{ color: 'var(--text-color)', fontSize: '0.95rem' }}>
                                            <div style={{ fontWeight: 600, marginBottom: '8px', color: '#8e44ad', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                Assistant Clarification
                                                <button className="icon-btn" onClick={() => setLocalChatState('idle')}><X size={14} /></button>
                                            </div>
                                            <div style={{ lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: marked.parse(localChatResponse || '') as string }} />
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', padding: '16px' }}>
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
                                                handleLocalQuerySubmit(dossierChatInput);
                                                setDossierChatInput('');
                                                e.currentTarget.style.height = 'auto';
                                            }
                                        }
                                    }}
                                    rows={1}
                                    placeholder={`Ask AI to update ${activeDossier.title} or compile new info...`}
                                    style={{ flex: 1, padding: '10px 16px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--panel-bg-color)', color: 'var(--text-color)', resize: 'none', overflowY: 'auto', maxHeight: '120px', display: 'block' }}
                                />
                                <button className="button" style={{ borderRadius: '12px', padding: '10px 20px', height: 'fit-content' }} disabled={!dossierChatInput.trim() || localChatState === 'processing'} onClick={() => {
                                    if (dossierChatInput.trim()) {
                                        handleLocalQuerySubmit(dossierChatInput);
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
                                                        handleLocalQuerySubmit(`Regarding the text "${selectionPopover.text}" in section "${section?.title}": ${commentDraft}`);
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
                                                        handleLocalQuerySubmit(`Regarding the text "${selectionPopover.text}" in section "${section?.title}": ${commentDraft}`);
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
                                            generateContextualDossier(selectionPopover.text);
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
