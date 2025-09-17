import { memo, useCallback } from 'react';
import { FileText, Folder, CheckCircle, XCircle, Loader } from 'lucide-react';
import { AppFile, FileTree, JobProgress, JobTimer, SummaryStatus } from '../types';

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

interface FileTreeViewProps {
  tree: FileTree;
  selectedFile: AppFile | null;
  onSelectFile: (file: AppFile) => void;
  onRemoveFile: (file: AppFile) => void;
  jobProgress: Record<string, JobProgress>;
  jobTimers: Record<string, JobTimer>;
  onShowSummary: (file: AppFile) => void;
  pathPrefix?: string;
}

const MemoizedFileTreeView = memo(function FileTreeView({ tree, selectedFile, onSelectFile, onRemoveFile, jobProgress, jobTimers, onShowSummary, pathPrefix = '' }: FileTreeViewProps) {
  const handleSummaryClick = useCallback((file: AppFile) => {
    onShowSummary(file);
  }, [onShowSummary]);

  const handleRemoveClick = useCallback((e: React.MouseEvent, file: AppFile) => {
    e.stopPropagation();
    onRemoveFile(file);
  }, [onRemoveFile]);

  return (
    <ul>
      {Object.entries(tree)
        .sort(([aKey, aValue], [bKey, bValue]) => {
          const aIsDir = !(aValue as AppFile).path
          const bIsDir = !(bValue as AppFile).path
          if (aIsDir !== bIsDir) return aIsDir ? -1 : 1 // Dirs first
          return aKey.localeCompare(bKey)
        })
        .map(([name, item]) => {
          const isFile = !!(item as AppFile).path
          if (isFile) {
            const file = item as AppFile
            const isSelected = selectedFile?.path === file.path
            const jobName = `Ingestion: ${file.path}`;
            const progress = jobProgress[jobName];
            const timer = jobTimers[jobName];
            const isComplete = progress && progress.progress === progress.total;

            return (
              <li key={file.path}>
                <div
                  className={isSelected ? 'selected' : ''}
                  onClick={() => onSelectFile(file)}
                  title={file.path}
                >
                    <div className="file-item-main-line">
                        <FileText size={16} />{' '}
                        <span className='file-item-name'>{name}</span>
                        <div className="file-item-details">
                            {file.language !== 'unknown' && (
                                <span className="language-indicator" title={`Detected language: ${file.language}`}>
                                    {file.language}
                                </span>
                            )}
                            <SummaryStatusIndicator status={file.summaryStatus} onClick={() => handleSummaryClick(file)} />
                        </div>
                        <button className="remove-file-btn" onClick={(e) => handleRemoveClick(e, file)}>x</button>
                    </div>
                  {progress && !isComplete && (
                    <div className="progress-bar-container">
                      <progress value={progress.progress} max={progress.total}></progress>
                    </div>
                  )}
                  {timer && (
                    <span className="job-timer">
                      {(timer.elapsed / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
              </li>
            )
          } else {
            return (
              <li key={pathPrefix + name} className='folder-item'>
                <div>
                  <Folder size={16} /> <span>{name}</span>
                </div>
                <MemoizedFileTreeView
                  tree={item as FileTree}
                  selectedFile={selectedFile}
                  onSelectFile={onSelectFile}
                  onRemoveFile={onRemoveFile}
                  jobProgress={jobProgress}
                  jobTimers={jobTimers}
                  onShowSummary={onShowSummary}
                  pathPrefix={pathPrefix + name + '/'}
                />
              </li>
            )
          }
        })}
    </ul>
  )
});

export default MemoizedFileTreeView;