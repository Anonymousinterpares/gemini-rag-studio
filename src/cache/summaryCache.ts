import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface CachedSummary {
  id: string; // File ID
  summary: string;
  lastModified: number;
}

interface SummaryDBSchema extends DBSchema {
  summaries: {
    key: string; // docId
    value: CachedSummary;
  };
}

class SummaryCache {
  private dbPromise: Promise<IDBPDatabase<SummaryDBSchema>>;

  constructor() {
    this.dbPromise = openDB<SummaryDBSchema>('summary-cache-db', 2, { // Version bump
      upgrade(db, oldVersion) {
        if (oldVersion < 2) {
          if (db.objectStoreNames.contains('summaries')) {
            db.deleteObjectStore('summaries');
          }
          db.createObjectStore('summaries', { keyPath: 'id' });
        }
      },
    });
  }

  async set(id: string, summary: string, lastModified: number): Promise<void> {
    const db = await this.dbPromise;
    await db.put('summaries', { id, summary, lastModified });
  }

  async get(id: string): Promise<CachedSummary | undefined> {
    // Defensive guard: avoid IDB DataError if id is falsy at runtime
    if (!id) return undefined as unknown as CachedSummary | undefined;
    const db = await this.dbPromise;
    return db.get('summaries', id);
  }

  async getAll(): Promise<Record<string, string>> {
    const db = await this.dbPromise;
    const allEntries = await db.getAll('summaries');
    const summaries: Record<string, string> = {};
    for (const entry of allEntries) {
        summaries[entry.id] = entry.summary;
    }
    return summaries;
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    await db.clear('summaries');
  }
}

export const summaryCache = new SummaryCache();