import { FC, lazy, Suspense } from 'react';
import { useAppOrchestrator } from './hooks/useAppOrchestrator';
import { useDossierStore } from './store/useDossierStore';

// Components
import { ProjectBrowser } from './components/ProjectBrowser/ProjectBrowser';
import { ToastContainer } from './components/ToastContainer';
import { MainLayout } from './components/layout/MainLayout';
import { GlobalModalManager } from './components/layout/GlobalModalManager';
import { AppOverlays } from './components/layout/AppOverlays';
import { WorkspaceSkeleton, PanelSkeleton } from './components/shared/SkeletonLoader';

import './style.css';
import './progress-bar.css';
import './Modal.css';

const FilePanel = lazy(() => import('./components/FilePanel').then(m => ({ default: m.FilePanel })));
const ChatPanel = lazy(() => import('./components/ChatPanel').then(m => ({ default: m.ChatPanel })));
const InvestigationMapPanel = lazy(() => import('./components/InvestigationMap/InvestigationMapPanel').then(m => ({ default: m.InvestigationMapPanel })));

export const App: FC = () => {
  const orchestrator = useAppOrchestrator();
  const ui = orchestrator.ui;

  if (!orchestrator.activeProjectId) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
        <ProjectBrowser />
        <ToastContainer />
      </div>
    );
  }

  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <MainLayout
        filePanel={
          <Suspense fallback={<PanelSkeleton />}>
            <FilePanel />
          </Suspense>
        }
        chatPanel={
          <Suspense fallback={<PanelSkeleton />}>
            <ChatPanel />
          </Suspense>
        }
        mapPanel={
          <Suspense fallback={<PanelSkeleton />}>
            <InvestigationMapPanel
              onClose={() => ui.setIsMapPanelOpen(false)}
              onOpenDossierForNode={(dossierId) => {
                useDossierStore.getState().setActiveDossier(dossierId);
                ui.setIsDossierOpen(true);
              }}
            />
          </Suspense>
        }
        modals={<GlobalModalManager />}
        overlays={<AppOverlays />}
      />
    </Suspense>
  );
};
