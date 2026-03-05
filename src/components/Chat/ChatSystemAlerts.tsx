import React, { useEffect, useState, useMemo } from 'react';
import { useToastStore, ToastMessage } from '../../store/useToastStore';
import './ChatSystemAlerts.css';

const AlertItem: React.FC<{ toast: ToastMessage }> = ({ toast }) => {
    const removeToast = useToastStore(state => state.removeToast);
    const [isFaded, setIsFaded] = useState(false);

    useEffect(() => {
        // Since the CSS handles the fadeInOut animation over 1s,
        // we just need to remove the toast from state after the animation completes.
        const timer = setTimeout(() => {
            setIsFaded(true);
            // Allow a small buffer before removing from state
            setTimeout(() => {
                removeToast(toast.id);
            }, 100);
        }, toast.duration);

        return () => clearTimeout(timer);
    }, [toast.id, toast.duration, removeToast]);

    if (isFaded) return null;

    return (
        <div className="chat-system-alert">
            {toast.message}
        </div>
    );
};

export const ChatSystemAlerts: React.FC = () => {
    const allToasts = useToastStore(state => state.toasts);
    const alerts = useMemo(() => 
        allToasts.filter(t => t.type === 'system-alert'),
        [allToasts]
    );

    if (alerts.length === 0) return null;

    return (
        <div className="chat-system-alerts-container">
            {alerts.map(alert => (
                <AlertItem key={alert.id} toast={alert} />
            ))}
        </div>
    );
};
