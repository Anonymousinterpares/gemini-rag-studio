import React, { useState, useMemo } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { useChatStore } from '../../store/useChatStore';
import { useChatHistoryIO } from '../../hooks/useChatHistoryIO';
import { Plus, Search, FolderOpen, Calendar, MoreVertical, Trash2, Edit2 } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import './ProjectBrowser.css';

export const ProjectBrowser: React.FC = () => {
    const { projects, setActiveProject, createProject, deleteProject, updateProject } = useProjectStore();
    const { initSessions } = useChatHistoryIO();

    const [searchQuery, setSearchQuery] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');

    // For editing an existing project name
    const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    const filteredProjects = useMemo(() => {
        let result = [...projects];
        if (searchQuery) {
            result = result.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
        }
        // Ensure most recently updated are first
        return result.sort((a, b) => b.updatedAt - a.updatedAt);
    }, [projects, searchQuery]);

    const handleCreateProject = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProjectName.trim()) return;

        createProject(newProjectName);
        setIsCreating(false);
        setNewProjectName('');

        // Boot up sessions for the newly activated project
        initSessions();
    };

    const handleOpenProject = (id: string) => {
        setActiveProject(id);
        useChatStore.setState({ activeSessionId: null, sessionList: [], chatHistory: [] }); // Reset chat state to force reload
        initSessions();
    };

    const handleDeleteProject = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (window.confirm('Are you sure you want to delete this project? Data will be lost.')) {
            deleteProject(id);
        }
    };

    const handleStartEdit = (e: React.MouseEvent, id: string, currentName: string) => {
        e.stopPropagation();
        setEditingProjectId(id);
        setEditName(currentName);
    };

    const handleSaveEdit = (e: React.FormEvent) => {
        e.preventDefault();
        if (editingProjectId && editName.trim()) {
            updateProject(editingProjectId, editName.trim());
        }
        setEditingProjectId(null);
    };

    const handleCancelEdit = () => {
        setEditingProjectId(null);
        setEditName('');
    };

    const formatDate = (timestamp: number) => {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }).format(new Date(timestamp));
    };

    return (
        <div className="project-browser-container">
            <div className="project-browser-header">
                <div>
                    <h1 className="project-browser-title">Your Projects</h1>
                    <p className="project-browser-subtitle">Select a project space to continue your investigation</p>
                </div>

                <div className="project-browser-controls">
                    <div className="project-search-bar">
                        <Search size={16} />
                        <input
                            type="text"
                            placeholder="Find project..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <button className="button primary" onClick={() => setIsCreating(true)}>
                        <Plus size={16} /> New Project
                    </button>
                </div>
            </div>

            {isCreating && (
                <div className="project-create-card">
                    <form onSubmit={handleCreateProject}>
                        <div style={{ marginBottom: '12px' }}>
                            <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-color-secondary)', marginBottom: '6px' }}>
                                Project Name
                            </label>
                            <input
                                autoFocus
                                type="text"
                                style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-color)', fontSize: '14px', outline: 'none' }}
                                value={newProjectName}
                                onChange={(e) => setNewProjectName(e.target.value)}
                                placeholder="E.g., Enron Investigation"
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button type="button" className="button secondary" onClick={() => setIsCreating(false)}>Cancel</button>
                            <button type="submit" className="button primary" disabled={!newProjectName.trim()}>Create Project</button>
                        </div>
                    </form>
                </div>
            )}

            <div className="project-grid">
                {filteredProjects.length === 0 && !isCreating ? (
                    <div className="project-empty-state">
                        <FolderOpen size={48} color="var(--text-color-secondary)" style={{ opacity: 0.5, marginBottom: '16px' }} />
                        <h3>No projects found</h3>
                        <p>Create a new project to start organizing your files and chats.</p>
                        <button className="button secondary" onClick={() => setIsCreating(true)} style={{ marginTop: '16px' }}>
                            <Plus size={16} /> Create First Project
                        </button>
                    </div>
                ) : (
                    filteredProjects.map((project) => (
                        <div key={project.id} className="project-card" onClick={() => handleOpenProject(project.id)}>
                            {editingProjectId === project.id ? (
                                <form onSubmit={handleSaveEdit} onClick={(e) => e.stopPropagation()} style={{ width: '100%' }}>
                                    <input
                                        autoFocus
                                        type="text"
                                        style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--accent-color)', borderRadius: '4px', color: 'var(--text-color)', fontSize: '16px', fontWeight: 600, outline: 'none', marginBottom: '8px' }}
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                    />
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                        <button type="submit" className="button primary" style={{ padding: '4px 8px', fontSize: '12px' }}>Save</button>
                                        <button type="button" className="button secondary" onClick={handleCancelEdit} style={{ padding: '4px 8px', fontSize: '12px' }}>Cancel</button>
                                    </div>
                                </form>
                            ) : (
                                <>
                                    <div className="project-card-header">
                                        <h3 className="project-card-title">{project.name}</h3>

                                        {/* Dropdown Menu for Edit/Delete */}
                                        <div onClick={e => e.stopPropagation()}>
                                            <DropdownMenu.Root>
                                                <DropdownMenu.Trigger asChild>
                                                    <button className="project-card-menu-btn">
                                                        <MoreVertical size={16} />
                                                    </button>
                                                </DropdownMenu.Trigger>
                                                <DropdownMenu.Portal>
                                                    <DropdownMenu.Content className="project-dropdown-content" sideOffset={5} align="end">
                                                        <DropdownMenu.Item className="project-dropdown-item" onSelect={(e) => { e.preventDefault(); /* Radix absorbs the click event by default sometimes, we use onSelect */ }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }} onClick={(e) => handleStartEdit(e, project.id, project.name)}>
                                                                <Edit2 size={14} style={{ marginRight: '8px' }} /> Rename
                                                            </div>
                                                        </DropdownMenu.Item>
                                                        <DropdownMenu.Separator className="project-dropdown-separator" />
                                                        <DropdownMenu.Item className="project-dropdown-item project-dropdown-item-danger" onSelect={(e) => { e.preventDefault(); }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }} onClick={(e) => handleDeleteProject(e, project.id)}>
                                                                <Trash2 size={14} style={{ marginRight: '8px' }} /> Delete
                                                            </div>
                                                        </DropdownMenu.Item>
                                                    </DropdownMenu.Content>
                                                </DropdownMenu.Portal>
                                            </DropdownMenu.Root>
                                        </div>
                                    </div>

                                    <div className="project-card-meta">
                                        <Calendar size={13} /> Updated {formatDate(project.updatedAt)}
                                    </div>
                                </>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
