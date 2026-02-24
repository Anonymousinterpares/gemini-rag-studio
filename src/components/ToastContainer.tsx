import React, { useEffect, useState } from 'react';
import { useToastStore, ToastMessage } from '../store/useToastStore';
import { Info, CheckCircle, AlertCircle } from 'lucide-react';
import './ToastContainer.css';

const Toast: React.FC<{ toast: ToastMessage }> = ({ toast }) => {
    const removeToast = useToastStore(state => state.removeToast);
    const [isFadingOut, setIsFadingOut] = useState(false);

    useEffect(() => {
        const fadeTimer = setTimeout(() => {
            setIsFadingOut(true);
        }, toast.duration);

        // Remove from DOM after CSS fade transition
        const removeTimer = setTimeout(() => {
            removeToast(toast.id);
        }, toast.duration + 500);

        return () => {
            clearTimeout(fadeTimer);
            clearTimeout(removeTimer);
        };
    }, [toast, removeToast]);

    let Icon = Info;
    let colorClass = 'toast-info';
    if (toast.type === 'success') { Icon = CheckCircle; colorClass = 'toast-success'; }
    else if (toast.type === 'error') { Icon = AlertCircle; colorClass = 'toast-error'; }
    else if (toast.type === 'info') { Icon = Info; colorClass = 'toast-info'; }

    return (
        <div className={`toast-message ${colorClass} ${isFadingOut ? 'toast-fade-out' : 'toast-fade-in'}`}>
            <Icon size={16} />
            <span>{toast.message}</span>
        </div>
    );
};

export const ToastContainer: React.FC = () => {
    const toasts = useToastStore(state => state.toasts);

    if (toasts.length === 0) return null;

    return (
        <div className="toast-container">
            {toasts.map(t => <Toast key={t.id} toast={t} />)}
        </div>
    );
};
