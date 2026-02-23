import { create } from 'zustand';
import { ChatMessage, TokenUsage } from '../types';

export interface CaseFileMetadata {
  initialAnalysis: string;
  suggestedQuestions: string[];
}

interface ChatState {
  chatHistory: ChatMessage[];
  historyStack: ChatMessage[][];
  userInput: string;
  pendingQuery: string | null;
  tokenUsage: TokenUsage;
  currentContextTokens: number;
  isLoading: boolean;
  abortController: AbortController | null;
  
  // Case File specific state
  caseFileState: {
    isAwaitingFeedback: boolean;
    metadata?: CaseFileMetadata;
  };
  
  // Actions
  setChatHistory: (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  undo: () => void;
  pushToStack: (history: ChatMessage[]) => void;
  setUserInput: (input: string) => void;
  setPendingQuery: (query: string | null) => void;
  setTokenUsage: (updater: TokenUsage | ((prev: TokenUsage) => TokenUsage)) => void;
  setCurrentContextTokens: (tokens: number) => void;
  setIsLoading: (loading: boolean) => void;
  setAbortController: (controller: AbortController | null) => void;
  clearHistory: (initialHistory: ChatMessage[]) => void;
  updateMessage: (index: number, update: Partial<ChatMessage>) => void;
  truncateHistory: (index: number) => void;
  setCaseFileState: (state: Partial<ChatState['caseFileState']>) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  chatHistory: [
    {
      role: 'model',
      content: "Hello! Drop your files or a project folder on the left to get started. I'll create a knowledge base from them, and you can ask me anything about their content.",
    },
  ],
  historyStack: [],
  userInput: '',
  pendingQuery: null,
  tokenUsage: { promptTokens: 0, completionTokens: 0 },
  currentContextTokens: 0,
  isLoading: false,
  abortController: null,
  caseFileState: {
    isAwaitingFeedback: false,
  },

  setChatHistory: (updater) => set((state) => {
    const nextHistory = typeof updater === 'function' ? updater(state.chatHistory) : updater;
    return { 
      // We only push to stack if the history actually changed to avoid redundant entries
      historyStack: state.chatHistory !== nextHistory ? [...state.historyStack, state.chatHistory].slice(-20) : state.historyStack,
      chatHistory: nextHistory 
    };
  }),

  undo: () => set((state) => {
    if (state.historyStack.length === 0) return state;
    const previous = state.historyStack[state.historyStack.length - 1];
    return {
      chatHistory: previous,
      historyStack: state.historyStack.slice(0, -1)
    };
  }),

  pushToStack: (history) => set((state) => ({
    historyStack: [...state.historyStack, history].slice(-20)
  })),

  setUserInput: (input) => set({ userInput: input }),
  
  setPendingQuery: (query) => set({ pendingQuery: query }),
  
  setTokenUsage: (updater) => set((state) => ({
    tokenUsage: typeof updater === 'function' ? updater(state.tokenUsage) : updater
  })),

  setCurrentContextTokens: (tokens) => set({ currentContextTokens: tokens }),

  setIsLoading: (loading) => set({ isLoading: loading }),

  setAbortController: (controller) => set({ abortController: controller }),

  clearHistory: (initialHistory) => set({
    chatHistory: initialHistory,
    tokenUsage: { promptTokens: 0, completionTokens: 0 },
    userInput: '',
    pendingQuery: null,
    abortController: null,
    caseFileState: { isAwaitingFeedback: false }
  }),

  updateMessage: (index, update) => set((state) => {
    const newHistory = [...state.chatHistory];
    if (newHistory[index]) {
      newHistory[index] = { ...newHistory[index], ...update };
    }
    return { 
      historyStack: [...state.historyStack, state.chatHistory].slice(-20),
      chatHistory: newHistory 
    };
  }),

  truncateHistory: (index) => set((state) => ({
    chatHistory: state.chatHistory.slice(0, index + 1)
  })),

  setCaseFileState: (state) => set((prev) => ({
    caseFileState: { ...prev.caseFileState, ...state }
  })),
}));
