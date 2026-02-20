import React, { useState, useEffect, useRef } from 'react';

interface SpeechBubbleProps {
  filesCount: number;
  isProcessing: boolean;
  isEmbedding: boolean;
}

export const SpeechBubble: React.FC<SpeechBubbleProps> = ({ 
  filesCount, 
  isProcessing, 
  isEmbedding 
}) => {
  const [currentMessage, setCurrentMessage] = useState('');
  const [currentEmoji, setCurrentEmoji] = useState('');
  const intervalRef = useRef<number | undefined | null>(null);
  const lastStateRef = useRef('');

  const messageVariants = React.useMemo(() => ({
    idle: [
      "Feed me some documents!",
      "I'm hungry for knowledge!",
      "Drop your files here!",
      "I need some digital food!",
      "Bring me your documents!",
      "Got any tasty files for me?",
      "I'm starving for data!",
      "Time to feed the knowledge monster!"
    ],
    processing: [
      "I'm thinking...",
      "Let me ponder this...",
      "Processing your request...",
      "Hmm, give me a moment...",
      "Working on it...",
      "Crunching the data...",
      "Let me digest this...",
      "Computing your answer..."
    ],
    partial: [
      "Mmm, more please!",
      "I'm still hungry!",
      "Keep feeding me!",
      "More documents, please!",
      "Don't stop now!",
      "Getting tastier!",
      "I can eat more!",
      "Keep the feast coming!"
    ],
    almostFull: [
      "Getting full... keep going!",
      "Almost satisfied!",
      "I can handle more!",
      "Keep the feast coming!",
      "A few more won't hurt!",
      "Nearly stuffed!",
      "Just a bit more space!",
      "Almost at capacity!"
    ],
    full: [
      "I'm stuffed! Ready to chat!",
      "So full! Let's talk!",
      "Perfectly fed! Ask me anything!",
      "Ready to help you now!",
      "All set! What would you like to know?",
      "Bursting with knowledge!",
      "Fully loaded and ready!",
      "Knowledge tank is full!"
    ]
  }), []);

  const getRandomMessage = React.useCallback((messages: string[]) => {
    return messages[Math.floor(Math.random() * messages.length)];
  }, []);

  const getCurrentState = React.useCallback(() => {
    if (isProcessing || isEmbedding) return 'processing';
    if (filesCount === 0) return 'idle';
    if (filesCount <= 5) return 'partial';
    if (filesCount <= 10) return 'almostFull';
    return 'full';
  }, [isProcessing, isEmbedding, filesCount]);

  const getEmoji = React.useCallback((state: string) => {
    switch (state) {
      case 'processing': return "🤔";
      case 'idle': return "😋";
      case 'partial': return "🤤";
      case 'almostFull': return "😊";
      case 'full': return "🤪";
      default: return "😋";
    }
  }, []);

  // Update message when state changes (action-based)
  useEffect(() => {
    const currentState = getCurrentState();
    const stateKey = `${currentState}-${filesCount}`;
    
    // Only update message if state actually changed (not on every render)
    if (lastStateRef.current !== stateKey) {
      lastStateRef.current = stateKey;
      const messages = messageVariants[currentState as keyof typeof messageVariants] || messageVariants.idle;
      setCurrentMessage(getRandomMessage(messages));
      setCurrentEmoji(getEmoji(currentState));
    }
  }, [getCurrentState, getRandomMessage, getEmoji, filesCount, messageVariants]);

  // Set up idle cycling (only for idle state)
  useEffect(() => {
    const currentState = getCurrentState();
    
    if (currentState === 'idle') {
      // Cycle through idle messages every 10 seconds
      intervalRef.current = window.setInterval(() => {
        setCurrentMessage(getRandomMessage(messageVariants.idle));
      }, 10000);
    } else {
      // Clear interval for non-idle states
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [getCurrentState, getRandomMessage, messageVariants.idle]);

  // Initialize message on mount
  useEffect(() => {
    const currentState = getCurrentState();
    const messages = messageVariants[currentState as keyof typeof messageVariants] || messageVariants.idle;
    setCurrentMessage(getRandomMessage(messages));
    setCurrentEmoji(getEmoji(currentState));
    lastStateRef.current = `${currentState}-${filesCount}`;
  }, [getCurrentState, getRandomMessage, getEmoji, filesCount, messageVariants]);

  // Stable hover detection since the bubble is pointer-events: none
  const [isHovered, setIsHovered] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
  }, [isHovered]);

  return (
    <div ref={bubbleRef} className={`speech-bubble ${isHovered ? 'is-hovered' : ''}`}>
      <div className="speech-text">
        <span className="speech-emoji">{currentEmoji}</span>
        {currentMessage}
      </div>
    </div>
  );
};
