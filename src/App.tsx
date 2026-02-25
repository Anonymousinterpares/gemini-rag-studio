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
            <FilePanel
              showSettings={ui.showSettings} setShowSettings={ui.setShowSettings}
              glowType={orchestrator.glowType} isDragging={orchestrator.isDragging} handleDropValidate={orchestrator.handleDropValidate}
              files={orchestrator.files} activeJobCount={orchestrator.activeJobCount} isLoading={orchestrator.isLoading} isEmbedding={orchestrator.isEmbedding}
              showRejectionBubble={orchestrator.showRejectionBubble} showDropVideo={orchestrator.showDropVideo} dropVideoSrc={orchestrator.dropVideoSrc}
              setShowDropVideo={orchestrator.setShowDropVideo} handleClearFiles={orchestrator.handleClearFiles}
              initialChatHistory={[]} handleClearConversation={orchestrator.handleClearConversation}
              chatHistory={orchestrator.chatHistory} handleClear={orchestrator.handleClear}
              computeDevice={orchestrator.computeDevice} mlWorkerCount={orchestrator.mlWorkerCount} viewMode={ui.viewMode}
              setViewMode={ui.setViewMode} fileTree={orchestrator.fileTree} handleShowSum={orchestrator.handleShowSum}
              onOpenExplorer={orchestrator.onOpenExplorer}
              isPinned={ui.isPinned}
              setIsPinned={ui.setIsPinned}
              onBackToProjects={() => orchestrator.setActiveProject(null)}
            />
          </Suspense>
        }
        chatPanel={
          <Suspense fallback={<PanelSkeleton />}>
            <ChatPanel
              appSettings={orchestrator.appSettings} setAppSettings={orchestrator.setAppSettings}
              backgroundImages={orchestrator.backgroundImages} handleSourceClick={orchestrator.handleSourceClick}
              chatHistory={orchestrator.chatHistory} isLoading={orchestrator.isLoading} isEmbedding={orchestrator.isEmbedding}
              editingIndex={ui.editingIndex} editingContent={ui.editingContent} setEditingContent={ui.setEditingContent}
              activeCommentInput={orchestrator.activeCommentInput} commentText={orchestrator.commentText}
              hoveredSelectionId={orchestrator.hoveredSelectionId} rootDirectoryHandle={orchestrator.rootDirectoryHandle}
              caseFileState={orchestrator.caseFileState} handlers={orchestrator.messageHandlers}
              userInput={orchestrator.userInput} setUserInput={orchestrator.setUserInput} activeJobCount={orchestrator.activeJobCount}
              files={orchestrator.files} handleSubmit={orchestrator.handleSubmit} stopGeneration={orchestrator.stopGeneration}
              setCaseFileState={orchestrator.setCaseFileState} submitQuery={orchestrator.submitQuery} tokenUsage={orchestrator.tokenUsage}
              currentContextTokens={orchestrator.currentContextTokens}
              undo={orchestrator.handleUndo} redo={orchestrator.handleRedo}
              canUndo={orchestrator.canUndo}
              canRedo={orchestrator.canRedo}
              onLoadCaseFile={orchestrator.handleLoadCaseFile}
              onOpenCaseFile={() => orchestrator.setOverlayOpen(true)}
              hasCaseFile={!!orchestrator.caseFile}
              isDossierOpen={ui.isDossierOpen}
              setIsDossierOpen={ui.setIsDossierOpen}
              isMapPanelOpen={ui.isMapPanelOpen}
              setIsMapPanelOpen={ui.setIsMapPanelOpen}
            />
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
