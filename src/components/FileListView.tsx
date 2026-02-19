import { memo } from 'react';
import { FileText, CheckCircle, XCircle, Loader } from 'lucide-react';
import { AppFile, SummaryStatus } from '../types';
import { useFileStore, useComputeStore } from '../store';

const SummaryStatusIndicator = ({ status, onClick }: { status: SummaryStatus, onClick: () => void }) => {
    switch (status) {
        case 'available':
            return <span title="Summary available" onClick={onClick}><CheckCircle size={16} className="summary-status available" /></span>;
        case 'in_progress':
            return <span title="Summary in progress"><Loader size={16} className="summary-status in-progress animate-spin" /></span>;
        case 'missing':
            return <span title="Generate summary" onClick={onClick}><XCircle size={16} className="summary-status missing" /></span>;
        default:
            return null;
    }
};

interface FileListViewProps {
  onShowSummary: (file: AppFile) => void;
}

const FileListView = memo(function FileListView({ onShowSummary }: FileListViewProps) {
  const { files, selectedFile, setSelectedFile, removeFile } = useFileStore();
  const { jobProgress, jobTimers } = useComputeStore();

  return (
    <ul>
      {[...files]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((file) => {
          const isSelected = selectedFile?.id === file.id
          const jobName = `Ingestion: ${file.id}`;
          const progress = jobProgress[jobName];
          const timer = jobTimers[jobName];
          const isComplete = progress && progress.progress === progress.total;

          return (
            <li key={file.id} className={isSelected ? 'selected' : ''} onClick={() => setSelectedFile(file)} title={file.path}>
                <div className="file-item-main-line">
                    <FileText size={16} />{' '}
                    <span className='file-item-name'>{file.path}</span>
                    <div className="file-item-details">
                        {file.language !== 'unknown' && <span className="language-indicator">{file.language}</span>}
                        <SummaryStatusIndicator status={file.summaryStatus} onClick={() => onShowSummary(file)} />
                    </div>
                    <button className="remove-file-btn" onClick={(e) => { e.stopPropagation(); removeFile(file.id); }}>x</button>
                </div>
              {progress && !isComplete && (
                <div className="progress-bar-container list-view">
                  <progress value={progress.progress} max={progress.total}></progress>
                </div>
              )}
              {timer && <span className="job-timer">{(timer.elapsed / 1000).toFixed(1)}s</span>}
            </li>
          )
        })}
    </ul>
  )
});

export default FileListView;
