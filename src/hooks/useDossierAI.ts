import { useCallback } from 'react';
import { useSettingsStore } from '../store';
import { useDossierStore } from '../store/useDossierStore';
import { useCaseFileStore } from '../store/useCaseFileStore';
import { useToastStore } from '../store/useToastStore';
import { generateContent } from '../api/llm-provider';
import { getDossierTools, handleDossierToolCall, DOSSIER_COMPILER_PROMPT } from '../agents/dossier';

export const useDossierAI = () => {
    const { selectedModel, selectedProvider, apiKeys } = useSettingsStore();
    const { addToast } = useToastStore();

    const generateContextualDossier = useCallback(async (subject: string) => {
        if (!subject.trim()) {
            addToast("Dossier creation request unsuccessful - no text selected", "error", 1500);
            return;
        }

        const apiKey = apiKeys[selectedProvider];
        if (!apiKey) {
            addToast("Dossier creation failed: No API key set.", "error", 2000);
            return;
        }

        const caseFileStore = useCaseFileStore.getState();
        const cfContext = caseFileStore.caseFile
            ? `\n\n--- CASE FILE CONTEXT ---\n${caseFileStore.caseFile.sections.map((s: any) => `## ${s.title}\n${s.content}`).join('\n\n')}\n--- END CASE FILE ---`
            : '';

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
        const newDossierId = store.createDossier(dossierTitle, 'custom');
        addToast(`Dossier for "${dossierTitle}" under creation`, "info", 1500);

        try {
            const systemPrompt = `${DOSSIER_COMPILER_PROMPT}\n\nCURRENT ACTIVE DOSSIER ID: ${newDossierId}\nDOSSIER SUBJECT: ${subject}\n${cfContext}
            
            INSTRUCTION: Your task is to execute the 'update_dossier' tool ONLY. Read the provided Case File context and any external knowledge you have about "${subject}". Compile as complete a dossier as possible into the "Background" section, and if there are explicit timelines or key relations, create those sections too. DO NOT return conversational text, ONLY tool calls.`;

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

    return { generateContextualDossier };
};
