import { useMemo } from 'react';
import * as diff from 'diff';

/**
 * Hook to render a diff between original and proposed content.
 * Additions are highlighted with a yellow background and bold text.
 * Deletions are shown with a strikethrough and red background.
 *
 * @param originalContent The current content of the section.
 * @param proposedContent The new/proposed content from the LLM.
 * @returns A React node containing the rendered diff.
 */
export const useDiffRenderer = (originalContent: string, proposedContent: string) => {
    return useMemo(() => {
        if (!proposedContent) {
            return <span>{originalContent}</span>;
        }

        const differences = diff.diffWords(originalContent, proposedContent);

        return (
            <div className="diff-renderer">
                {differences.map((part, index) => {
                    if (part.added) {
                        return (
                            <span
                                key={index}
                                style={{
                                    backgroundColor: 'yellow',
                                    fontWeight: 'bold',
                                    color: 'black', // ensure legibility on yellow
                                    padding: '0 2px',
                                    borderRadius: '2px'
                                }}
                            >
                                {part.value}
                            </span>
                        );
                    }
                    if (part.removed) {
                        return (
                            <span
                                key={index}
                                style={{
                                    backgroundColor: '#ffcccc',
                                    textDecoration: 'line-through',
                                    color: '#cc0000',
                                    padding: '0 2px',
                                    borderRadius: '2px',
                                    opacity: 0.7
                                }}
                            >
                                {part.value}
                            </span>
                        );
                    }
                    return <span key={index}>{part.value}</span>;
                })}
            </div>
        );
    }, [originalContent, proposedContent]);
};
