import { useCallback, useState, MutableRefObject } from 'react';
import { useMapStore } from '../store/useMapStore';
import { useMapUpdateQueue } from '../store/useMapUpdateQueue';
import { useSettingsStore, useFileStore, useChatStore } from '../store';
import { CaseFileSection } from '../types';
import { useToastStore } from '../store/useToastStore';
import { ComputeCoordinator } from '../compute/coordinator';
import { VectorStore } from '../rag/pipeline';
import { runMappingPipeline } from '../utils/mappingService';

// ─── Hook ──────────────────────────────────────────────────────────────────────

export const useMapAI = (config?: {
    coordinator: MutableRefObject<ComputeCoordinator | null>;
    vectorStore: MutableRefObject<VectorStore | null>;
    queryEmbeddingResolver: MutableRefObject<((value: number[]) => void) | null>;
}) => {
    const [isMapProcessing, setIsMapProcessing] = useState(false);
    const [reviewTokenWarning, setReviewTokenWarning] = useState<{ 
        estimatedTokens: number;
        onConfirmAll: () => void;
        onConfirmTrimmed: () => void;
        onCancel: () => void;
    } | null>(null);

    const { selectedModel, selectedProvider, apiKeys, appSettings } = useSettingsStore();
    const { addToast } = useToastStore();
    const { files } = useFileStore();

    // ── drainUpdateQueue ────────────────────────────────────────────────────────
    const drainUpdateQueue = useCallback(async () => {
        const queue = useMapUpdateQueue.getState();
        const update = queue.dequeueUpdate();
        if (!update || update.length === 0) return;

        const summaries = update.map(r => `**${r.title}** (${r.link})\n${r.snippet}`).join('\n---\n');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any)._handleMapInstruction) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (window as any)._handleMapInstruction(`Incorporate the following new research findings into the map:\n${summaries}`);
            addToast(`Map updated from search results.`, 'success');
        }
    }, [addToast]);

    // ── handleMapInstruction ──────────────────────────────────────────────────
    const handleMapInstruction = useCallback(async (
        instruction: string,
        contextNodeId?: string,
        caseFileText?: string
    ) => {
        const mapStore = useMapStore.getState();
        if (!mapStore.acquireLock()) {
            addToast('Map update already in progress.', 'warning');
            return;
        }

        setIsMapProcessing(true);
        const apiKey = apiKeys[selectedProvider];

        try {
            const result = await runMappingPipeline({
                instruction,
                mapStore,
                apiKey,
                selectedModel,
                files,
                appSettings,
                contextNodeId,
                caseFileText,
                config,
                onProgress: (label) => mapStore.setProgress({ phase: 1, batchCurrent: 1, batchTotal: 1, label })
            });

            if (result.success && (result.totalChanges ?? 0) > 0) {
                addToast('Map updated successfully.', 'success');
            } else if (result.success) {
                mapStore.setMapError("No new mappable information was found.");
            } else {
                mapStore.setMapError(result.error || "Error updating map.");
            }
        } finally {
            mapStore.setProgress(null);
            setIsMapProcessing(false);
            mapStore.releaseLock();
            drainUpdateQueue();
        }
    }, [apiKeys, selectedProvider, selectedModel, addToast, drainUpdateQueue, config, files, appSettings]);

    // ── generateMapFromDocument (Two-Phase) ────────────────────────────────────
    const generateMapFromDocument = useCallback(async (caseFileSections: CaseFileSection[]) => {
        const mapStore = useMapStore.getState();
        if (!mapStore.acquireLock()) {
            addToast('Map generation already in progress.', 'warning');
            return;
        }

        setIsMapProcessing(true);
        const apiKey = apiKeys[selectedProvider];

        try {
            const instruction = `Analyze and map: ${caseFileSections.map(s => s.title).join(', ')}`;
            const caseFileText = caseFileSections.map(s => s.content).join('\n\n');

            const result = await runMappingPipeline({
                instruction,
                mapStore,
                apiKey,
                selectedModel,
                files,
                appSettings,
                caseFileText,
                config,
                onProgress: (label) => mapStore.setProgress({ phase: 1, batchCurrent: 1, batchTotal: 1, label })
            });

            if (result.success) {
                addToast('Map generated successfully.', 'success');
            }
        } finally {
            mapStore.setProgress(null);
            setIsMapProcessing(false);
            mapStore.releaseLock();
            drainUpdateQueue();
        }
    }, [apiKeys, selectedProvider, selectedModel, addToast, drainUpdateQueue, appSettings, files, config]);

    // ── reviewMapConnections ────────────────────────────────────────────────────
    const reviewMapConnections = useCallback(async (nodeIds?: string[]) => {
        const mapStore = useMapStore.getState();
        if (!mapStore.acquireLock()) return;
        setIsMapProcessing(true);
        const apiKey = apiKeys[selectedProvider];

        try {
            const chatHistory = useChatStore.getState().chatHistory;
            const instruction = nodeIds?.length
                ? `Review connections for: ${nodeIds.join(', ')}.`
                : `Perform a global review of all entities and relationships. Fix typos and find missing connections.`;

            const result = await runMappingPipeline({
                instruction,
                mapStore,
                apiKey,
                selectedModel,
                files,
                appSettings,
                chatHistory,
                config,
                onProgress: (label) => mapStore.setProgress({ phase: 1, batchCurrent: 1, batchTotal: 1, label })
            });

            if (result.success && (result.totalChanges ?? 0) > 0) {
                addToast(`Map review complete: ${result.totalChanges} changes applied.`, 'success');
            } else if (result.success) {
                addToast('Map review complete: no changes needed.', 'info');
            }
        } finally {
            mapStore.setProgress(null);
            setIsMapProcessing(false);
            mapStore.releaseLock();
            drainUpdateQueue();
        }
    }, [apiKeys, selectedProvider, selectedModel, addToast, drainUpdateQueue, appSettings, files, config]);

    return {
        handleMapInstruction,
        generateMapFromDocument,
        reviewMapConnections,
        isMapProcessing,
        reviewTokenWarning,
        dismissReviewWarning: () => setReviewTokenWarning(null),
    };
};
