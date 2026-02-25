import { FC } from 'react';
import { useAppOrchestrator } from '../../hooks/useAppOrchestrator';
import Modal from '../../Modal';
import MemoizedDocViewer from '../DocViewer';
import EmbeddingCacheModal from '../EmbeddingCacheModal';
import SummaryModal from '../SummaryModal';
import CustomFileExplorer from '../CustomFileExplorer';
import RecoveryDialogContainer from '../RecoveryDialogContainer';
import { processExplorerItems } from '../../utils/appActions';

export const GlobalModalManager: FC = () => {
  const orchestrator = useAppOrchestrator();
  const ui = orchestrator.ui;

  return (
    <>
      <Modal isOpen={ui.isDocModalOpen} onClose={() => ui.setDocModalOpen(false)}>
        <MemoizedDocViewer
          coordinator={orchestrator.coordinator.current}
          selectedFile={ui.activeSource?.file ?? null}
          chunksToHighlight={ui.activeSource?.chunks ?? []}
          docFontSize={ui.docFontSize}
          setDocFontSize={ui.setDocFontSize}
        />
      </Modal>
      <EmbeddingCacheModal isOpen={ui.isCacheModalOpen} onClose={() => ui.setCacheModalOpen(false)} />
      {ui.summaryFile && (
        <SummaryModal
          isOpen={ui.isSummaryModalOpen}
          onClose={() => ui.closeSummary()}
          summary={ui.currentSummary}
          fileName={ui.summaryFile.name}
        />
      )}
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
      <RecoveryDialogContainer
        availableModels={orchestrator.modelsList}
        currentModel={orchestrator.selectedModel}
        apiKeys={orchestrator.apiKeys}
        onModelChange={(m, k) => {
          orchestrator.setSelectedModel(m);
          if (k) orchestrator.setApiKeys(prev => ({ ...prev, [m.provider]: k }));
        }}
      />
    </>
  );
};
