import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { split } from "sentence-splitter";
import { DocumentChunk } from "./pipeline";

/**
 * Splits a document into two levels of chunks:
 * 1. Parent Chunks: Larger, contextually rich chunks.
 * 2. Child Chunks: Smaller, sentence-level chunks derived from the parents.
 *
 * This is the core of the Parent Document Retriever pattern. We search over the
 * small, precise child chunks but retrieve the larger parent chunks for context.
 *
 * @param text The full text content of the document.
 * @param parentChunkSize The desired size of the parent chunks.
 * @param parentChunkOverlap The overlap between parent chunks.
 * @returns A promise that resolves to an object containing both parent and child chunks.
 */
export async function hierarchicalChunker(
    text: string,
    parentChunkSize: number,
    parentChunkOverlap: number
): Promise<{ parentChunks: DocumentChunk[]; childChunks: { text: string; start: number; end: number; parentChunkIndex: number }[] }> {

    // 1. Create Parent Chunks using splitText and manual position tracking
    const parentSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: parentChunkSize,
        chunkOverlap: parentChunkOverlap,
    });

    const parentChunkStrings = await parentSplitter.splitText(text);
    const parentChunks: DocumentChunk[] = [];
    let lastEnd = 0;

    // Manually calculate start and end positions for parent chunks.
    // This is more robust than relying on metadata that may not be present.
    for (const chunkText of parentChunkStrings) {
        // Search for the chunk starting from a position that accounts for overlap.
        const start = text.indexOf(chunkText, Math.max(0, lastEnd - parentChunkOverlap));

        if (start === -1) {
            console.error(`[hierarchicalChunker] Could not find parent chunk in original text. This may lead to incorrect source mapping. Chunk: "${chunkText.slice(0, 50)}..."`);
            // Fallback to a simple append, though this is not ideal
            const fallbackStart = lastEnd;
            parentChunks.push({ text: chunkText, start: fallbackStart, end: fallbackStart + chunkText.length });
            lastEnd = fallbackStart + chunkText.length;
        } else {
            const end = start + chunkText.length;
            parentChunks.push({ text: chunkText, start, end });
            lastEnd = end;
        }
    }


    // 2. Create Child Chunks from each Parent Chunk
    const allChildChunks: { text: string; start: number; end: number; parentChunkIndex: number }[] = [];

    for (let i = 0; i < parentChunks.length; i++) {
        const parentChunk = parentChunks[i];
        const sentenceNodes = split(parentChunk.text);

        if (sentenceNodes.length > 0) {
            const childChunksForParent = sentenceNodes
                .filter(node => node.type === 'Sentence')
                .map(sentenceNode => {
                    // Use the sentence-splitter's offset for a precise start position within the parent.
                    const startInParent = (sentenceNode.loc.start as unknown as { offset: number }).offset;
                    const text = sentenceNode.raw;
                    return {
                        text: text,
                        start: parentChunk.start + startInParent,
                        end: parentChunk.start + startInParent + text.length,
                        parentChunkIndex: i, // Link back to the parent
                    };
                });
            allChildChunks.push(...childChunksForParent);
        }
    }

    return { parentChunks, childChunks: allChildChunks };
}