export interface FileSystemItem {
  name: string;
  kind: 'file' | 'directory';
  path: string; // Full path from the selected root
  fileHandle?: FileSystemFileHandle; // Only present for files
}

export async function readDirectoryContents(directoryHandle: FileSystemDirectoryHandle, currentPath: string = ''): Promise<FileSystemItem[]> {
  const items: FileSystemItem[] = [];
  
  const entries = (directoryHandle as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values();
  for await (const handle of entries) {
    const name = handle.name;
    const path = currentPath ? `${currentPath}/${name}` : name;
    if (handle.kind === 'file') {
      items.push({ name, kind: 'file', path, fileHandle: handle as FileSystemFileHandle });
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