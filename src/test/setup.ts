import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Web Worker
class WorkerMock {
  onmessage: ((message: any) => void) | null = null;
  postMessage(message: any) {}
  terminate() {}
  addEventListener(type: string, listener: any) {}
  removeEventListener(type: string, listener: any) {}
}

vi.stubGlobal('Worker', WorkerMock);

// Mock window.crypto for ID generation
Object.defineProperty(window, 'crypto', {
  value: {
    randomUUID: () => 'test-uuid',
    subtle: {},
  },
});
