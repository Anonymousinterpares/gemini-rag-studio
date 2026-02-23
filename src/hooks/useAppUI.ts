import { useState, useEffect } from 'react';
import { AppFile, ChatMessage } from '../types';

interface UseAppUIProps {
    isLoading: boolean;
    isEmbedding: boolean;
    activeJobCount: number;
    files: AppFile[];
    chatHistory: ChatMessage[];
    jobTimers: Record<string, any>;
    setJobTimers: (updater: (prev: Record<string, any>) => Record<string, any>) => void;
}

export const useAppUI = ({ isLoading, isEmbedding, activeJobCount, files, chatHistory, jobTimers, setJobTimers }: UseAppUIProps) => {
    const [glowType, setGlowType] = useState<'default' | 'blue' | 'yellow' | 'green' | 'red'>('default');
    const [showRejectionBubble, setShowRejectionBubble] = useState(false);
    const [hasLLMResponded, setHasLLMResponded] = useState(false);
    const [backgroundImages, setBackgroundImages] = useState<string[]>([]);
    const [dropVideoSrc, setDropVideoSrc] = useState('');
    const [showDropVideo, setShowDropVideo] = useState(false);

    useEffect(() => {
        if (glowType === 'red') return;
        const nextGlow = isLoading || isEmbedding || activeJobCount > 0 ? 'yellow' : (files.length === 0 ? 'default' : (!hasLLMResponded ? 'blue' : 'green'));
        if (nextGlow !== glowType) setGlowType(nextGlow);
    }, [isLoading, isEmbedding, activeJobCount, files.length, hasLLMResponded, glowType]);

    useEffect(() => {
        if (chatHistory.length > 1) {
            const last = chatHistory[chatHistory.length - 1];
            const isUser = chatHistory[chatHistory.length - 2]?.role === 'user';
            if (last.role === 'model' && !isLoading && !isEmbedding && isUser && !['Loading', 'Adding', 'Knowledge base'].some(s => (last.content || '').includes(s))) {
                if (!hasLLMResponded) setHasLLMResponded(true);
                setGlowType('green');
            }
        }
    }, [chatHistory, isLoading, isEmbedding, hasLLMResponded]);

    useEffect(() => {
        const active = Object.values(jobTimers).some(t => t.isActive);
        let interval: number;
        if (active) {
            interval = window.setInterval(() => {
                setJobTimers(prev => {
                    const next = { ...prev };
                    let changed = false;
                    for (const k in next) if (next[k].isActive) { next[k] = { ...next[k], elapsed: Date.now() - next[k].startTime }; changed = true; }
                    return changed ? next : prev;
                });
            }, 100);
        }
        return () => window.clearInterval(interval);
    }, [jobTimers, setJobTimers]);

    useEffect(() => {
        const discover = async () => {
            const bgs: string[] = [];
            for (let i = 1; i <= 20; i++) {
                const path = `/assets/background${i}.png`;
                try { await new Promise<void>((res, rej) => { const img = new Image(); img.onload = () => res(); img.onerror = () => rej(); img.src = path; }); bgs.push(path); }
                catch { break; }
            }
            setBackgroundImages(bgs);
        };
        discover();
    }, []);

    return {
        glowType, setGlowType,
        showRejectionBubble, setShowRejectionBubble,
        hasLLMResponded, setHasLLMResponded,
        backgroundImages, setBackgroundImages,
        dropVideoSrc, setDropVideoSrc,
        showDropVideo, setShowDropVideo
    };
};
