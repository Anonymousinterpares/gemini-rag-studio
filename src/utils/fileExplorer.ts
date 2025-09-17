export interface FileSystemItem {
  name: string;
  kind: 'file' | 'directory';
  path: string; // Full path from the selected root
  fileHandle?: FileSystemFileHandle; // Only present for files
}

export async function readDirectoryContents(directoryHandle: FileSystemDirectoryHandle, currentPath: string = ''): Promise<FileSystemItem[]> {
  const items: FileSystemItem[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const [name, handle] of (directoryHandle as any).entries()) {
    const path = currentPath ? `${currentPath}/${name}` : name;
    if (handle.kind === 'file') {
      items.push({ name, kind: 'file', path, fileHandle: handle });
    } else if (handle.kind === 'directory') {
      items.push({ name, kind: 'directory', path });
    }
  }
  return items.sort((a, b) => {
    if (a.kind === 'directory' && b.kind === 'file') return -1;
    if (a.kind === 'file' && b.kind === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });
}

export async function getFileFromHandle(fileHandle: FileSystemFileHandle): Promise<File | null> {
  try {
    return await fileHandle.getFile();
  } catch (error) {
    console.error('Error getting file from handle:', error);
    return null;
  }
}

export async function getDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> { // eslint-disable-line @typescript-eslint/no-unused-vars
  try {
    // This function is a placeholder. In a real scenario, you'd need to store
    // and retrieve the handle from a persistent storage or re-request it.
    // For this task, we'll assume the root handle is passed or re-obtained.
    console.warn('getDirectoryHandle is a placeholder. Direct access to arbitrary paths is not possible without user interaction.');
    return null;
  } catch (error) {
    console.error('Error getting directory handle:', error);
    return null;
  }
}