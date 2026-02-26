import { FC, ReactNode } from 'react';
import { useUIStore } from '../../store/useUIStore';

interface MainLayoutProps {
  filePanel: ReactNode;
  chatPanel: ReactNode;
  mapPanel?: ReactNode;
  modals: ReactNode;
  overlays: ReactNode;
}

export const MainLayout: FC<MainLayoutProps> = ({
  filePanel,
  chatPanel,
  mapPanel,
  modals,
  overlays
}) => {
  const isMapPanelOpen = useUIStore(s => s.isMapPanelOpen);

  return (
    <div className='app-container'>
      {filePanel}
      {chatPanel}
      {isMapPanelOpen && mapPanel && (
        <div className="investigation-map-panel-wrapper">
          {mapPanel}
        </div>
      )}
      {modals}
      {overlays}
    </div>
  );
};
