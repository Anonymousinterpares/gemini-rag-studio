import React, { useState, useEffect, useRef } from 'react';
import './ValidatedDateTimeInput.css';

interface ValidatedDateTimeInputProps {
    value: string | null;
    onChange: (newValue: string | null) => void;
    onConfirm: () => void;
}

type Segment = 'day' | 'month' | 'year' | 'hour' | 'min' | 'sec';

export const ValidatedDateTimeInput: React.FC<ValidatedDateTimeInputProps> = ({ value, onChange, onConfirm }) => {
    const [segments, setSegments] = useState({
        day: '',
        month: '',
        year: '',
        hour: '',
        min: '',
        sec: ''
    });
    const [error, setError] = useState<string | null>(null);
    const [isFlash, setIsFlash] = useState(false);
    
    const refs = {
        day: useRef<HTMLInputElement>(null),
        month: useRef<HTMLInputElement>(null),
        year: useRef<HTMLInputElement>(null),
        hour: useRef<HTMLInputElement>(null),
        min: useRef<HTMLInputElement>(null),
        sec: useRef<HTMLInputElement>(null)
    };

    // Parse initial value: DD.MM.YYYY HH:MM:SS
    useEffect(() => {
        if (!value) {
            setSegments({ day: '', month: '', year: '', hour: '', min: '', sec: '' });
            return;
        }
        const parts = value.split(/[.\s:]+/);
        if (parts.length === 6) {
            setSegments({
                day: parts[0],
                month: parts[1],
                year: parts[2],
                hour: parts[3],
                min: parts[4],
                sec: parts[5]
            });
        }
    }, [value]);

    const showError = (msg: string) => {
        setError(msg);
        setIsFlash(true);
        setTimeout(() => {
            setError(null);
            setIsFlash(false);
        }, 1000);
    };

    const isLeapYear = (year: number) => {
        return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    };

    const getDaysInMonth = (month: number, year: number) => {
        if (month === 2) return isLeapYear(year) ? 29 : 28;
        if ([4, 6, 9, 11].includes(month)) return 30;
        return 31;
    };

    const validateAndMove = (segment: Segment, val: string, nextSegment?: Segment) => {
        const numericVal = parseInt(val);
        const yearVal = parseInt(segments.year) || new Date().getFullYear();

        switch (segment) {
            case 'day': {
                const monthVal = parseInt(segments.month) || 1;
                const maxDays = getDaysInMonth(monthVal, yearVal);
                if (numericVal > maxDays) {
                    showError(`${segments.month ? 'Month' : 'Day'} limit: ${maxDays}`);
                    return;
                }
                if (val.length === 1 && parseInt(val) > 3) {
                     // Auto-prefix 0 if first digit makes it impossible to be > 31
                     val = '0' + val;
                }
                break;
            }
            case 'month': {
                if (numericVal > 12) {
                    showError("Month limit: 12");
                    return;
                }
                if (val.length === 1 && parseInt(val) > 1) val = '0' + val;
                break;
            }
            case 'hour':
                if (numericVal > 23) {
                    showError("Hour limit: 23");
                    return;
                }
                if (val.length === 1 && parseInt(val) > 2) val = '0' + val;
                break;
            case 'min':
            case 'sec':
                if (numericVal > 59) {
                    showError("Limit: 59");
                    return;
                }
                if (val.length === 1 && parseInt(val) > 5) val = '0' + val;
                break;
        }

        const newSegments = { ...segments, [segment]: val };
        setSegments(newSegments);

        // Auto-advance if segment is full
        const isFull = (segment === 'year' && val.length === 4) || (segment !== 'year' && val.length === 2);
        if (isFull && nextSegment) {
            refs[nextSegment].current?.focus();
        }

        // Emit change
        const { day, month, year, hour, min, sec } = newSegments;
        if (day && month && year && hour && min && sec) {
            onChange(`${day}.${month}.${year} ${hour}:${min}:${sec}`);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent, segment: Segment, prevSegment?: Segment) => {
        if (e.key === 'Enter') {
            onConfirm();
            return;
        }

        if (e.key === 'Backspace' && !segments[segment] && prevSegment) {
            refs[prevSegment].current?.focus();
            return;
        }

        if (!/[0-9]/.test(e.key) && !['Backspace', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) {
            e.preventDefault();
        }
    };

    const renderInput = (segment: Segment, placeholder: string, maxLength: number, next?: Segment, prev?: Segment) => (
        <input
            ref={refs[segment]}
            type="text"
            className={`datetime-segment ${isFlash && error?.toLowerCase().includes(segment.replace('min','').replace('sec','')) ? 'flash-error' : ''}`}
            value={segments[segment]}
            placeholder={placeholder}
            onChange={(e) => validateAndMove(segment, e.target.value.slice(0, maxLength), next)}
            onKeyDown={(e) => handleKeyDown(e, segment, prev)}
        />
    );

    return (
        <div className={`datetime-input-container ${isFlash ? 'container-flash' : ''}`}>
            <div className="segments-row">
                {renderInput('day', 'DD', 2, 'month')}
                <span className="separator">.</span>
                {renderInput('month', 'MM', 2, 'year', 'day')}
                <span className="separator">.</span>
                {renderInput('year', 'YYYY', 4, 'hour', 'month')}
                <span className="spacer" />
                {renderInput('hour', 'HH', 2, 'min', 'year')}
                <span className="separator">:</span>
                {renderInput('min', 'MM', 2, 'sec', 'hour')}
                <span className="separator">:</span>
                {renderInput('sec', 'SS', 2, undefined, 'min')}
            </div>
            {error && <div className="datetime-error-tooltip">{error}</div>}
        </div>
    );
};
