import React from 'react';
import Modal from '../Modal';

interface SummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  summary: string;
  fileName: string;
}

const SummaryModal: React.FC<SummaryModalProps> = ({ isOpen, onClose, summary, fileName }) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="summary-modal-content">
        <h3>Summary for {fileName}</h3>
        <p>{summary}</p>
      </div>
    </Modal>
  );
};

export default SummaryModal;