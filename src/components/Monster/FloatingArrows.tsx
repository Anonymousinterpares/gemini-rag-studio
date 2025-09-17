import React from 'react';

interface FloatingArrowsProps {
  show: boolean;
}

export const FloatingArrows: React.FC<FloatingArrowsProps> = ({ show }) => {
  if (!show) return null;

  return (
    <div className="floating-arrows">
      <div className="floating-arrow arrow-1">👆</div>
      <div className="floating-arrow arrow-2">👉</div>
      <div className="floating-arrow arrow-3">☝️</div>
    </div>
  );
};
