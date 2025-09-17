import { memo } from 'react';
import { FileText, CheckCircle, XCircle, Loader } from 'lucide-react';
import { AppFile, JobProgress, JobTimer, SummaryStatus } from '../types';

const SummaryStatusIndicator = ({ status, onClick }: { status: SummaryStatus, onClick: () => void }) => {
    switch (status) {
        case 'available':
            return <span title="Summary available - click to view" onClick={onClick}><CheckCircle size={16} className="summary-status available" /></span>;
        case 'in_progress':
            return <span title="Summary in progress"><Loader size={16} className="summary-status in-progress animate-spin" /></span>;
        case 'missing':
            return <span title="Generate summary" onClick={onClick}><XCircle size={16} className="summary-status missing" /></span>;
        default:
            return null;
    }
};

interface FileListViewProps {
  files: AppFile[];
  selectedFile: AppFile | null;
  onSelectFile: (file: AppFile) => void;
  onRemoveFile: (file: AppFile) => void;
  jobProgress: Record<string, JobProgress>;
  jobTimers: Record<string, JobTimer>;
  onShowSummary: (file: AppFile) => void;
}

const MemoizedFileListView = memo(function FileListView({ files, selectedFile, onSelectFile, onRemoveFile, jobProgress, jobTimers, onShowSummary }: FileListViewProps) {
  console.log('Rendering FileListView with files:', files.map(f => ({ path: f.path, summaryStatus: f.summaryStatus })));
  return (
    <ul>
      {files
        .slice()
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((file) => {
          console.log(`FileListView rendering file: ${file.path}, language: ${file.language}`);
          const isSelected = selectedFile?.path === file.path
          const jobName = `Ingestion: ${file.path}`;
          const progress = jobProgress[jobName];
          const timer = jobTimers[jobName];
          const isComplete = progress && progress.progress === progress.total;

          return (
            <li
              key={file.path}
              className={isSelected ? 'selected' : ''}
              onClick={() => onSelectFile(file)}
              title={file.path}
            >
                <div className="file-item-main-line">
                    <FileText size={16} />{' '}
                    <span className='file-item-name'>{file.path}</span>
                    <div className="file-item-details">
                        {file.language !== 'unknown' && (
                            <span className="language-indicator" title={`Detected language: ${file.language}`}>
                                {file.language}
                            </span>
                        )}
                        <SummaryStatusIndicator status={file.summaryStatus} onClick={() => onShowSummary(file)} />
                    </div>
                    <button className="remove-file-btn" onClick={(e) => { e.stopPropagation(); onRemoveFile(file); }}>x</button>
                </div>
              {progress && !isComplete && (
                <div className="progress-bar-container list-view">
                  <progress value={progress.progress} max={progress.total}></progress>
                </div>
              )}
              {timer && (
                <span className="job-timer">
                  {(timer.elapsed / 1000).toFixed(1)}s
                </span>
              )}
            </li>
          )
        })}
    </ul>
  )
});

export default MemoizedFileListView;