import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { Dossier, DossierType, DossierSource, DossierSection } from '../types';

interface DossierState {
    dossiers: Dossier[];
    activeDossierId: string | null;
    // Actions
    createDossier: (title: string, type: DossierType) => string;
    updateDossierSection: (dossierId: string, sectionId: string, content: string, sources?: DossierSource[]) => void;
    addDossierSection: (dossierId: string, title: string) => void;
    deleteDossier: (dossierId: string) => void;
    setActiveDossier: (id: string | null) => void;
    linkDossierToMapNode: (dossierId: string, mapNodeId: string) => void;
    proposeDossierSectionUpdate: (dossierId: string, sectionId: string, proposedContent: string) => void;
    acceptDossierSectionUpdate: (dossierId: string, sectionId: string) => void;
    rejectDossierSectionUpdate: (dossierId: string, sectionId: string) => void;
    setDossierSectionProcessing: (dossierId: string, sectionId: string, isProcessing: boolean) => void;
}

export const useDossierStore = create<DossierState>()(
    persist(
        (set, get) => ({
            dossiers: [],
            activeDossierId: null,

            createDossier: (title: string, type: DossierType) => {
                const newDossier: Dossier = {
                    id: uuidv4(),
                    title,
                    dossierType: type,
                    tags: [],
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    sections: []
                };

                set((state) => ({
                    dossiers: [newDossier, ...state.dossiers],
                    activeDossierId: newDossier.id
                }));

                return newDossier.id;
            },

            updateDossierSection: (dossierId: string, sectionId: string, content: string, sources?: DossierSource[]) => {
                set((state) => ({
                    dossiers: state.dossiers.map(dossier => {
                        if (dossier.id !== dossierId) return dossier;

                        let sectionUpdated = false;
                        const updatedSections = dossier.sections.map(section => {
                            if (section.id !== sectionId) return section;
                            sectionUpdated = true;
                            return {
                                ...section,
                                content,
                                updatedAt: Date.now(),
                                sources: sources || section.sources
                            };
                        });

                        // If section doesn't exist, we might want to auto-create it, but addDossierSection is for that.
                        if (!sectionUpdated) return dossier;

                        return {
                            ...dossier,
                            updatedAt: Date.now(),
                            sections: updatedSections
                        };
                    })
                }));
            },

            addDossierSection: (dossierId: string, title: string) => {
                set((state) => ({
                    dossiers: state.dossiers.map(dossier => {
                        if (dossier.id !== dossierId) return dossier;

                        const newSection: DossierSection = {
                            id: uuidv4(),
                            title,
                            content: '',
                            updatedAt: Date.now(),
                            sources: []
                        };

                        return {
                            ...dossier,
                            updatedAt: Date.now(),
                            sections: [...dossier.sections, newSection]
                        };
                    })
                }));
            },

            deleteDossier: (dossierId: string) => {
                set((state) => ({
                    dossiers: state.dossiers.filter(d => d.id !== dossierId),
                    activeDossierId: state.activeDossierId === dossierId ? null : state.activeDossierId
                }));
            },

            setActiveDossier: (id: string | null) => {
                set({ activeDossierId: id });
            },

            linkDossierToMapNode: (dossierId: string, mapNodeId: string) => {
                set((state) => ({
                    dossiers: state.dossiers.map(dossier =>
                        dossier.id === dossierId
                            ? { ...dossier, linkedMapNodeId: mapNodeId, updatedAt: Date.now() }
                            : dossier
                    )
                }));
            },

            proposeDossierSectionUpdate: (dossierId, sectionId, proposedContent) => {
                set((state) => ({
                    dossiers: state.dossiers.map(dossier => {
                        if (dossier.id !== dossierId) return dossier;
                        return {
                            ...dossier,
                            sections: dossier.sections.map(section =>
                                section.id === sectionId
                                    ? { ...section, proposedContent, isProcessing: false }
                                    : section
                            )
                        };
                    })
                }));
            },

            acceptDossierSectionUpdate: (dossierId, sectionId) => {
                set((state) => ({
                    dossiers: state.dossiers.map(dossier => {
                        if (dossier.id !== dossierId) return dossier;
                        return {
                            ...dossier,
                            updatedAt: Date.now(),
                            sections: dossier.sections.map(section =>
                                section.id === sectionId && section.proposedContent
                                    ? {
                                        ...section,
                                        content: section.proposedContent,
                                        proposedContent: undefined,
                                        updatedAt: Date.now()
                                    }
                                    : section
                            )
                        };
                    })
                }));
            },

            rejectDossierSectionUpdate: (dossierId, sectionId) => {
                set((state) => ({
                    dossiers: state.dossiers.map(dossier => {
                        if (dossier.id !== dossierId) return dossier;
                        return {
                            ...dossier,
                            sections: dossier.sections.map(section =>
                                section.id === sectionId
                                    ? { ...section, proposedContent: undefined, isProcessing: false }
                                    : section
                            )
                        };
                    })
                }));
            },

            setDossierSectionProcessing: (dossierId, sectionId, isProcessing) => {
                set((state) => ({
                    dossiers: state.dossiers.map(dossier => {
                        if (dossier.id !== dossierId) return dossier;
                        return {
                            ...dossier,
                            sections: dossier.sections.map(section =>
                                section.id === sectionId
                                    ? { ...section, isProcessing }
                                    : section
                            )
                        };
                    })
                }));
            }
        }),
        {
            name: 'rag-studio-dossiers', // localStorage key
            partialize: (state) => ({ dossiers: state.dossiers }), // Only persist the dossiers array, not activeDossierId
        }
    )
);
