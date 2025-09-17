import React, { useState, useEffect } from 'react';
import { embeddingCache } from '../cache/embeddingCache';
import { CachedEmbedding } from '../types';
import Modal from '../Modal';

interface EmbeddingCacheModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const EmbeddingCacheModal: React.FC<EmbeddingCacheModalProps> = ({ isOpen, onClose }) => {
  const [cachedItems, setCachedItems] = useState<CachedEmbedding[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      embeddingCache.getAll().then(setCachedItems);
    }
  }, [isOpen]);

  const handleSelectItem = (path: string) => {
    setSelectedItems(prev =>
      prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    );
  };

  const handleRemoveSelected = async () => {
    for (const path of selectedItems) {
      await embeddingCache.remove(path);
    }
    setSelectedItems([]);
    embeddingCache.getAll().then(setCachedItems);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="embedding-cache-modal">
        <h2>Manage Embedding Cache</h2>
        <div className="button-group">
          <button onClick={handleRemoveSelected} disabled={selectedItems.length === 0}>
            Remove Selected
          </button>
          <button onClick={onClose}>Close</button>
        </div>
        <ul className="cache-item-list">
          {cachedItems.map(item => (
            <li key={item.path}>
              <input
                type="checkbox"
                checked={selectedItems.includes(item.path)}
                onChange={() => handleSelectItem(item.path)}
              />
              <span className="item-path">{item.path}</span>
              <span className="item-timestamp">
                {new Date(item.lastModified).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
};

export default EmbeddingCacheModal;