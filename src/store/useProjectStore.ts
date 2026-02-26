import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { Project } from '../types';
import { useDossierStore } from './useDossierStore';

interface ProjectState {
    projects: Project[];
    activeProjectId: string | null;

    // Actions
    createProject: (name: string) => string;
    updateProject: (id: string, name: string) => void;
    deleteProject: (id: string) => void;
    setActiveProject: (id: string | null) => void;

    // Fuzzy matching for Map -> Dossier Resolution
    findMatchingDossierId: (nodeLabel: string, nodeId?: string) => string | null;
}

export const useProjectStore = create<ProjectState>()(
    persist(
        (set, get) => ({
            projects: [],
            activeProjectId: null,

            createProject: (name: string) => {
                const newProject: Project = {
                    id: uuidv4(),
                    name,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };
                set((state) => ({
                    projects: [newProject, ...state.projects],
                    activeProjectId: newProject.id
                }));
                return newProject.id;
            },

            updateProject: (id: string, name: string) => {
                set((state) => ({
                    projects: state.projects.map(p =>
                        p.id === id ? { ...p, name, updatedAt: Date.now() } : p
                    )
                }));
            },

            deleteProject: (id: string) => {
                set((state) => ({
                    projects: state.projects.filter(p => p.id !== id),
                    activeProjectId: state.activeProjectId === id ? null : state.activeProjectId
                }));
            },

            setActiveProject: (id: string | null) => {
                set({ activeProjectId: id });
            },

            findMatchingDossierId: (nodeLabel: string, nodeId?: string) => {
                const { activeProjectId } = get();
                if (!activeProjectId) return null;

                // Dynamically require useDossierStore to avoid circular imports if any
                const dossiers = useDossierStore.getState().dossiers.filter(d => d.projectId === activeProjectId);

                // 0. ID Link Match (Strongest)
                if (nodeId) {
                    const linkedMatch = dossiers.find(d => d.linkedMapNodeId === nodeId);
                    if (linkedMatch) return linkedMatch.id;
                }

                const cleanLabel = nodeLabel.toLowerCase().trim();

                // 1. Exact match
                const exactMatch = dossiers.find(d => d.title.toLowerCase().trim() === cleanLabel);
                if (exactMatch) return exactMatch.id;

                // 2. High subset match (e.g. "Fred Trump Sr" vs "Fred Trump")
                const labelTokens = cleanLabel.split(/\s+/);
                for (const dossier of dossiers) {
                    const dossierTokens = dossier.title.toLowerCase().trim().split(/\s+/);

                    // Count how many tokens from the Map Node exist in the Dossier Title
                    let matchCount = 0;
                    for (const tok of labelTokens) {
                        if (dossierTokens.includes(tok)) matchCount++;
                    }

                    // If more than 60% of the node's words are in the dossier title, consider it a match
                    // This is a naive heuristic but works well for names with middle initials/suffixes
                    if (matchCount > 0 && matchCount / labelTokens.length >= 0.6) {
                        return dossier.id;
                    }

                    // Vice versa: how many tokens from the Dossier Title exist in the Map Node
                    let reverseMatchCount = 0;
                    for (const tok of dossierTokens) {
                        if (labelTokens.includes(tok)) reverseMatchCount++;
                    }
                    if (reverseMatchCount > 0 && reverseMatchCount / dossierTokens.length >= 0.6) {
                        return dossier.id;
                    }
                }

                return null;
            }
        }),
        {
            name: 'project-storage',
        }
    )
);
