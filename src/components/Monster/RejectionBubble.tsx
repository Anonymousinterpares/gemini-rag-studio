import React, { useState, useEffect, useRef } from 'react';

interface RejectionBubbleProps {
  show: boolean;
}

export const RejectionBubble: React.FC<RejectionBubbleProps> = ({ show }) => {
  const [currentMessage, setCurrentMessage] = useState('');
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const rejectionMessages = React.useMemo(() => [
    "🚫 I can't digest that!",
    "❌ That's not my type of food!",
    "🙅‍♂️ I don't eat that kind of file!",
    "⛔ Sorry, unsupported format!",
    "🤢 That doesn't agree with me!",
    "🛑 I can't process that file type!",
    "💀 That's toxic to me!",
    "🙊 Can't handle that format!",
    "👎 Not on my menu!",
    "🔴 File type rejected!",
    "🚨 Incompatible format!",
    "🤒 That makes me feel sick!"
  ], []);

  const getRandomRejectionMessage = React.useCallback(() => {
    return rejectionMessages[Math.floor(Math.random() * rejectionMessages.length)];
  }, [rejectionMessages]);

  // Set message when component becomes visible
  useEffect(() => {
    if (show) {
      setCurrentMessage(getRandomRejectionMessage());
    }
  }, [show, getRandomRejectionMessage]);

  // Stable hover detection since the bubble is pointer-events: none
  useEffect(() => {
    if (!show) {
      if (isHovered) setIsHovered(false);
      return;
    }

    const checkHover = (e: MouseEvent) => {
      if (!bubbleRef.current) return;
      const rect = bubbleRef.current.getBoundingClientRect();
      const isInside = 
        e.clientX >= rect.left && 
        e.clientX <= rect.right && 
        e.clientY >= rect.top && 
        e.clientY <= rect.bottom;
      
      if (isInside !== isHovered) {
        setIsHovered(isInside);
      }
    };

    window.addEventListener('mousemove', checkHover);
    return () => window.removeEventListener('mousemove', checkHover);
  }, [show, isHovered]);

  if (!show) return null;

  return (
    <div ref={bubbleRef} className={`speech-bubble rejection-bubble ${isHovered ? 'is-hovered' : ''}`}>
      <div className="speech-text">
        {currentMessage}
      </div>
    </div>
  );
};
