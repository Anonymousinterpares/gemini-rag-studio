import { VectorStore } from './pipeline';

let vectorStore: VectorStore | null = null;

self.onmessage = async (event) => {
  const { type, payload } = event.data;

  if (type === 'init') {
    vectorStore = new VectorStore();
    await vectorStore.init();
    self.postMessage({ type: 'init_complete' });
  } else if (type === 'add_document') {
    if (!vectorStore) {
      throw new Error('Worker not initialized.');
    }
    await vectorStore.addDocument(payload.content, payload.path, (progress: number) => {
      self.postMessage({ type: 'progress', payload: { path: payload.path, progress } });
    });
    self.postMessage({ type: 'add_complete', payload: { path: payload.path } });
  } else if (type === 'search') {
    if (!vectorStore) {
      throw new Error('Worker not initialized.');
    }
    const results = await vectorStore.search(payload.query, payload.topK);
    self.postMessage({ type: 'search_results', payload: results });
  } else if (type === 'clear') {
    vectorStore?.clear();
    self.postMessage({ type: 'clear_complete' });
  }
};