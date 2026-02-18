import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Web Worker
class WorkerMock {
  onmessage: ((message: unknown) => void) | null = null;
  postMessage(_message: unknown) {}
  terminate() {}
  addEventListener(_type: string, _listener: unknown) {}
  removeEventListener(_type: string, _listener: unknown) {}
}

vi.stubGlobal('Worker', WorkerMock);

// Mock window.crypto for ID generation
Object.defineProperty(window, 'crypto', {
  value: {
    randomUUID: () => 'test-uuid',
    subtle: {},
  },
});
