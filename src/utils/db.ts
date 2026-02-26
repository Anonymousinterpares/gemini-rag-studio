// src/utils/db.ts
// Utility functions for IndexedDB operations

import { ChatSession } from '../types';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api?: any;
  }
}

const DB_NAME = 'fileExplorerDB'; // Keeping original name for backwards compatibility
const DB_VERSION = 3; // v3 adds investigation map store
const DIRECTORY_STORE_NAME = 'directoryHandles';
const DIRECTORY_KEY = 'rootDirectoryHandle';

const CHAT_SESSIONS_STORE_NAME = 'chatSessions';
const MAP_STORE_NAME = 'investigationMap';

/**
 * Opens the IndexedDB database.
 * @returns A Promise that resolves with the IDBDatabase instance.
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // v1: Directory Handles
      if (!db.objectStoreNames.contains(DIRECTORY_STORE_NAME)) {
        db.createObjectStore(DIRECTORY_STORE_NAME);
      }

      // v2: Chat Sessions
      if (!db.objectStoreNames.contains(CHAT_SESSIONS_STORE_NAME)) {
        const store = db.createObjectStore(CHAT_SESSIONS_STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // v3: Investigation Map
      if (!db.objectStoreNames.contains(MAP_STORE_NAME)) {
        db.createObjectStore(MAP_STORE_NAME);
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      console.error('IndexedDB error:', (event.target as IDBOpenDBRequest).error);
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

/**
 * Stores a FileSystemDirectoryHandle in IndexedDB.
 * @param projectId The project ID to link this handle to.
 * @param handle The FileSystemDirectoryHandle to store.
 * @returns A Promise that resolves when the handle is successfully stored.
 */
export async function storeDirectoryHandle(projectId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DIRECTORY_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DIRECTORY_STORE_NAME);
    const request = store.put(handle, `${DIRECTORY_KEY}_${projectId}`);

    request.onsuccess = () => {
      console.log(`Directory handle stored in IndexedDB for project ${projectId}.`);
      resolve();
    };

    request.onerror = (event) => {
      console.error('Error storing directory handle:', (event.target as IDBRequest).error);
      reject((event.target as IDBRequest).error);
    };
  });
}

/**
 * Retrieves a FileSystemDirectoryHandle from IndexedDB.
 * @param projectId The project ID to retrieve the handle for.
 * @returns A Promise that resolves with the retrieved FileSystemDirectoryHandle, or null if not found.
 */
export async function getStoredDirectoryHandle(projectId: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DIRECTORY_STORE_NAME, 'readonly');
    const store = transaction.objectStore(DIRECTORY_STORE_NAME);
    const request = store.get(`${DIRECTORY_KEY}_${projectId}`);

    request.onsuccess = (event) => {
      const handle = (event.target as IDBRequest).result as FileSystemDirectoryHandle | undefined;
      if (handle) {
        console.log(`Directory handle retrieved from IndexedDB for project ${projectId}.`);
        resolve(handle);
      } else {
        console.log(`No directory handle found in IndexedDB for project ${projectId}.`);
        resolve(null);
      }
    };

    request.onerror = (event) => {
      console.error('Error retrieving directory handle:', (event.target as IDBRequest).error);
      reject((event.target as IDBRequest).error);
    };
  });
}

/**
 * Clears the stored FileSystemDirectoryHandle from IndexedDB.
 * @param projectId The project ID to clear the handle for.
 * @returns A Promise that resolves when the handle is successfully cleared.
 */
export async function clearStoredDirectoryHandle(projectId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DIRECTORY_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DIRECTORY_STORE_NAME);
    const request = store.delete(`${DIRECTORY_KEY}_${projectId}`);

    request.onsuccess = () => {
      console.log(`Directory handle cleared from IndexedDB for project ${projectId}.`);
      resolve();
    };

    request.onerror = (event) => {
      console.error('Error clearing directory handle:', (event.target as IDBRequest).error);
      reject((event.target as IDBRequest).error);
    };
  });
}

// ─── Chat Sessions IO ──────────────────────────────────────────────────────────

export async function saveChatSession(session: ChatSession): Promise<void> {
  if (window.api) {
    const result = await window.api.saveChatSession(session);
    if (result.error) throw new Error(result.error);
  } else {
    console.warn("Electron API not available, chat saving disabled in browser fallback.");
  }
}

export async function loadAllChatSessions(projectId: string): Promise<ChatSession[]> {
  if (window.api) {
    const sessions = await window.api.loadAllChatSessions();
    // Filter by project ID
    const projectSessions = sessions.filter((s: ChatSession) => s.projectId === projectId);
    // Sort descending by updatedAt
    return projectSessions.sort((a: ChatSession, b: ChatSession) => b.updatedAt - a.updatedAt);
  }
  return [];
}

export async function loadChatSession(id: string): Promise<ChatSession | null> {
  if (window.api) {
    return await window.api.loadChatSession(id);
  }
  return null;
}

export async function deleteChatSession(id: string): Promise<void> {
  if (window.api) {
    const result = await window.api.deleteChatSession(id);
    if (result.error) throw new Error(result.error);
  }
}

// ─── Investigation Map IO ──────────────────────────────────────────────────────

import { MapNode, MapEdge } from '../types';

export interface PersistedMap {
  nodes: MapNode[];
  edges: MapEdge[];
}

export async function saveMap(projectId: string, data: PersistedMap): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MAP_STORE_NAME, 'readwrite');
    const store = tx.objectStore(MAP_STORE_NAME);
    const request = store.put(data, projectId);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export async function loadMap(projectId: string): Promise<PersistedMap | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MAP_STORE_NAME, 'readonly');
    const store = tx.objectStore(MAP_STORE_NAME);
    const request = store.get(projectId);
    request.onsuccess = (e) => resolve((e.target as IDBRequest).result ?? null);
    request.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}