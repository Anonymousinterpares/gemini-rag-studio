import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { TextItem } from 'pdfjs-dist/types/src/display/api';
import { AppFile } from '../types';
import { generateFileId } from './fileUtils';
import { getFileFromHandle, FileSystemItem } from './fileExplorer';

export const getMessageTextContent = (index: number, chatHistoryRef: React.RefObject<HTMLDivElement>): string => {
  const container = chatHistoryRef.current?.querySelectorAll('.message-container')[index] as HTMLElement | undefined;
  if (!container) return '';
  const markupEl = container.querySelector('.message-markup') as HTMLElement | null;
  return (markupEl ? markupEl.innerText : (container.querySelector('.message-content') as HTMLElement | null)?.innerText) || '';
};

export const downloadMessage = async (text: string, index: number, rootDirectoryHandle: FileSystemDirectoryHandle | null) => {
  const defaultName = `message-${index + 1}.txt`;
  const anyWindow = window as unknown as {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: { description: string; accept: Record<string, string[]> }[];
      startIn?: FileSystemHandle;
    }) => Promise<FileSystemFileHandle>;
  };

  if (anyWindow.showSaveFilePicker) {
    try {
      const handle = await anyWindow.showSaveFilePicker({
        suggestedName: defaultName,
        types: [{ description: 'Text File', accept: { 'text/plain': ['.txt'] } }],
        startIn: (rootDirectoryHandle as unknown as FileSystemHandle) || undefined
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
    }
  }

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const processExplorerItems = async (items: FileSystemItem[]): Promise<AppFile[]> => {
  const toAdd: AppFile[] = [];
  for (const item of items) {
    if (item.kind === 'file' && item.fileHandle) {
      const file = await getFileFromHandle(item.fileHandle);
      if (file) {
        let content = '';
        if (file.name.endsWith('.docx')) {
          const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
          content = result.value;
        } else if (file.name.endsWith('.pdf')) {
          const pdf = await pdfjsLib.getDocument(await file.arrayBuffer()).promise;
          for (let j = 1; j <= pdf.numPages; j++) {
            const page = await pdf.getPage(j);
            const text = await page.getTextContent();
            content += text.items.map(it => (it as TextItem).str).join(' ');
          }
        } else if (file.size < 5 * 1024 * 1024) {
          content = await file.text();
        }
        toAdd.push({
          id: generateFileId({ path: item.path, name: file.name, size: file.size, lastModified: file.lastModified }),
          path: item.path,
          name: file.name,
          content,
          lastModified: file.lastModified,
          size: file.size,
          summaryStatus: 'missing',
          language: 'unknown',
          layoutStatus: 'pending'
        });
      }
    }
  }
  return toAdd;
};
