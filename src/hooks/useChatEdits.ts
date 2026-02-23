import { sectionizeMessage } from '../utils/chatUtils';
import { ChatMessage, MessageSection } from '../types';

// ─── Apply Edits ──────────────────────────────────────────────────────────────

export const useChatEdits = (
    chatHistory: ChatMessage[],
    handleUpdateMessage: (index: number, update: Partial<ChatMessage>) => void
) => {

    /**
     * Applies a single edit to the sections array.
     * All edits are whole-section replacements — the LLM always returns the full
     * rewritten section content. Fragment-level edits are no longer used.
     */
    const applyEditToSections = (
        edit: NonNullable<ChatMessage['pendingEdits']>[number],
        sections: NonNullable<ChatMessage['sections']>,
        selectionComments: NonNullable<ChatMessage['selectionComments']>
    ) => {
        let updatedSections = [...sections];
        let updatedComments = [...selectionComments];

        if (edit.newContent !== undefined) {
            // Whole-section replacement — the only path now
            updatedSections = updatedSections.map(s =>
                s.id === edit.sectionId
                    ? { ...s, content: edit.newContent!, comment: undefined }
                    : s
            );
            // Remove any selection comments that referenced this section
            if (edit.fragmentId) {
                updatedComments = updatedComments.filter(sc => sc.id !== edit.fragmentId);
            } else {
                updatedComments = updatedComments.filter(sc => sc.sectionId !== edit.sectionId);
            }
        }

        return [updatedSections, updatedComments] as const;
    };

    const handleConfirmEdit = (msgIndex: number, sectionId: string) => {
        const msg = chatHistory[msgIndex];
        if (!msg.pendingEdits) return;
        const edit = msg.pendingEdits.find(e => e.sectionId === sectionId);
        if (!edit) return;

        const sections = msg.sections?.length
            ? [...msg.sections]
            : sectionizeMessage(msg.content || '');
        const [updatedSections, updatedComments] = applyEditToSections(
            edit, sections, msg.selectionComments || []
        );

        handleUpdateMessage(msgIndex, {
            content: updatedSections.map(s => s.content).join('\n\n'),
            sections: updatedSections,
            selectionComments: updatedComments,
            pendingEdits: msg.pendingEdits.filter(e => e !== edit)
        });
    };

    const handleRejectEdit = (msgIndex: number, sectionId: string) => {
        const msg = chatHistory[msgIndex];
        if (!msg.pendingEdits) return;
        handleUpdateMessage(msgIndex, {
            pendingEdits: msg.pendingEdits.filter(e => e.sectionId !== sectionId)
        });
    };

    const handleConfirmAllEdits = (msgIndex: number) => {
        const msg = chatHistory[msgIndex];
        if (!msg.pendingEdits) return;

        let sections: MessageSection[] = msg.sections?.length
            ? [...msg.sections]
            : sectionizeMessage(msg.content || '');
        let comments = [...(msg.selectionComments || [])];

        for (const edit of msg.pendingEdits) {
            [sections, comments] = applyEditToSections(edit, sections, comments) as [typeof sections, typeof comments];
        }

        handleUpdateMessage(msgIndex, {
            content: sections.map(s => s.content).join('\n\n'),
            sections,
            selectionComments: comments,
            pendingEdits: []
        });
    };

    const handleRejectAllEdits = (msgIndex: number) => {
        handleUpdateMessage(msgIndex, { pendingEdits: [] });
    };

    return {
        handleConfirmEdit,
        handleRejectEdit,
        handleConfirmAllEdits,
        handleRejectAllEdits,
        applyEditToSections
    };
};
