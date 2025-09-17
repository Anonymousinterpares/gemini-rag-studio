import React, { useState, useEffect } from 'react';
import { ReviewFileTreeItem } from '../types';
import './FolderReviewModal.css';

interface FolderReviewModalProps {
  isOpen: boolean;
  onClose: (selectedFilePaths: string[] | null) => void;
  fileTree: { [key: string]: ReviewFileTreeItem };
}

const FolderReviewModal: React.FC<FolderReviewModalProps> = ({ isOpen, onClose, fileTree }) => {
  const [localFileTree, setLocalFileTree] = useState<{ [key: string]: ReviewFileTreeItem }>(fileTree);

  useEffect(() => {
    setLocalFileTree(fileTree);
  }, [fileTree]);

  if (!isOpen) {
    return null;
  }

  const handleCheckboxChange = (path: string, isChecked: boolean) => {
    setLocalFileTree(prevTree => {
      const newTree = JSON.parse(JSON.stringify(prevTree)); // Deep copy
      updateTreeItem(newTree, path, isChecked);
      return newTree;
    });
  };

  const updateTreeItem = (tree: { [key: string]: ReviewFileTreeItem }, targetPath: string, isChecked: boolean) => {
    const parts = targetPath.split('/').filter(Boolean);
    let currentLevel = tree;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!currentLevel[part]) {
        console.warn(`Path part not found: ${part} in ${currentPath}`);
        return;
      }

      if (i === parts.length - 1) {
        // This is the target item
        const item = currentLevel[part];
        item.isChecked = isChecked;
        item.isIndeterminate = false;
        if (item.isDirectory && item.children) {
          // Recursively update children
          updateChildren(item.children, isChecked);
        }
      } else {
        currentLevel = currentLevel[part].children!;
      }
    }
    // After updating the target, re-evaluate parent indeterminate states
    recalculateParentStates(tree, targetPath);
  };

  const updateChildren = (children: { [key: string]: ReviewFileTreeItem }, isChecked: boolean) => {
    for (const key in children) {
      if (Object.prototype.hasOwnProperty.call(children, key)) {
        const child = children[key];
        child.isChecked = isChecked;
        child.isIndeterminate = false;
        if (child.isDirectory && child.children) {
          updateChildren(child.children, isChecked);
        }
      }
    }
  };

  const recalculateParentStates = (tree: { [key: string]: ReviewFileTreeItem }, changedPath: string) => {
    const parts = changedPath.split('/').filter(Boolean);
    const currentPathParts: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      currentPathParts.push(parts[i]);
      if (i < parts.length - 1) { // Only for parent directories
        const parentPath = currentPathParts.join('/');
        const parentItem = findTreeItem(tree, parentPath);
        if (parentItem && parentItem.isDirectory && parentItem.children) {
          const children = Object.values(parentItem.children);
          const allChecked = children.every(child => child.isChecked);
          const noneChecked = children.every(child => !child.isChecked && !child.isIndeterminate);
          const someChecked = !allChecked && !noneChecked;

          parentItem.isChecked = allChecked;
          parentItem.isIndeterminate = someChecked;
        }
      }
    }
  };

  const findTreeItem = (tree: { [key: string]: ReviewFileTreeItem }, targetPath: string): ReviewFileTreeItem | undefined => {
    const parts = targetPath.split('/').filter(Boolean);
    let currentLevel: { [key: string]: ReviewFileTreeItem } = tree;
    let item: ReviewFileTreeItem | undefined;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      item = currentLevel[part];
      if (!item) return undefined;
      if (i < parts.length - 1) {
        if (!item.isDirectory || !item.children) return undefined;
        currentLevel = item.children;
      }
    }
    return item;
  };

  const getSelectedFilePaths = (tree: { [key: string]: ReviewFileTreeItem }): string[] => {
    const selected: string[] = [];
    const traverse = (currentTree: { [key: string]: ReviewFileTreeItem }) => {
      for (const key in currentTree) {
        if (Object.prototype.hasOwnProperty.call(currentTree, key)) {
          const item = currentTree[key];
          if (item.isDirectory && item.children) {
            if (item.isChecked) {
              // If folder is fully checked, add all its files
              addAllFiles(item.children, selected);
            } else if (item.isIndeterminate) {
              // If folder is indeterminate, traverse children
              traverse(item.children);
            }
          } else if (!item.isDirectory && item.isChecked) {
            selected.push(item.path);
          }
        }
      }
    };

    const addAllFiles = (children: { [key: string]: ReviewFileTreeItem }, list: string[]) => {
      for (const key in children) {
        if (Object.prototype.hasOwnProperty.call(children, key)) {
          const item = children[key];
          if (item.isDirectory && item.children) {
            addAllFiles(item.children, list);
          } else if (!item.isDirectory) {
            list.push(item.path);
          }
        }
      }
    };

    traverse(tree);
    return selected;
  };

  const handleConfirm = () => {
    const selectedPaths = getSelectedFilePaths(localFileTree);
    onClose(selectedPaths);
  };

  const handleCancel = () => {
    onClose(null);
  };

  const renderTree = (nodes: { [key: string]: ReviewFileTreeItem }) => (
    <ul>
      {Object.values(nodes).map(node => (
        <li key={node.path}>
          <label>
            <input
              type="checkbox"
              checked={node.isChecked}
              ref={el => {
                if (el) el.indeterminate = node.isIndeterminate;
              }}
              onChange={() => handleCheckboxChange(node.path, !node.isChecked)}
            />
            {node.name} {node.isDirectory ? '/' : ''}
          </label>
          {node.isDirectory && node.children && Object.keys(node.children).length > 0 && (
            renderTree(node.children)
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="folder-review-modal-overlay">
      <div className="folder-review-modal-content">
        <h2>Review Dropped Folder Contents</h2>
        <p>Please select the files and folders you wish to include:</p>
        <div className="folder-tree-view">
          {renderTree(localFileTree)}
        </div>
        <div className="modal-actions">
          <button onClick={handleConfirm}>Confirm Selection</button>
          <button onClick={handleCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default FolderReviewModal;