import { useCallback } from 'react';
import { useSettingsStore } from '../store';
import { useDossierStore } from '../store/useDossierStore';
import { useMapStore } from '../store/useMapStore';
import { useToastStore } from '../store/useToastStore';
import { generateContent } from '../api/llm-provider';
import { getDossierTools, handleDossierToolCall, DOSSIER_COMPILER_PROMPT } from '../agents/dossier';

export const useDossierAI = () => {
    const { selectedModel, selectedProvider, apiKeys } = useSettingsStore();
    const { addToast } = useToastStore();

    const generateContextualDossier = useCallback(async (subject: string, existingDossierId?: string) => {
        if (!subject.trim()) {
            addToast("Dossier creation request unsuccessful - no text selected", "error", 1500);
            return;
        }

        const apiKey = apiKeys[selectedProvider];
        if (!apiKey) {
            addToast("Dossier creation failed: No API key set.", "error", 2000);
            return;
        }

        const mapStore = useMapStore.getState();
        let mapContext = '';
        if (mapStore.nodes.length > 0 || mapStore.edges.length > 0) {
            mapContext = `\n\n--- INVESTIGATION MAP CONTEXT ---\nThe global map currently tracks ${mapStore.nodes.length} entity nodes and ${mapStore.edges.length} relationship edges.\n--- END MAP ---`;
        }

        // Determine Dossier Title
        let dossierTitle = subject;
        if (subject.length > 30) {
            try {
                const titleResponse = await generateContent(selectedModel, apiKey, [
                    { role: 'system', content: 'You are a highly concise assistant. Your task is to extract a brief 3-5 word title for the provided text. Return ONLY the title.' },
                    { role: 'user', content: subject }
                ]);
                if (titleResponse.text && titleResponse.text.trim()) {
                    dossierTitle = titleResponse.text.replace(/["']/g, '').trim();
                } else {
                    dossierTitle = subject.substring(0, 30) + '...';
                }
            } catch (err) {
                console.error('Failed to generate title:', err);
                dossierTitle = subject.substring(0, 30) + '...';
            }
        }

        // Mint a new dossier
        const store = useDossierStore.getState();
        let newDossierId = existingDossierId;
        if (!newDossierId) {
            newDossierId = store.createDossier(dossierTitle, 'custom');
        } else {
            store.clearDossierSections(newDossierId);
        }
        addToast(`Dossier for "${dossierTitle}" under creation`, "info", 1500);

        try {
            const systemPrompt = `${DOSSIER_COMPILER_PROMPT}\n\nCURRENT ACTIVE DOSSIER ID: ${newDossierId}\nDOSSIER SUBJECT: ${subject}\n${mapContext}
            
            INSTRUCTION: Your task is to execute the 'update_dossier' tool ONLY. Read the provided Map context and any external knowledge you have about "${subject}". Compile as complete a dossier as possible into the "Background" section, and if there are explicit timelines or key relations, create those sections too. DO NOT return conversational text, ONLY tool calls.`;

            const userContent = `Create a comprehensive dossier for ${subject}.`;

            const messages = [
                { role: 'system' as const, content: systemPrompt },
                { role: 'user' as const, content: userContent }
            ];

            const tools = getDossierTools();
            const response = await generateContent(selectedModel, apiKey, messages, tools);

            console.log(`[DossierAI] Background response for ${subject}:`, response);

            if (response.toolCalls && response.toolCalls.length > 0) {
                for (const tc of response.toolCalls) {
                    if (tc.function.name === 'update_dossier') {
                        const args = JSON.parse(tc.function.arguments);
                        await handleDossierToolCall(tc.function.name, args);
                    }
                }
                addToast(`Dossier for "${dossierTitle}" was created`, "success", 1500);
            } else {
                addToast(`Dossier creation unsuccessful - no data returned for "${dossierTitle}"`, "error", 2000);
            }
        } catch (error) {
            console.error(`[DossierAI] Failed to compile dossier for ${subject}:`, error);
            addToast(`Dossier creation unsuccessful - error occurred.`, "error", 2000);
        }
    }, [selectedModel, selectedProvider, apiKeys, addToast]);

    const chatWithDossier = useCallback(async (dossierId: string, instruction: string) => {
        const apiKey = apiKeys[selectedProvider];
        if (!apiKey) {
            addToast("Dossier edit failed: No API key set.", "error", 2000);
            return { didEdit: false, text: "No API key set." };
        }

        const store = useDossierStore.getState();
        const dossier = store.dossiers.find(d => d.id === dossierId);
        if (!dossier) return { didEdit: false, text: "Dossier not found." };

        const dossierText = dossier.sections.map(s => `## ${s.title}\n${s.content}`).join('\n\n');

        const systemPrompt = `${DOSSIER_COMPILER_PROMPT}\n\nCURRENT ACTIVE DOSSIER ID: ${dossier.id}\nDOSSIER SUBJECT: ${dossier.title}\n\nCurrent Dossier Content:\n${dossierText}\n\nINSTRUCTION: The user is requesting modifications or clarifications. Use the 'update_dossier' tool to make edits to the dossier sections. If you need clarification before making edits, respond with conversational text. DO NOT just say "I have updated" unless you actually executed the tool.`;

        const messages = [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: instruction }
        ];

        try {
            const tools = getDossierTools();
            const response = await generateContent(selectedModel, apiKey, messages, tools);

            let didEdit = false;
            if (response.toolCalls && response.toolCalls.length > 0) {
                for (const tc of response.toolCalls) {
                    if (tc.function.name === 'update_dossier') {
                        const args = JSON.parse(tc.function.arguments);
                        await handleDossierToolCall(tc.function.name, args, { proposeOnly: true });
                        didEdit = true;
                    }
                }
            }

            return { text: response.text, didEdit };
        } catch (err: any) {
            console.error('Local Dossier Chat Error:', err);
            return { didEdit: false, text: `Error: ${err.message}` };
        }
    }, [selectedModel, selectedProvider, apiKeys, addToast]);

    return { generateContextualDossier, chatWithDossier };
};
