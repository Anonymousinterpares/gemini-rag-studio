import { FC } from 'react';
import { Edit2, FileText } from 'lucide-react';
import { useAppOrchestrator } from '../../hooks/useAppOrchestrator';

export const SelectionPopover: FC = () => {
  const orchestrator = useAppOrchestrator();
  const { selectionPopover } = orchestrator;

  if (!selectionPopover) return null;

  return (
    <div className="selection-popover" style={{ top: selectionPopover.top, left: selectionPopover.left }}>
      {selectionPopover.commentInputOpen ? (
        <div className="selection-popover-form" onMouseDown={e => e.stopPropagation()}>
          <textarea
            className="selection-popover-textarea"
            autoFocus
            placeholder="Enter your comment…"
            value={orchestrator.commentDraft}
            onChange={e => orchestrator.setCommentDraft(e.target.value)}
            rows={3}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                orchestrator.handleAddSelectionComment(selectionPopover.msgIndex, selectionPopover.text, selectionPopover.sectionId, orchestrator.commentDraft);
              }
            }}
          />
          <div className="selection-popover-actions">
            <button className="button" onClick={() => orchestrator.handleAddSelectionComment(selectionPopover.msgIndex, selectionPopover.text, selectionPopover.sectionId, orchestrator.commentDraft)} disabled={!orchestrator.commentDraft.trim()}>Save</button>
            <button className="button secondary" onClick={() => orchestrator.setCommentDraft('')}>Clear</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <button className="selection-popover-btn" onClick={orchestrator.handleOpenSelectionCommentInput}><Edit2 size={14} /> Review Selection</button>
          <button className="selection-popover-btn" onClick={() => { orchestrator.generateContextualDossier(selectionPopover.text); orchestrator.setSelectionPopover(null); }}><FileText size={14} /> Compile Dossier</button>
        </div>
      )}
    </div>
  );
};
