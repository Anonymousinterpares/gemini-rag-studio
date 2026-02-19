import { describe, it, expect } from 'vitest';
import { StreamingHierarchicalChunker } from './hierarchical-splitter';

describe('StreamingHierarchicalChunker', () => {
    it('should produce parent and child chunks incrementally', async () => {
        const chunker = new StreamingHierarchicalChunker(50, 10);
        
        // First chunk - too small to finalize anything with 10 overlap
        const res1 = await chunker.processChunk("This is a short sentence.", false);
        expect(res1.parentChunks.length).toBe(0);
        
        // Second chunk - enough to finalize the first parent
        const res2 = await chunker.processChunk(" This is another sentence that makes it longer.", false);
        expect(res2.parentChunks.length).toBeGreaterThan(0);
        expect(res2.childChunks.length).toBeGreaterThan(0);
        
        // Finalize
        const res3 = await chunker.processChunk(" Final bit.", true);
        expect(res3.parentChunks.length).toBeGreaterThan(0);
    });

    it('should maintain correct offsets across chunks', async () => {
        const chunker = new StreamingHierarchicalChunker(20, 5);
        const text1 = "01234567890123456789"; // 20 chars
        const text2 = "abcdefghij"; // 10 chars
        
        const res1 = await chunker.processChunk(text1, false);
        // Should have produced one parent chunk if we consider overlap
        // With 20 size and 5 overlap, it needs 25 chars to finalize one if not last.
        
        const res2 = await chunker.processChunk(text2, true);
        const allParents = [...res1.parentChunks, ...res2.parentChunks];
        
        expect(allParents.length).toBeGreaterThan(0);
        expect(allParents[0].start).toBe(0);
        
        if (allParents.length > 1) {
            expect(allParents[1].start).toBeGreaterThan(0);
            expect(allParents[1].start).toBeLessThan(allParents[0].end); // because of overlap
        }
    });
});
