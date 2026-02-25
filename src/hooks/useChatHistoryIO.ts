import { useCallback } from 'react';
import { useChatStore } from '../store/useChatStore';
import { useProjectStore } from '../store/useProjectStore';
import { saveChatSession, loadAllChatSessions, deleteChatSession, loadChatSession } from '../utils/db';
import { ChatMessage, TokenUsage } from '../types';

export const useChatHistoryIO = () => {
    const {
        activeSessionId,
        setActiveSessionId,
        setSessionList,
        clearHistory,
        setTokenUsage,
    } = useChatStore();

    const createNewSession = useCallback(() => {
        const newId = crypto.randomUUID();
        setActiveSessionId(newId);

        // We must pass the initial history so clearHistory doesn't just empty it entirely if it expects an array
        clearHistory([
            {
                role: 'model' as const,
                content: "Hello! Drop your files or a project folder on the left to get started. I'll create a knowledge base from them, and you can ask me anything about their content.",
            }
        ]);
        setTokenUsage({ promptTokens: 0, completionTokens: 0 });
    }, [setActiveSessionId, clearHistory, setTokenUsage]);

    const initSessions = useCallback(async () => {
        // Prevent infinite loops by only booting up if there is no active session yet
        if (useChatStore.getState().activeSessionId) return;

        const activeProjectId = useProjectStore.getState().activeProjectId;
        if (!activeProjectId) return;

        try {
            const sessions = await loadAllChatSessions(activeProjectId);

            if (sessions.length > 0) {
                setSessionList(sessions.map(s => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt })));

                // Auto-load the most recent session
                const mostRecent = sessions[0];
                setActiveSessionId(mostRecent.id);
                clearHistory(mostRecent.chatHistory);
                setTokenUsage(mostRecent.tokenUsage);
            } else {
                createNewSession();
            }
        } catch (e) {
            console.error("Failed to load chat sessions from IndexedDB", e);
            setSessionList([]);
            createNewSession();
        }
    }, [setSessionList, clearHistory, setTokenUsage, setActiveSessionId, createNewSession]);

    const autoSaveCurrentSession = useCallback(async (sessionId: string, history: ChatMessage[], usage: TokenUsage) => {
        if (!sessionId) return;
        // Do not save empty conversations to the database. They must have user content.
        if (history.length <= 1) return;

        const activeProjectId = useProjectStore.getState().activeProjectId;
        if (!activeProjectId) return;

        try {
            const existing = await loadChatSession(sessionId);
            const now = Date.now();

            let title = existing ? existing.title : "New Conversation";

            // Auto-generate title from first user message if name is still default
            if (title === "New Conversation") {
                const firstUserMsg = history.find(m => m.role === 'user' && m.content);
                if (firstUserMsg && firstUserMsg.content) {
                    title = firstUserMsg.content.slice(0, 40) + (firstUserMsg.content.length > 40 ? '...' : '');
                }
            }

            const updatedSession = {
                id: sessionId,
                projectId: activeProjectId,
                title,
                createdAt: existing ? existing.createdAt : now,
                updatedAt: now,
                chatHistory: history,
                tokenUsage: usage
            };

            await saveChatSession(updatedSession);

            // Refresh sidebar list
            const sessions = await loadAllChatSessions(activeProjectId);
            setSessionList(sessions.map(s => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt })));

        } catch (e) {
            console.error("Failed to auto-save session", e);
        }
    }, [setSessionList]);


    const switchSession = useCallback(async (id: string) => {
        try {
            const session = await loadChatSession(id);
            if (session) {
                setActiveSessionId(id);

                // Rehydrate the store completely
                clearHistory(session.chatHistory);
                setTokenUsage(session.tokenUsage);
            }
        } catch (e) {
            console.error("Failed to switch session", e);
        }
    }, [setActiveSessionId, clearHistory, setTokenUsage]);

    const deleteSession = useCallback(async (id: string) => {
        const activeProjectId = useProjectStore.getState().activeProjectId;
        if (!activeProjectId) return;

        try {
            await deleteChatSession(id);

            const sessions = await loadAllChatSessions(activeProjectId);
            setSessionList(sessions.map(s => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt })));

            // If we deleted the active one, pick the next most recent, or create a new one
            if (id === activeSessionId) {
                if (sessions.length > 0) {
                    switchSession(sessions[0].id);
                } else {
                    createNewSession();
                }
            }
        } catch (e) {
            console.error("Failed to delete session", e);
        }
    }, [activeSessionId, setSessionList, switchSession, createNewSession]);

    const renameSession = useCallback(async (id: string, newTitle: string) => {
        const activeProjectId = useProjectStore.getState().activeProjectId;
        if (!activeProjectId) return;

        try {
            const existing = await loadChatSession(id);
            if (existing) {
                existing.title = newTitle;
                await saveChatSession(existing);

                const sessions = await loadAllChatSessions(activeProjectId);
                setSessionList(sessions.map(s => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt })));
            }
        } catch (e) {
            console.error("Failed to rename session", e);
        }
    }, [setSessionList]);


    return {
        initSessions,
        createNewSession,
        autoSaveCurrentSession,
        switchSession,
        deleteSession,
        renameSession
    };
};
