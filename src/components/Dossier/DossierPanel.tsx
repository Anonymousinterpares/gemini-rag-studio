import React, { useState } from 'react';
import { useDossierStore } from '../../store/useDossierStore';
import { Plus, Trash2, FileText, User, Users, MapPin, Calendar, Hash, ExternalLink, X } from 'lucide-react';
import { marked } from 'marked';
import { DossierType } from '../../types';
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

interface DossierPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export const DossierPanel: React.FC<DossierPanelProps> = ({ isOpen, onClose }) => {
    const { dossiers, activeDossierId, createDossier, setActiveDossier, deleteDossier } = useDossierStore();
    const [isCreating, setIsCreating] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newType, setNewType] = useState<DossierType>('person');

    const activeDossier = dossiers.find(d => d.id === activeDossierId);

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
                        {dossiers.length === 0 && !isCreating && (
                            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-color-secondary)', fontSize: '0.9rem' }}>
                                No dossiers created yet. Select "Ask AI to Compile Dossier" from the chat or create one manually.
                            </div>
                        )}
                        {dossiers.map(dossier => (
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
                    <div className="dossier-main-content">
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

                        <div className="dossier-scroll-area">
                            {activeDossier.sections.map(section => (
                                <div key={section.id} className="dossier-section">
                                    <div className="dossier-section-header">
                                        {section.title}
                                        <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--text-color-secondary)' }}>
                                            {formatDate(section.updatedAt)}
                                        </span>
                                    </div>
                                    <div className="dossier-section-content">
                                        <div dangerouslySetInnerHTML={{ __html: marked.parse(section.content || '*No content generated yet.*') as string }} />

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
