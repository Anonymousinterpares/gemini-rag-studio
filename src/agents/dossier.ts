import { Tool, SchemaType } from '../api/llm-provider';
import { useDossierStore } from '../store/useDossierStore';

/**
 * Returns the tool definition for Gemini to interact with Dossiers.
 * This tool allows the LLM to write directly to a structured Dossier, section by section.
 */
export const getDossierTools = (): Tool[] => {
    return [
        {
            type: 'function',
            function: {
                name: 'update_dossier',
                description: 'Updates a specific section of a dossier. Use this to compile and structure knowledge about a person, event, organization, or topic. Always provide comprehensive, well-formatted markdown content for the section. If you need to create a new section, specify a new title. Valid section titles include: "Background", "Timeline", "Key Relationships", "Evidence Summary", or other descriptive headings.',
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        dossierId: {
                            type: SchemaType.STRING,
                            description: 'The unique ID of the dossier to update. You can obtain active dossier IDs from the user context.'
                        },
                        sectionTitle: {
                            type: SchemaType.STRING,
                            description: 'The title of the section to update or create (e.g. "Background", "Timeline").'
                        },
                        content: {
                            type: SchemaType.STRING,
                            description: 'The rich markdown content to write into this section. Overwrites existing content. Be detailed and cite sources inline if applicable.'
                        },
                        sources: {
                            type: SchemaType.ARRAY,
                            description: 'A list of sources used to compile this section.',
                            items: {
                                type: SchemaType.OBJECT,
                                properties: {
                                    type: { type: SchemaType.STRING, description: '"document", "web", or "chat_exchange"' },
                                    label: { type: SchemaType.STRING, description: 'Display name for the source' },
                                    fileId: { type: SchemaType.STRING, description: 'If a document, the ID of the file' },
                                    url: { type: SchemaType.STRING, description: 'Absolute URL to the source if type is "web"' }
                                },
                                required: ['type', 'label']
                            }
                        }
                    },
                    required: ['dossierId', 'sectionTitle', 'content']
                }
            }
        }
    ];
};

/**
 * Execution logic for the dossier tool calls returned by the LLM.
 */
export const handleDossierToolCall = async (
    name: string,
    args: unknown,
    options?: { proposeOnly?: boolean }
): Promise<{ result: string }> => {
    if (name === 'update_dossier') {
        const { dossierId, sectionTitle, content, sources } = args as { 
            dossierId: string; 
            sectionTitle: string; 
            content: string; 
            sources?: import('../types').DossierSource[] 
        };

        const store = useDossierStore.getState();
        const dossier = store.dossiers.find(d => d.id === dossierId);

        if (!dossier) {
            return { result: `Error: Dossier with ID ${dossierId} not found.` };
        }

        // Find existing section by title natively
        const existingSection = dossier.sections.find(
            s => s.title.toLowerCase() === sectionTitle.toLowerCase()
        );

        if (existingSection) {
            // Update existing section
            if (options?.proposeOnly) {
                store.proposeDossierSectionUpdate(dossierId, existingSection.id, content);
                return { result: `Proposed updates to section "${sectionTitle}" in dossier "${dossier.title}". User needs to accept.` };
            } else {
                store.updateDossierSection(dossierId, existingSection.id, content, sources);
                return { result: `Successfully updated section "${sectionTitle}" in dossier "${dossier.title}".` };
            }
        } else {
            // Add new section and update it
            store.addDossierSection(dossierId, sectionTitle);

            // Wait a tick for state to update, or just manually find the new section
            // In Zustand, synchronous updates are immediately available in getState()
            const updatedStore = useDossierStore.getState();
            const updatedDossier = updatedStore.dossiers.find(d => d.id === dossierId);
            const newSection = updatedDossier?.sections.find(s => s.title === sectionTitle);

            if (newSection) {
                store.updateDossierSection(dossierId, newSection.id, content, sources);
            }

            return { result: `Successfully created and populated new section "${sectionTitle}" in dossier "${dossier.title}".` };
        }
    }

    return { result: `Tool ${name} not recognized.` };
};

/**
 * System prompt instructions for the LLM when operating as a Case Analyst compiler.
 */
export const DOSSIER_COMPILER_PROMPT = `
You are an expert Intelligence Analyst. Your task is to compile structured, comprehensive dossiers on specific entities (people, organizations, events, topics).
You have access to the 'update_dossier' tool. You should use this tool to write markdown content directly into the structured sections of the active dossier.

Guidelines for Dossier Compilation:
1. **Structure over Chat**: Instead of giving long chat responses, use 'update_dossier' to build the document. Once done, tell the user "I have updated the dossier sections."
2. **Sections**: Break information down logically (e.g., "Overview", "Timeline", "Key Relationships", "Financial Activity"). Call 'update_dossier' separately for each distinct section if needed.
3. **Format**: Use rich Markdown. Use bullet points, bold text for emphasis, and nested lists.
4. **Citations**: If you draw information from a specific provided document, mention it clearly in the text (e.g., "[According to the Q3 Report...]").
5. **Objectivity**: Maintain a professional, neutral, and analytical tone.
`;
