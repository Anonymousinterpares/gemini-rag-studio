import { create } from 'zustand';
import { ChatMessage, TokenUsage } from '../types';

export interface CaseFileMetadata {
  initialAnalysis: string;
  suggestedQuestions: string[];
}

interface ChatState {
  chatHistory: ChatMessage[];
  userInput: string;
  pendingQuery: string | null;
  tokenUsage: TokenUsage;
  isLoading: boolean;
  abortController: AbortController | null;
  
  // Case File specific state
  caseFileState: {
    isAwaitingFeedback: boolean;
    metadata?: CaseFileMetadata;
  };
  
  // Actions
  setChatHistory: (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setUserInput: (input: string) => void;
  setPendingQuery: (query: string | null) => void;
  setTokenUsage: (updater: TokenUsage | ((prev: TokenUsage) => TokenUsage)) => void;
  setIsLoading: (loading: boolean) => void;
  setAbortController: (controller: AbortController | null) => void;
  clearHistory: (initialHistory: ChatMessage[]) => void;
  updateMessage: (index: number, content: string) => void;
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
  userInput: '',
  pendingQuery: null,
  tokenUsage: { promptTokens: 0, completionTokens: 0 },
  isLoading: false,
  abortController: null,
  caseFileState: {
    isAwaitingFeedback: false,
  },

  setChatHistory: (updater) => set((state) => ({
    chatHistory: typeof updater === 'function' ? updater(state.chatHistory) : updater
  })),

  setUserInput: (input) => set({ userInput: input }),
  
  setPendingQuery: (query) => set({ pendingQuery: query }),
  
  setTokenUsage: (updater) => set((state) => ({
    tokenUsage: typeof updater === 'function' ? updater(state.tokenUsage) : updater
  })),

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

  updateMessage: (index, content) => set((state) => {
    const newHistory = [...state.chatHistory];
    if (newHistory[index]) {
      newHistory[index] = { ...newHistory[index], content };
    }
    return { chatHistory: newHistory };
  }),

  truncateHistory: (index) => set((state) => ({
    chatHistory: state.chatHistory.slice(0, index + 1)
  })),

  setCaseFileState: (state) => set((prev) => ({
    caseFileState: { ...prev.caseFileState, ...state }
  })),
}));
