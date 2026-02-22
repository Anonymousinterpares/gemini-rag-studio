import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { TextItem } from 'pdfjs-dist/types/src/display/api';
import { AppFile } from '../types';
import { generateFileId } from './fileUtils';
import { getFileFromHandle, FileSystemItem } from './fileExplorer';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

export const downloadMessage = async (text: string, index: number, rootDirectoryHandle: FileSystemDirectoryHandle | null, format: 'txt' | 'md' | 'docx' = 'txt') => {
  const extension = format;
  const defaultName = `report-${index + 1}.${extension}`;
  
  let mimeType = 'text/plain';
  let content: any = text;

  if (format === 'md') {
    mimeType = 'text/markdown';
  } else if (format === 'docx') {
    mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    
    // Parse text into docx components
    const lines = text.split('\n');
    const docChildren: any[] = [];
    
    docChildren.push(new Paragraph({
      text: "RAG Studio Case File Report",
      heading: HeadingLevel.HEADING_1,
    }));

    let currentPara: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (currentPara.length > 0) {
          docChildren.push(new Paragraph({
            children: [new TextRun(currentPara.join(' '))],
            spacing: { after: 200 }
          }));
          currentPara = [];
        }
        continue;
      }

      if (trimmed.startsWith('# ')) {
        if (currentPara.length > 0) {
          docChildren.push(new Paragraph({ children: [new TextRun(currentPara.join(' '))], spacing: { after: 200 } }));
          currentPara = [];
        }
        docChildren.push(new Paragraph({
          text: trimmed.replace(/^#\s+/, ''),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 }
        }));
      } else if (trimmed.startsWith('## ')) {
        if (currentPara.length > 0) {
          docChildren.push(new Paragraph({ children: [new TextRun(currentPara.join(' '))], spacing: { after: 200 } }));
          currentPara = [];
        }
        docChildren.push(new Paragraph({
          text: trimmed.replace(/^##\s+/, ''),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 300, after: 150 }
        }));
      } else {
        currentPara.push(trimmed);
      }
    }

    if (currentPara.length > 0) {
      docChildren.push(new Paragraph({
        children: [new TextRun(currentPara.join(' '))],
        spacing: { after: 200 }
      }));
    }

    const doc = new Document({
      sections: [{
        properties: {},
        children: docChildren,
      }],
    });

    content = await Packer.toBlob(doc);
  }

  const anyWindow = window as unknown as {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: { description: string; accept: Record<string, string[]> }[];
      startIn?: FileSystemHandle;
    }) => Promise<FileSystemFileHandle>;
  };

  const acceptMap: Record<string, Record<string, string[]>> = {
    txt: { 'text/plain': ['.txt'] },
    md: { 'text/markdown': ['.md'] },
    docx: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] }
  };

  if (anyWindow.showSaveFilePicker) {
    try {
      const handle = await anyWindow.showSaveFilePicker({
        suggestedName: defaultName,
        types: [{ description: `${format.toUpperCase()} File`, accept: acceptMap[format] }],
        startIn: (rootDirectoryHandle as unknown as FileSystemHandle) || undefined
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
    }
  }

  const blob = format === 'docx' ? (content as Blob) : new Blob([content], { type: `${mimeType};charset=utf-8` });
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
