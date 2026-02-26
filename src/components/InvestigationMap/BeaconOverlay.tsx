import React from 'react';
import './BeaconOverlay.css';

interface BeaconOverlayProps {
    showTimestampBeacon: boolean;
    showCertaintyBeacon: boolean;
}

export const BeaconOverlay: React.FC<BeaconOverlayProps> = ({ 
    showTimestampBeacon, 
    showCertaintyBeacon 
}) => {
    if (!showTimestampBeacon && !showCertaintyBeacon) return null;

    return (
        <div className="beacon-container">
            {showTimestampBeacon && (
                <div className="beacon beacon-timestamp" title="AI-Suggested Timestamp (Unconfirmed)">
                    <span className="beacon-icon">🕒</span>
                </div>
            )}
            {showCertaintyBeacon && (
                <div className="beacon beacon-certainty" title="AI-Suggested Certainty (Unconfirmed)">
                    <span className="beacon-icon">🛡️</span>
                </div>
            )}
        </div>
    );
};
