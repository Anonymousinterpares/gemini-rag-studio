import { FC, lazy, Suspense } from 'react';
import { useAppOrchestrator } from '../../hooks/useAppOrchestrator';
import { useCaseFileStore } from '../../store/useCaseFileStore';
import { SelectionPopover } from '../Chat/SelectionPopover';
import { ToastContainer } from '../ToastContainer';
import { PanelSkeleton } from '../shared/SkeletonLoader';

const CaseFilePanel = lazy(() => import('../CaseFile/CaseFilePanel').then(m => ({ default: m.CaseFilePanel })));
const DossierPanel = lazy(() => import('../Dossier/DossierPanel').then(m => ({ default: m.DossierPanel })));

export const AppOverlays: FC = () => {
  const orchestrator = useAppOrchestrator();
  const ui = orchestrator.ui;

  return (
    <>
      <Suspense fallback={null}>
        <CaseFilePanel
          renderModelMessage={(content) => orchestrator.renderModelMessage(content)}
          onResolveComment={async (cf, sId, comment) => {
            await orchestrator.submitCaseFileComment(cf, sId, comment, (resolvedSectionId, commentId, newContent) => {
              useCaseFileStore.getState().resolveComment(resolvedSectionId, commentId, newContent);
            });
          }}
        />
      </Suspense>
      <Suspense fallback={ui.isDossierOpen ? <PanelSkeleton /> : null}>
        <DossierPanel isOpen={ui.isDossierOpen} onClose={() => ui.setIsDossierOpen(false)} />
      </Suspense>
      <SelectionPopover />
      <ToastContainer />
    </>
  );
};
