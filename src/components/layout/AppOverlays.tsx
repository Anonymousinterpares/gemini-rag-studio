import { FC } from 'react';
import { useAppOrchestrator } from '../../hooks/useAppOrchestrator';
import { useCaseFileStore } from '../../store/useCaseFileStore';
import { CaseFilePanel } from '../CaseFile/CaseFilePanel';
import { DossierPanel } from '../Dossier/DossierPanel';
import { SelectionPopover } from '../Chat/SelectionPopover';
import { ToastContainer } from '../ToastContainer';

export const AppOverlays: FC = () => {
  const orchestrator = useAppOrchestrator();
  const ui = orchestrator.ui;

  return (
    <>
      <CaseFilePanel
        renderModelMessage={(content) => orchestrator.renderModelMessage(content)}
        onResolveComment={async (cf, sId, comment) => {
          await orchestrator.submitCaseFileComment(cf, sId, comment, (resolvedSectionId, commentId, newContent) => {
            useCaseFileStore.getState().resolveComment(resolvedSectionId, commentId, newContent);
          });
        }}
      />
      <DossierPanel isOpen={ui.isDossierOpen} onClose={() => ui.setIsDossierOpen(false)} />
      <SelectionPopover />
      <ToastContainer />
    </>
  );
};
