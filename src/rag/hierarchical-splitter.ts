import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { split } from "sentence-splitter";
import { DocumentChunk } from "./pipeline";

/**
 * Splits a document into two levels of chunks:
 * 1. Parent Chunks: Larger, contextually rich chunks.
 * 2. Child Chunks: Smaller, sentence-level chunks derived from the parents.
 */
export async function hierarchicalChunker(
    text: string,
    parentChunkSize: number,
    parentChunkOverlap: number
): Promise<{ parentChunks: DocumentChunk[]; childChunks: { text: string; start: number; end: number; parentChunkIndex: number }[] }> {

    const parentSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: parentChunkSize,
        chunkOverlap: parentChunkOverlap,
    });

    const parentChunkStrings = await parentSplitter.splitText(text);
    const parentChunks: DocumentChunk[] = [];
    let lastEnd = 0;

    for (const chunkText of parentChunkStrings) {
        const start = text.indexOf(chunkText, Math.max(0, lastEnd - parentChunkOverlap));
        if (start === -1) {
            const fallbackStart = lastEnd;
            parentChunks.push({ text: chunkText, start: fallbackStart, end: fallbackStart + chunkText.length });
            lastEnd = fallbackStart + chunkText.length;
        } else {
            const end = start + chunkText.length;
            parentChunks.push({ text: chunkText, start, end });
            lastEnd = end;
        }
    }

    const allChildChunks: { text: string; start: number; end: number; parentChunkIndex: number }[] = [];
    for (let i = 0; i < parentChunks.length; i++) {
        const parentChunk = parentChunks[i];
        const sentenceNodes = split(parentChunk.text);
        if (sentenceNodes.length > 0) {
            const childChunksForParent = sentenceNodes
                .filter(node => node.type === 'Sentence')
                .map(sentenceNode => {
                    const startInParent = (sentenceNode.loc.start as unknown as { offset: number }).offset;
                    const text = sentenceNode.raw;
                    return {
                        text: text,
                        start: parentChunk.start + startInParent,
                        end: parentChunk.start + startInParent + text.length,
                        parentChunkIndex: i,
                    };
                });
            allChildChunks.push(...childChunksForParent);
        }
    }
    return { parentChunks, childChunks: allChildChunks };
}

/**
 * A stateful chunker that processes text incrementally.
 */
export class StreamingHierarchicalChunker {
    private buffer: string = "";
    private totalProcessedLength: number = 0;
    private parentChunksCount: number = 0;
    private chunkSize: number;
    private overlap: number;

    constructor(chunkSize: number, overlap: number) {
        this.chunkSize = chunkSize;
        this.overlap = overlap;
    }

    async processChunk(text: string, isLast: boolean = false): Promise<{ 
        parentChunks: DocumentChunk[]; 
        childChunks: { text: string; start: number; end: number; parentChunkIndex: number }[] 
    }> {
        this.buffer += text;
        const finalizedParentChunks: DocumentChunk[] = [];
        const finalizedChildChunks: { text: string; start: number; end: number; parentChunkIndex: number }[] = [];

        // We want to keep at least 'overlap' text in the buffer for the next chunk,
        // unless it's the last chunk.
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const remainingNeeded = isLast ? 0 : this.overlap;
            if (this.buffer.length <= this.chunkSize + remainingNeeded && !isLast) {
                break;
            }

            // Simple splitting for now: find the last newline or space within the chunkSize
            let splitIndex = this.chunkSize;
            if (this.buffer.length > this.chunkSize) {
                const lastNewline = this.buffer.lastIndexOf('\n', this.chunkSize);
                const lastSpace = this.buffer.lastIndexOf(' ', this.chunkSize);
                splitIndex = Math.max(lastNewline, lastSpace);
                if (splitIndex <= this.chunkSize / 2) {
                    splitIndex = this.chunkSize; // Fallback if no good split point found
                }
            } else if (isLast) {
                splitIndex = this.buffer.length;
            }

            if (splitIndex <= 0 && !isLast) break;
            
            const chunkText = this.buffer.substring(0, splitIndex);
            const parentChunk: DocumentChunk = {
                text: chunkText,
                start: this.totalProcessedLength,
                end: this.totalProcessedLength + chunkText.length
            };

            finalizedParentChunks.push(parentChunk);
            
            // Generate child chunks for this parent
            const sentenceNodes = split(parentChunk.text);
            const childChunks = sentenceNodes
                .filter(node => node.type === 'Sentence')
                .map(sentenceNode => {
                    const startInParent = (sentenceNode.loc.start as unknown as { offset: number }).offset;
                    const text = sentenceNode.raw;
                    return {
                        text,
                        start: parentChunk.start + startInParent,
                        end: parentChunk.start + startInParent + text.length,
                        parentChunkIndex: this.parentChunksCount
                    };
                });
            
            finalizedChildChunks.push(...childChunks);

            // Update state
            this.parentChunksCount++;
            
            // Consumed length is the portion of the buffer we move past.
            // For the next chunk to overlap by 'this.overlap', we only move past (splitIndex - overlap).
            // We only consume the full splitIndex if it's literally the end of the buffer and isLast is true.
            const isEndOfBuffer = splitIndex >= this.buffer.length;
            const consumeLength = (isLast && isEndOfBuffer) ? splitIndex : Math.max(0, splitIndex - this.overlap);
            
            // Ensure we don't consume more than we have
            const actualConsume = Math.max(0, Math.min(consumeLength, this.buffer.length));
            
            this.buffer = this.buffer.substring(actualConsume);
            this.totalProcessedLength += actualConsume;

            if (isLast && this.buffer.length === 0) break;
            if (!isLast && this.buffer.length <= this.overlap) break;
        }

        return { parentChunks: finalizedParentChunks, childChunks: finalizedChildChunks };
    }
}