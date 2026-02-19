import { memo, useCallback } from 'react';
import { FileText, Folder, CheckCircle, XCircle, Loader } from 'lucide-react';
import { AppFile, FileTree, SummaryStatus } from '../types';
import { useFileStore, useComputeStore } from '../store';

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
  pathPrefix?: string;
  onShowSummary: (file: AppFile) => void;
}

const FileTreeView = memo(function FileTreeView({ tree, pathPrefix = '', onShowSummary }: FileTreeViewProps) {
  const { selectedFile, setSelectedFile, removeFile } = useFileStore();
  const { jobProgress, jobTimers } = useComputeStore();

  const handleRemoveClick = useCallback((e: React.MouseEvent, file: AppFile) => {
    e.stopPropagation();
    removeFile(file.id);
  }, [removeFile]);

  return (
    <ul>
      {Object.entries(tree)
        .sort(([aKey, aValue], [bKey, bValue]) => {
          const aIsDir = !(aValue as AppFile).path
          const bIsDir = !(bValue as AppFile).path
          if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
          return aKey.localeCompare(bKey)
        })
        .map(([name, item]) => {
          const isFile = !!(item as AppFile).path
          if (isFile) {
            const file = item as AppFile
            const isSelected = selectedFile?.id === file.id
            const jobName = `Ingestion: ${file.id}`;
            const progress = jobProgress[jobName];
            const timer = jobTimers[jobName];
            const isComplete = progress && progress.progress === progress.total;

            return (
              <li key={file.id}>
                <div className={isSelected ? 'selected' : ''} onClick={() => setSelectedFile(file)} title={file.path}>
                    <div className="file-item-main-line">
                        <FileText size={16} />{' '}
                        <span className='file-item-name'>{name}</span>
                        <div className="file-item-details">
                            {file.language !== 'unknown' && <span className="language-indicator">{file.language}</span>}
                            <SummaryStatusIndicator status={file.summaryStatus} onClick={() => onShowSummary(file)} />
                        </div>
                        <button className="remove-file-btn" onClick={(e) => handleRemoveClick(e, file)}>x</button>
                    </div>
                  {progress && !isComplete && (
                    <div className="progress-bar-container">
                      <progress value={progress.progress} max={progress.total}></progress>
                    </div>
                  )}
                  {timer && <span className="job-timer">{(timer.elapsed / 1000).toFixed(1)}s</span>}
                </div>
              </li>
            )
          } else {
            return (
              <li key={pathPrefix + name} className='folder-item'>
                <div><Folder size={16} /> <span>{name}</span></div>
                <FileTreeView tree={item as FileTree} pathPrefix={pathPrefix + name + '/'} onShowSummary={onShowSummary} />
              </li>
            )
          }
        })}
    </ul>
  )
});

export default FileTreeView;
