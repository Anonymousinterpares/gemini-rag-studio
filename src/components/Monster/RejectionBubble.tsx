import React, { useState, useEffect } from 'react';

interface RejectionBubbleProps {
  show: boolean;
}

export const RejectionBubble: React.FC<RejectionBubbleProps> = ({ show }) => {
  const [currentMessage, setCurrentMessage] = useState('');

  const rejectionMessages = [
    "🚫 I can't digest that!",
    "❌ That's not my type of food!",
    "🙅‍♂️ I don't eat that kind of file!",
    "⛔ Sorry, unsupported format!",
    "🤢 That doesn't agree with me!",
    "🛑 I can't process that file type!",
    "😵 That file makes me sick!",
    "🤮 Yuck! Wrong file type!",
    "🚧 File format not supported!",
    "💀 That's toxic to me!",
    "🙊 Can't handle that format!",
    "👎 Not on my menu!",
    "🔴 File type rejected!",
    "🚨 Incompatible format!",
    "🤒 That makes me feel sick!"
  ];

  const getRandomRejectionMessage = () => {
    return rejectionMessages[Math.floor(Math.random() * rejectionMessages.length)];
  };

  // Set message when component becomes visible
  useEffect(() => {
    if (show) {
      setCurrentMessage(getRandomRejectionMessage());
    }
  }, [show]);

  if (!show) return null;

  return (
    <div className="speech-bubble rejection-bubble">
      <div className="speech-text">
        {currentMessage}
      </div>
    </div>
  );
};
