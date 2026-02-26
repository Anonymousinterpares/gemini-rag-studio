import { FC } from 'react';
import './SkeletonLoader.css';

interface SkeletonProps {
  width?: string;
  height?: string;
  borderRadius?: string;
}

export const Skeleton: FC<SkeletonProps> = ({ width, height, borderRadius }) => (
  <div className="skeleton-box" style={{ width, height, borderRadius }} />
);

export const WorkspaceSkeleton: FC = () => {
  return (
    <div className="app-container skeleton-container">
      <div className="panel file-panel skeleton-panel">
        <div className="skeleton-header" />
        <div className="skeleton-list">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton-item" />)}
        </div>
      </div>
      <div className="panel chat-panel skeleton-panel">
        <div className="skeleton-header" />
        <div className="skeleton-chat-content" />
        <div className="skeleton-footer" />
      </div>
    </div>
  );
};

export const PanelSkeleton: FC = () => {
  return (
    <div className="panel skeleton-panel">
      <div className="skeleton-header" />
      <div className="skeleton-content">
        <div className="skeleton-pulse" />
      </div>
    </div>
  );
};
