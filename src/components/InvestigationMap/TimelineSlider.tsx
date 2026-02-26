import React, { useMemo } from 'react';
import './TimelineSlider.css';
import { Clock, Play, Pause, RotateCcw } from 'lucide-react';

interface TimelineSliderProps {
    minTimestamp: number;
    maxTimestamp: number;
    currentValue: number;
    onChange: (value: number) => void;
    isVisible: boolean;
}

export const TimelineSlider: React.FC<TimelineSliderProps> = ({
    minTimestamp,
    maxTimestamp,
    currentValue,
    onChange,
    isVisible
}) => {
    const [isPlaying, setIsPlaying] = React.useState(false);
    const playTimerRef = React.useRef<NodeJS.Timeout | null>(null);

    const formatDate = (ts: number) => {
        return new Date(ts).toLocaleString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    const progress = useMemo(() => {
        if (maxTimestamp === minTimestamp) return 100;
        return ((currentValue - minTimestamp) / (maxTimestamp - minTimestamp)) * 100;
    }, [currentValue, minTimestamp, maxTimestamp]);

    const currentValueRef = React.useRef(currentValue);
    React.useEffect(() => {
        currentValueRef.current = currentValue;
    }, [currentValue]);

    const handlePlayPause = () => {
        if (isPlaying) {
            if (playTimerRef.current) clearInterval(playTimerRef.current);
            setIsPlaying(false);
        } else {
            setIsPlaying(true);
            // If we're at the end, reset to start
            if (currentValueRef.current >= maxTimestamp) {
                onChange(minTimestamp);
                currentValueRef.current = minTimestamp;
            }
            
            const step = (maxTimestamp - minTimestamp) / 100; // 1% steps
            playTimerRef.current = setInterval(() => {
                const next = currentValueRef.current + step;
                if (next >= maxTimestamp) {
                    if (playTimerRef.current) clearInterval(playTimerRef.current);
                    setIsPlaying(false);
                    onChange(maxTimestamp);
                } else {
                    onChange(next);
                }
            }, 100);
        }
    };

    React.useEffect(() => {
        return () => {
            if (playTimerRef.current) clearInterval(playTimerRef.current);
        };
    }, []);

    if (!isVisible || minTimestamp === 0) return null;

    return (
        <div className="timeline-slider-container">
            <div className="timeline-controls">
                <button className="timeline-btn" onClick={handlePlayPause} title={isPlaying ? "Pause" : "Play Timeline"}>
                    {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button className="timeline-btn" onClick={() => { onChange(minTimestamp); setIsPlaying(false); }} title="Reset to Start">
                    <RotateCcw size={16} />
                </button>
            </div>
            
            <div className="timeline-track-wrapper">
                <div className="timeline-date-display min-date">{formatDate(minTimestamp)}</div>
                
                <div className="timeline-slider-wrapper">
                    <input
                        type="range"
                        min={minTimestamp}
                        max={maxTimestamp}
                        value={currentValue}
                        onChange={(e) => onChange(Number(e.target.value))}
                        className="timeline-range-input"
                    />
                    <div className="timeline-progress-bar" style={{ width: `${progress}%` }} />
                    <div className="timeline-current-marker" style={{ left: `${progress}%` }}>
                        <div className="timeline-current-tooltip">{formatDate(currentValue)}</div>
                    </div>
                </div>

                <div className="timeline-date-display max-date">{formatDate(maxTimestamp)}</div>
            </div>

            <div className="timeline-status">
                <Clock size={14} />
                <span>Timeline Active</span>
            </div>
        </div>
    );
};
