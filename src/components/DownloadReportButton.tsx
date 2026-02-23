import { FC, useState } from 'react';
import { Download } from 'lucide-react';
import { downloadMessage } from '../utils/appActions';

export const DownloadReportButton: FC<{ content: string; index: number; rootDirectoryHandle: FileSystemDirectoryHandle | null }> = ({ content, index, rootDirectoryHandle }) => {
    const [format, setFormat] = useState<'txt' | 'md' | 'docx'>('md');
    const [isSaving, setIsSaving] = useState(false);

    const handleDownload = async () => {
        setIsSaving(true);
        try {
            // Stripping internal RAG metadata if any
            const cleanContent = content.replace(/<!--searchResults:(.*?)-->/, '');
            await downloadMessage(cleanContent, index, rootDirectoryHandle, format);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="download-report-container">
            <div className="format-selector">
                <button className={`format-option ${format === 'txt' ? 'active' : ''}`} onClick={() => setFormat('txt')}>.TXT</button>
                <button className={`format-option ${format === 'md' ? 'active' : ''}`} onClick={() => setFormat('md')}>.MD</button>
                <button className={`format-option ${format === 'docx' ? 'active' : ''}`} onClick={() => setFormat('docx')}>.DOCX</button>
            </div>
            <button className="download-report-btn" onClick={handleDownload} disabled={isSaving}>
                <Download size={16} />
                {isSaving ? 'Saving...' : 'Download Report File'}
            </button>
        </div>
    );
};
