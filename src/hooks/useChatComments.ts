import { useEffect } from 'react';
import { sectionizeMessage } from '../utils/chatUtils';
import { ChatMessage } from '../types';
import { useUIStore } from '../store/useUIStore';

export const useChatComments = (chatHistory: ChatMessage[], handleUpdateMessage: (index: number, update: Partial<ChatMessage>) => void) => {
    const { 
        activeCommentInput, setActiveCommentInput,
        commentText, setCommentText,
        commentDraft, setCommentDraft,
        selectionPopover, setSelectionPopover
    } = useUIStore();

    const handleMouseUp = (msgIndex: number) => () => {
        const selection = window.getSelection();
        if (selection && selection.toString().trim().length > 0) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            // Find the parent message-section to get its ID
            let node = range.commonAncestorContainer as Node | null;
            while (node && !(node instanceof HTMLElement && node.classList.contains('message-section-wrapper'))) {
                node = node.parentNode;
            }

            let sectionId = 'sec-0'; // Fallback

            // Better way: find the closest row and its key
            let row = range.commonAncestorContainer as Node | null;
            while (row && !(row instanceof HTMLElement && row.getAttribute('data-section-id'))) {
                row = row.parentNode;
            }

            if (row instanceof HTMLElement) {
                sectionId = row.getAttribute('data-section-id') || 'sec-0';
            }

            // Extract text, preserving table structure if applicable
            let extractedText = selection.toString().trim();
            try {
                const container = document.createElement('div');
                container.appendChild(range.cloneContents());

                // If selection contains table elements, try to format as markdown table
                if (container.querySelector('td') || container.querySelector('th')) {
                    const rows = container.querySelectorAll('tr');
                    if (rows.length > 0) {
                        extractedText = Array.from(rows).map(tr => {
                            const cells = tr.querySelectorAll('td, th');
                            return '| ' + Array.from(cells).map(c => {
                                // Clone to avoid modifying the actual DOM
                                const clone = c.cloneNode(true) as HTMLElement;
                                // Replace <br> with space before getting textContent
                                clone.querySelectorAll('br').forEach(br => br.replaceWith(' '));
                                return (clone.textContent || '').replace(/\s+/g, ' ').trim();
                            }).join(' | ') + ' |';
                        }).join('\n');
                    } else {
                        // Partial row selection
                        const cells = container.querySelectorAll('td, th');
                        if (cells.length > 0) {
                            extractedText = '| ' + Array.from(cells).map(c => {
                                const clone = c.cloneNode(true) as HTMLElement;
                                clone.querySelectorAll('br').forEach(br => br.replaceWith(' '));
                                return (clone.textContent || '').replace(/\s+/g, ' ').trim();
                            }).join(' | ') + ' |';
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to extract tabular selection:", e);
            }

            setSelectionPopover({
                top: rect.top + window.scrollY - 40,
                left: rect.left + window.scrollX + rect.width / 2,
                text: extractedText,
                msgIndex,
                sectionId,
                commentInputOpen: false
            });
        }
    };

    // Clear selection popover when clicking elsewhere
    useEffect(() => {
        const handleGlobalClick = (e: MouseEvent) => {
            if (selectionPopover && !(e.target as HTMLElement).closest('.selection-popover')) {
                setSelectionPopover(null);
            }
        };
        window.addEventListener('mousedown', handleGlobalClick);
        return () => window.removeEventListener('mousedown', handleGlobalClick);
    }, [selectionPopover]);

    // Opens the inline comment textarea inside the popover
    const handleOpenSelectionCommentInput = () => {
        setCommentDraft('');
        setSelectionPopover(prev => prev ? { ...prev, commentInputOpen: true } : null);
    };

    // Saves the comment (called from inline form submit)
    const handleAddSelectionComment = (msgIndex: number, text: string, sectionId: string, commentStr: string) => {
        if (!commentStr.trim()) {
            setSelectionPopover(null);
            return;
        }

        const msg = chatHistory[msgIndex];
        const selectionComments = msg.selectionComments || [];
        const newComment = {
            id: `sel-${Date.now()}`,
            sectionId,
            text,
            comment: commentStr.trim()
        };

        handleUpdateMessage(msgIndex, {
            selectionComments: [...selectionComments, newComment]
        });
        setSelectionPopover(null);
        setCommentDraft('');
    };

    const handleDeleteSelectionComment = (msgIndex: number, id: string) => {
        if (!window.confirm("Delete this selection review?")) return;
        const msg = chatHistory[msgIndex];
        const updated = (msg.selectionComments || []).filter(sc => sc.id !== id);
        handleUpdateMessage(msgIndex, { selectionComments: updated });
    };

    const handleStartComment = (msgIndex: number, sectionId: string) => {
        setActiveCommentInput({ msgIndex, sectionId });
        setCommentText('');
    };

    const handleAddComment = (msgIndex: number, sectionId: string) => {
        if (!commentText.trim()) return;
        const msg = chatHistory[msgIndex];
        const sections = msg.sections || sectionizeMessage(msg.content || '');
        const updatedSections = sections.map(s => s.id === sectionId ? { ...s, comment: commentText.trim(), isEditingComment: false } : s);
        handleUpdateMessage(msgIndex, { sections: updatedSections });
        setActiveCommentInput(null);
    };

    const handleEditComment = (msgIndex: number, sectionId: string, text: string) => {
        const msg = chatHistory[msgIndex];
        const updatedSections = (msg.sections || []).map(s => s.id === sectionId ? { ...s, isEditingComment: true } : s);
        handleUpdateMessage(msgIndex, { sections: updatedSections });
        setCommentText(text);
        setActiveCommentInput({ msgIndex, sectionId });
    };

    const handleDeleteComment = (msgIndex: number, sectionId: string) => {
        if (!window.confirm("Are you sure you want to delete this comment?")) return;
        const msg = chatHistory[msgIndex];
        const updatedSections = (msg.sections || []).map(s => s.id === sectionId ? { ...s, comment: undefined } : s);
        handleUpdateMessage(msgIndex, { sections: updatedSections });
    };

    return {
        activeCommentInput, setActiveCommentInput,
        commentText, setCommentText,
        commentDraft, setCommentDraft,
        selectionPopover, setSelectionPopover,
        handleMouseUp,
        handleOpenSelectionCommentInput,
        handleAddSelectionComment,
        handleDeleteSelectionComment,
        handleStartComment,
        handleAddComment,
        handleEditComment,
        handleDeleteComment
    };
};
