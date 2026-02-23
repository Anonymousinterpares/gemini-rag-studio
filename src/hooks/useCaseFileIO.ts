import { useRef } from 'react';
import { CaseFile } from '../types';
import { parseCaseFileFromMarkdown } from '../utils/caseFileUtils';
import { useCaseFileStore } from '../store/useCaseFileStore';

/**
 * Handles loading and saving case files using the File System Access API,
 * with a fallback for browsers that don't support it.
 */
export const useCaseFileIO = () => {
    const { loadCaseFile, caseFile, setFileHandle, _fileHandle } = useCaseFileStore();

    // Debounce timer for auto-save
    const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    /** Open a file picker and load a .json or .md case file */
    const handleLoadCaseFile = async () => {
        try {
            if ('showOpenFilePicker' in window) {
                const [handle] = await (window as any).showOpenFilePicker({
                    types: [
                        {
                            description: 'Case File (JSON or Markdown)',
                            accept: {
                                'application/json': ['.json'],
                                'text/markdown': ['.md'],
                            },
                        },
                    ],
                    multiple: false,
                });
                const file = await handle.getFile();
                const text = await file.text();
                const parsed = parseRawFile(text, file.name);
                loadCaseFile(parsed, handle);
            } else {
                // Fallback: hidden <input type="file">
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,.md';
                input.onchange = async () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    const parsed = parseRawFile(text, file.name);
                    loadCaseFile(parsed);
                };
                input.click();
            }
        } catch (e: any) {
            if (e?.name !== 'AbortError') console.error('[CaseFileIO] Load error:', e);
        }
    };

    /** Save case file – uses remembered handle or opens a save picker */
    const handleSaveCaseFile = async (fileOverride?: CaseFile) => {
        const cf = fileOverride ?? caseFile;
        if (!cf) return;
        const data = JSON.stringify(cf, null, 2);

        try {
            if ('showSaveFilePicker' in window) {
                let handle = _fileHandle;
                if (!handle) {
                    handle = await (window as any).showSaveFilePicker({
                        suggestedName: `${cf.title.replace(/\s+/g, '-')}.json`,
                        types: [{ description: 'Case File JSON', accept: { 'application/json': ['.json'] } }],
                    });
                    setFileHandle(handle!);
                }
                const writable = await handle!.createWritable();
                await writable.write(data);
                await writable.close();
            } else {
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${cf.title.replace(/\s+/g, '-')}.json`;
                a.click();
                URL.revokeObjectURL(url);
            }
        } catch (e: any) {
            if (e?.name !== 'AbortError') console.error('[CaseFileIO] Save error:', e);
        }
    };

    /** Debounced auto-save: call this after every mutation */
    const scheduleAutoSave = (cf: CaseFile) => {
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = setTimeout(() => handleSaveCaseFile(cf), 2000);
    };

    return { handleLoadCaseFile, handleSaveCaseFile, scheduleAutoSave };
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseRawFile(text: string, filename: string): CaseFile {
    if (filename.endsWith('.json')) {
        try {
            const parsed = JSON.parse(text) as CaseFile;
            if (parsed.version === 1 && Array.isArray(parsed.sections)) return parsed;
        } catch {
            // Fall through to markdown parse
        }
    }
    // Plain markdown or bad JSON → parse as markdown
    const title = filename.replace(/\.(json|md)$/, '').replace(/-|_/g, ' ');
    return parseCaseFileFromMarkdown(text, title);
}
