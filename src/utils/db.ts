// src/utils/db.ts
// Utility functions for IndexedDB operations, specifically for storing FileSystemDirectoryHandle.

const DB_NAME = 'fileExplorerDB';
const STORE_NAME = 'directoryHandles';
const KEY = 'rootDirectoryHandle';

/**
 * Opens the IndexedDB database.
 * @returns A Promise that resolves with the IDBDatabase instance.
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
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
 * @param handle The FileSystemDirectoryHandle to store.
 * @returns A Promise that resolves when the handle is successfully stored.
 */
export async function storeDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(handle, KEY);

    request.onsuccess = () => {
      console.log('Directory handle stored in IndexedDB.');
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
 * @returns A Promise that resolves with the retrieved FileSystemDirectoryHandle, or null if not found.
 */
export async function getStoredDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(KEY);

    request.onsuccess = (event) => {
      const handle = (event.target as IDBRequest).result as FileSystemDirectoryHandle | undefined;
      if (handle) {
        console.log('Directory handle retrieved from IndexedDB.');
        resolve(handle);
      } else {
        console.log('No directory handle found in IndexedDB.');
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
 * @returns A Promise that resolves when the handle is successfully cleared.
 */
export async function clearStoredDirectoryHandle(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(KEY);

    request.onsuccess = () => {
      console.log('Directory handle cleared from IndexedDB.');
      resolve();
    };

    request.onerror = (event) => {
      console.error('Error clearing directory handle:', (event.target as IDBRequest).error);
      reject((event.target as IDBRequest).error);
    };
  });
}