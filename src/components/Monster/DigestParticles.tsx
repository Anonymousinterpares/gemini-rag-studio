import React from 'react';

interface DigestParticlesProps {
  isActive: boolean;
}

export const DigestParticles: React.FC<DigestParticlesProps> = ({ isActive }) => {
  if (!isActive) return null;

  return (
    <div className="digest-particles">
      {[...Array(8)].map((_, i) => (
        <div 
          key={i} 
          className="digest-particle"
          style={{ 
            left: `${10 + (i * 10)}%`, 
            animationDelay: `${i * 0.3}s` 
          }}
        />
      ))}
    </div>
  );
};
