import { FC, useState, useEffect, useCallback } from 'react';
import { Folder, FileText, FileCode, FileSpreadsheet, FileArchive, FileAudio, FileVideo, FileImage, FileType, ArrowLeft, Plus, Minus } from 'lucide-react';
import { readDirectoryContents, FileSystemItem } from '../utils/fileExplorer';

interface CustomFileExplorerProps {
  isOpen: boolean;
  onClose: () => void;
  onFilesSelected: (items: FileSystemItem[]) => void;
  rootDirectoryHandle: FileSystemDirectoryHandle | null; // New prop
}

const CustomFileExplorer: FC<CustomFileExplorerProps> = ({ isOpen, onClose, onFilesSelected, rootDirectoryHandle }) => {
  const [currentDirectoryHandle, setCurrentDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [items, setItems] = useState<FileSystemItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<FileSystemItem[]>([]);
  const [iconSize, setIconSize] = useState(24); // Default icon size

  // Effect to initialize currentDirectoryHandle from rootDirectoryHandle prop when explorer opens
  // And to reset state when explorer closes
  useEffect(() => {
    console.log('[CustomFileExplorer] useEffect (isOpen, rootDirectoryHandle) triggered.');
    console.log('  isOpen:', isOpen);
    console.log('  rootDirectoryHandle:', rootDirectoryHandle?.name);
    console.log('  currentDirectoryHandle (before):', currentDirectoryHandle?.name);

    if (isOpen && rootDirectoryHandle) {
      // Only set if currentDirectoryHandle is not already the root or is null
      if (!currentDirectoryHandle || !currentDirectoryHandle.isSameEntry(rootDirectoryHandle)) {
        setCurrentDirectoryHandle(rootDirectoryHandle);
        setCurrentPath([rootDirectoryHandle.name]);
        console.log('[CustomFileExplorer] Initialized with rootDirectoryHandle from props:', rootDirectoryHandle.name);
      }
    } else if (!isOpen) {
      // Reset state when explorer closes
      setCurrentDirectoryHandle(null);
      setCurrentPath([]);
      setItems([]);
      setSelectedItems([]);
      console.log('[CustomFileExplorer] Explorer closed, state reset.');
    }
  }, [isOpen, rootDirectoryHandle, currentDirectoryHandle]); // Depend on isOpen, rootDirectoryHandle, and currentDirectoryHandle

  // Effect to load contents when currentDirectoryHandle or currentPath changes
  useEffect(() => {
    const loadContents = async () => {
      console.log('[CustomFileExplorer] loadContents effect triggered.');
      console.log('  currentDirectoryHandle:', currentDirectoryHandle?.name);
      console.log('  currentPath:', currentPath);
      if (currentDirectoryHandle) {
        try {
          const loadedItems = await readDirectoryContents(currentDirectoryHandle, currentPath.join('/'));
          setItems(loadedItems);
          console.log('[CustomFileExplorer] Loaded items:', loadedItems);
        } catch (error) {
          console.error('[CustomFileExplorer] Error reading directory contents:', error);
          setItems([]);
        }
      } else {
        setItems([]);
        console.log('[CustomFileExplorer] No currentDirectoryHandle, items cleared.');
      }
    };
    loadContents();
  }, [currentDirectoryHandle, currentPath]);

  // Effect to clear selected items when navigating (currentDirectoryHandle or currentPath changes)
  useEffect(() => {
    setSelectedItems([]);
    console.log('[CustomFileExplorer] Selected items cleared due to navigation.');
  }, [currentDirectoryHandle, currentPath]);

  const handleNavigate = useCallback(async (item: FileSystemItem) => {
    if (item.kind === 'directory') {
      try {
        const subDirectoryHandle = await currentDirectoryHandle?.getDirectoryHandle(item.name);
        if (subDirectoryHandle) {
          setCurrentDirectoryHandle(subDirectoryHandle);
          setCurrentPath(prev => [...prev, item.name]);
        }
      } catch (error) {
        console.error('Error navigating to sub-directory:', error);
      }
    } else {
      // Handle file click (e.g., select it)
      setSelectedItems(prev => {
        if (prev.some(selected => selected.path === item.path)) {
          return prev.filter(selected => selected.path !== item.path);
        } else {
          return [...prev, item];
        }
      });
    }
  }, [currentDirectoryHandle]);

  const handleBack = useCallback(async () => {
    console.log('[CustomFileExplorer] handleBack called.');
    console.log('  currentPath:', currentPath);
    console.log('  currentDirectoryHandle:', currentDirectoryHandle?.name);
    console.log('  rootDirectoryHandle:', rootDirectoryHandle?.name);

    if (currentPath.length > 1 && rootDirectoryHandle) {
      const newPath = currentPath.slice(0, -1);
      let parentHandle: FileSystemDirectoryHandle | null = rootDirectoryHandle;
      try {
        // Traverse up the directory tree to get the correct parent handle
        for (let i = 1; i < newPath.length; i++) {
          if (parentHandle) {
            parentHandle = await parentHandle.getDirectoryHandle(newPath[i]);
          } else {
            parentHandle = null; // Break if a segment is not found
            break;
          }
        }
        if (parentHandle) {
          setCurrentDirectoryHandle(parentHandle);
          setCurrentPath(newPath);
          console.log('[CustomFileExplorer] Navigating back to:', newPath.join('/'));
        } else {
          console.error('[CustomFileExplorer] Failed to get parent directory handle during back navigation.');
        }
      } catch (error) {
        console.error('[CustomFileExplorer] Error navigating back:', error);
      }
    } else if (currentPath.length === 1 && currentDirectoryHandle && rootDirectoryHandle && await currentDirectoryHandle.isSameEntry(rootDirectoryHandle)) {
      // If we are at the root of the selected directory (and it's the initial root),
      // don't clear the handle, just ensure path is correct.
      setCurrentPath([currentDirectoryHandle.name]);
      console.log('[CustomFileExplorer] Navigating back to initial root, handle remains.');
    } else {
      // This branch should ideally not be hit if rootDirectoryHandle is always provided and valid.
      // It would imply trying to navigate back from the initial root, which should do nothing.
      console.log('[CustomFileExplorer] Attempted to navigate back beyond root or to an unhandled state (should not happen).');
    }
  }, [currentPath, currentDirectoryHandle, rootDirectoryHandle]);

  const handleSelectFiles = useCallback(() => {
    onFilesSelected(selectedItems);
    onClose();
  }, [selectedItems, onFilesSelected, onClose]);

  const getFileIcon = (fileName: string) => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'txt':
      case 'md':
      case 'log':
        return <FileText size={iconSize} />;
      case 'js':
      case 'ts':
      case 'jsx':
      case 'tsx':
      case 'html':
      case 'css':
      case 'json':
      case 'py':
      case 'java':
      case 'c':
      case 'cpp':
      case 'h':
      case 'hpp':
      case 'go':
      case 'rs':
      case 'php':
      case 'rb':
      case 'sh':
      case 'yml':
      case 'yaml':
      case 'xml':
        return <FileCode size={iconSize} />;
      case 'xls':
      case 'xlsx':
      case 'csv':
        return <FileSpreadsheet size={iconSize} />;
      case 'zip':
      case 'rar':
      case '7z':
        return <FileArchive size={iconSize} />;
      case 'mp3':
      case 'wav':
      case 'ogg':
        return <FileAudio size={iconSize} />;
      case 'mp4':
      case 'mov':
      case 'avi':
        return <FileVideo size={iconSize} />;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
        return <FileImage size={iconSize} />;
      default:
        return <FileType size={iconSize} />;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="custom-file-explorer-overlay">
      <div className="custom-file-explorer-modal">
        <div className="modal-header">
          <h2>File Explorer</h2>
          <button className="close-button" onClick={onClose}>X</button>
        </div>
        <div className="modal-content">
          <div className="file-explorer-toolbar">
            {currentDirectoryHandle ? (
              <>
                <button onClick={handleBack} disabled={currentPath.length === 0}>
                  <ArrowLeft size={16} /> Back
                </button>
                <span>Current Path: /{currentPath.join('/')}</span>
              </>
            ) : (
              // This section is now empty as root directory selection is handled by App.tsx
              <p>Please select a folder using the "Open File Explorer" button.</p>
            )}
            <div className="icon-size-controls">
              <button onClick={() => setIconSize(prev => Math.max(16, prev - 4))}>
                <Minus size={16} />
              </button>
              <span>{iconSize}px</span>
              <button onClick={() => setIconSize(prev => Math.min(64, prev + 4))}>
                <Plus size={16} />
              </button>
            </div>
          </div>
          <div className="file-list">
            {items.length > 0 ? (
              items.map(item => (
                <div
                  key={item.path}
                  className={`file-item ${selectedItems.some(selected => selected.path === item.path) ? 'selected' : ''}`}
                  onClick={() => handleNavigate(item)}
                >
                  {item.kind === 'directory' ? <Folder size={iconSize} /> : getFileIcon(item.name)}
                  <span>{item.name}</span>
                </div>
              ))
            ) : (
              <p>No items in this directory or no folder selected.</p>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>Cancel</button>
          <button onClick={handleSelectFiles} disabled={selectedItems.length === 0}>Select ({selectedItems.length})</button>
        </div>
      </div>
    </div>
  );
};

export default CustomFileExplorer;