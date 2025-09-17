import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { CachedEmbedding } from '../types';

const DB_NAME = 'embedding-cache-db';
const DB_VERSION = 2; // Increment version to trigger upgrade
const STORE_NAME = 'embeddings';

interface EmbeddingCacheSchema extends DBSchema {
  [STORE_NAME]: {
    key: string; // Now represents file ID
    value: CachedEmbedding;
    indexes: { 'lastModified': number };
  };
}

class EmbeddingCache {
  private dbPromise: Promise<IDBPDatabase<EmbeddingCacheSchema>>;

  constructor() {
    this.dbPromise = openDB<EmbeddingCacheSchema>(DB_NAME, DB_VERSION, {
      upgrade(db: IDBPDatabase<EmbeddingCacheSchema>, oldVersion) {
        if (oldVersion < 2) {
          // If the old store exists, delete it to recreate with the new keyPath
          if (db.objectStoreNames.contains(STORE_NAME)) {
            db.deleteObjectStore(STORE_NAME);
          }
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: 'id', // Use the unique file ID as the key
          });
          store.createIndex('lastModified', 'lastModified');
        }
      },
    });
  }

  async get(id: string): Promise<CachedEmbedding | undefined> {
    // Defensive guard: avoid IDB DataError if id is falsy at runtime
    if (!id) return undefined as unknown as CachedEmbedding | undefined;
    return (await this.dbPromise).get(STORE_NAME, id);
  }

  async set(embedding: CachedEmbedding): Promise<void> {
    await (await this.dbPromise).put(STORE_NAME, embedding);
  }

  async remove(id: string): Promise<void> {
    await (await this.dbPromise).delete(STORE_NAME, id);
  }

  async clear(): Promise<void> {
    await (await this.dbPromise).clear(STORE_NAME);
  }

  async getAll(): Promise<CachedEmbedding[]> {
    return (await this.dbPromise).getAll(STORE_NAME);
  }
}

export const embeddingCache = new EmbeddingCache();