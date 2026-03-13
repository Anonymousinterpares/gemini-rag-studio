import { FC, ReactNode } from 'react';
import { Loader } from 'lucide-react';
import './ProgressBar.css';

interface ProgressBarProps {
    progress: number;
    total: number;
    label: string;
    showCount?: boolean;
    isSpinning?: boolean;
    className?: string;
    children?: ReactNode;
}

export const ProgressBar: FC<ProgressBarProps> = ({ 
    progress, 
    total, 
    label, 
    showCount = true, 
    isSpinning = true,
    className = '',
    children
}) => {
    const percentage = total > 0 ? Math.min(100, Math.max(0, (progress / total) * 100)) : 0;

    return (
        <div className={`common-progress-container ${className}`}>
            {isSpinning && <Loader size={13} className="animate-spin" style={{ marginRight: 6 }} />}
            <span className="common-progress-label">{label}</span>
            {showCount && total > 0 && (
                <span className="common-progress-count">
                    {progress}/{total}
                </span>
            )}
            <div className="common-progress-bar-track">
                <div 
                    className="common-progress-bar-fill" 
                    style={{ width: `${percentage}%` }}
                />
            </div>
            {children}
        </div>
    );
};
