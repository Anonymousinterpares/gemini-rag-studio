import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VectorStore, chunkDocument } from './pipeline';

// Mock @xenova/transformers cos_sim
vi.mock('@xenova/transformers', () => ({
  cos_sim: vi.fn((a, b) => {
    // Simple mock dot product for testing
    return a.reduce((acc: number, val: number, i: number) => acc + val * b[i], 0);
  }),
}));

describe('pipeline', () => {
  describe('chunkDocument', () => {
    it('should split plain text into chunks', async () => {
      const text = 'This is a long text that should be split into multiple chunks for processing.';
      const chunks = await chunkDocument(text, 20, 5);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].text).toBeDefined();
      expect(chunks[0].start).toBe(0);
    });

    it('should handle JSON content by pretty-printing it', async () => {
      const jsonText = '{"key":"value","nested":{"a":1}}';
      const chunks = await chunkDocument(jsonText, 100, 10);
      // Pretty printed JSON is longer than the original
      expect(chunks[0].text).toContain('"key": "value"');
    });
  });

  describe('VectorStore', () => {
    let store: VectorStore;

    beforeEach(() => {
      store = new VectorStore();
    });

    it('should add and search for chunks', () => {
      const docId = 'doc1';
      const chunk = { text: 'Hello world', start: 0, end: 11 };
      const embedding = [1, 0, 0];
      
      store.addChunkEmbedding(chunk, docId, embedding);
      
      const results = store.search([1, 0, 0], 1);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe(docId);
      expect(results[0].chunk).toBe('Hello world');
    });

    it('should support parent-child chunking', () => {
      const docId = 'doc2';
      const parentChunks = [
        { text: 'This is a long parent chunk that contains context.', start: 0, end: 50 }
      ];
      store.addParentChunks(docId, parentChunks);
      
      const childEmbedding = [0, 1, 0];
      store.addChildChunkEmbedding(docId, childEmbedding, {
        text: 'child chunk',
        start: 0,
        end: 11,
        parentChunkIndex: 0
      });
      
      const results = store.search([0, 1, 0], 1);
      expect(results.length).toBe(1);
      expect(results[0].chunk).toBe(parentChunks[0].text);
      expect(results[0].id).toBe(docId);
    });

    it('should remove a document and its vectors', () => {
      const docId = 'doc3';
      store.addChunkEmbedding({ text: 'test', start: 0, end: 4 }, docId, [1, 1, 1]);
      expect(store.getEmbeddingCount()).toBe(1);
      
      store.removeDocument(docId);
      expect(store.getEmbeddingCount()).toBe(0);
      expect(store.search([1, 1, 1])).toEqual([]);
    });

    it('should clear all data', () => {
      store.addChunkEmbedding({ text: 'test1', start: 0, end: 5 }, 'id1', [1, 0]);
      store.addChunkEmbedding({ text: 'test2', start: 0, end: 5 }, 'id2', [0, 1]);
      expect(store.getEmbeddingCount()).toBe(2);
      
      store.clear();
      expect(store.getEmbeddingCount()).toBe(0);
    });

    it('should build an entity index', () => {
      const docId = 'doc4';
      const parentChunks = [
        { text: 'Apple and Microsoft are tech giants. Apple is in Cupertino.', start: 0, end: 60 }
      ];
      store.addParentChunks(docId, parentChunks);
      
      const entities = store.getTopEntities(docId, 1);
      const entityNames = entities.map(e => e.entity);
      expect(entityNames).toContain('apple');
      expect(entityNames).toContain('microsoft');
    });
  });
});
