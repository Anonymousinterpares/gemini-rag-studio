import React, { useRef, useEffect } from 'react';

interface GlobalBackgroundProps {
  videoSrc: string;
  onVideoEnd?: () => void;
}

export const GlobalBackground: React.FC<GlobalBackgroundProps> = ({ videoSrc, onVideoEnd }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
        videoRef.current.playbackRate = 1;
    }
  }, []);

  return (
    <div className="global-background-wrapper" style={{ position: 'fixed', inset: 0, zIndex: -1, overflow: 'hidden', background: '#030306' }}>
      <video
        ref={videoRef}
        className="video-full"
        src={videoSrc}
        autoPlay
        muted
        playsInline
        onEnded={onVideoEnd}
        onError={onVideoEnd}
        style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.5,
            filter: 'brightness(0.8) contrast(1.2)',
            display: 'block'
        }}
      />
      <div 
        className="overlay-fx" 
        style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at center, transparent 0%, #030306 100%)',
            pointerEvents: 'none',
        }}
      />
    </div>
  );
};
