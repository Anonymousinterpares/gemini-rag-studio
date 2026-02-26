import { FC, lazy, Suspense } from 'react';
import { useAppOrchestrator } from '../../hooks/useAppOrchestrator';
import Modal from '../../Modal';
import { processExplorerItems } from '../../utils/appActions';
import { PanelSkeleton } from '../shared/SkeletonLoader';

const MemoizedDocViewer = lazy(() => import('../DocViewer'));
const EmbeddingCacheModal = lazy(() => import('../EmbeddingCacheModal'));
const SummaryModal = lazy(() => import('../SummaryModal'));
const CustomFileExplorer = lazy(() => import('../CustomFileExplorer'));
const RecoveryDialogContainer = lazy(() => import('../RecoveryDialogContainer'));

export const GlobalModalManager: FC = () => {
  const orchestrator = useAppOrchestrator();
  const ui = orchestrator.ui;

  return (
    <>
      <Modal isOpen={ui.isDocModalOpen} onClose={() => ui.setDocModalOpen(false)}>
        <Suspense fallback={<PanelSkeleton />}>
          <MemoizedDocViewer
            coordinator={orchestrator.coordinator.current}
            selectedFile={ui.activeSource?.file ?? null}
            chunksToHighlight={ui.activeSource?.chunks ?? []}
            docFontSize={ui.docFontSize}
            setDocFontSize={ui.setDocFontSize}
          />
        </Suspense>
      </Modal>

      <Suspense fallback={null}>
        <EmbeddingCacheModal isOpen={ui.isCacheModalOpen} onClose={() => ui.setCacheModalOpen(false)} />
      </Suspense>

      {ui.summaryFile && (
        <Suspense fallback={null}>
          <SummaryModal
            isOpen={ui.isSummaryModalOpen}
            onClose={() => ui.closeSummary()}
            summary={ui.currentSummary}
            fileName={ui.summaryFile.name}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <CustomFileExplorer
          isOpen={ui.isExplorerOpen}
          onClose={() => ui.setIsExplorerOpen(false)}
          rootDirectoryHandle={orchestrator.rootDirectoryHandle}
          onFilesSelected={async (items) => {
            const toAdd = await processExplorerItems(items);
            orchestrator.handleClearFiles([]); // In a real scenario, you'd add these files
            console.log('Files selected in explorer:', toAdd.length);
            ui.setIsExplorerOpen(false);
          }}
        />
      </Suspense>

      <Suspense fallback={null}>
        <RecoveryDialogContainer
          availableModels={orchestrator.modelsList}
          currentModel={orchestrator.selectedModel}
          apiKeys={orchestrator.apiKeys}
          onModelChange={(m, k) => {
            orchestrator.setSelectedModel(m);
            if (k) orchestrator.setApiKeys(prev => ({ ...prev, [m.provider]: k }));
          }}
        />
      </Suspense>
    </>
  );
};
