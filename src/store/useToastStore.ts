import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

export type ToastType = 'info' | 'success' | 'error' | 'warning' | 'system-alert';

export interface ToastMessage {
    id: string;
    message: string;
    type: ToastType;
    duration: number; // Duration to display before fading out
}

interface ToastState {
    toasts: ToastMessage[];
    addToast: (message: string, type?: ToastType, duration?: number) => void;
    removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
    toasts: [],
    addToast: (message, type = 'info', duration = 1000) => {
        const id = uuidv4();
        // The toast will be added to the state, and the component will handle the timeout to trigger fade and removal
        set((state) => ({
            toasts: [...state.toasts, { id, message, type, duration }],
        }));
    },
    removeToast: (id) =>
        set((state) => ({
            toasts: state.toasts.filter((t) => t.id !== id),
        })),
}));
