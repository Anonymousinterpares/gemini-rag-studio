import React, { memo, useRef, useLayoutEffect, useState, useMemo, useCallback, useEffect } from 'react';
import { VariableSizeList } from 'react-window';
import { FileText, ZoomIn, ZoomOut, BrainCircuit } from 'lucide-react';
import { AppFile } from '../types';
import { ComputeCoordinator } from '../compute/coordinator';
import { useLayoutManager } from '../hooks/useLayoutManager';

import { AppSettings } from '../config'; // Import AppSettings

const MemoizedDocViewer = memo(function DocViewer({ coordinator, selectedFile, chunksToHighlight, docFontSize, setDocFontSize, appSettings }: {
  coordinator: ComputeCoordinator | null,
  selectedFile: AppFile | null,
  chunksToHighlight: { start: number, end: number }[],
  docFontSize: number,
  setDocFontSize: React.Dispatch<React.SetStateAction<number>>,
  appSettings: AppSettings, // Add appSettings to props
}) {
  const listRef = useRef<VariableSizeList>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  const LINE_HEIGHT_MULTIPLIER = 1.5;
  const BASE_FONT_SIZE_PX = 16;
  const PARAGRAPH_SPACING_EM = 0.75;

  useLayoutEffect(() => {
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  const { layout, status } = useLayoutManager({
    coordinator,
    selectedFile, // Pass the entire selectedFile object
    appSettings, // Pass appSettings to useLayoutManager
  });
  
  type ProcessedLine = {
    type: 'line';
    content: React.ReactNode;
    startIndex: number;
    endIndex: number;
  } | {
    type: 'spacer';
  };
  
  const flatLines = useMemo<ProcessedLine[]>(() => {
    if (!layout) return [];
  
    const processed: ProcessedLine[] = [];
    let lineCounter = 0;
  
    layout.forEach((paragraph, pIndex) => {
      if (paragraph.lines.length === 0 || (paragraph.lines.length === 1 && paragraph.lines[0].text === '')) {
        processed.push({ type: 'spacer' });
        return;
      }
  
      paragraph.lines.forEach(line => {
        const lineEnd = line.startIndex + line.text.length;
        let lineContent: React.ReactNode = line.text;
  
        const relevantChunks = chunksToHighlight
          .filter(chunk => chunk.start < lineEnd && chunk.end > line.startIndex)
          .sort((a, b) => a.start - b.start);
  
        if (relevantChunks.length > 0) {
          const parts: React.ReactNode[] = [];
          let lastIndex = 0;
  
          relevantChunks.forEach((chunk, i) => {
            const chunkStart = Math.max(0, chunk.start - line.startIndex);
            const chunkEnd = Math.min(line.text.length, chunk.end - line.startIndex);
  
            if (chunkStart > lastIndex) {
              parts.push(line.text.substring(lastIndex, chunkStart));
            }
            parts.push(<mark key={i}>{line.text.substring(chunkStart, chunkEnd)}</mark>);
            lastIndex = chunkEnd;
          });
  
          if (lastIndex < line.text.length) {
            parts.push(line.text.substring(lastIndex));
          }
          lineContent = <>{parts}</>;
        }
  
        processed.push({
          type: 'line',
          startIndex: line.startIndex,
          endIndex: lineEnd,
          content: (
            <div className='doc-line-content'>
              <span className='line-number'>{++lineCounter}</span>
              <pre><code>{lineContent}</code></pre>
            </div>
          )
        });
      });
  
      if (pIndex < layout.length - 1) {
        processed.push({ type: 'spacer' });
      }
    });
  
    return processed;
  }, [layout, chunksToHighlight]);

  useEffect(() => {
    if (status === 'READY' && chunksToHighlight.length > 0 && listRef.current && flatLines.length > 0) {
      const firstChunkStart = chunksToHighlight[0].start;

      const targetIndex = flatLines.findIndex(item =>
        item.type === 'line' &&
        firstChunkStart >= item.startIndex &&
        firstChunkStart < item.endIndex
      );

      if (targetIndex !== -1) {
        listRef.current.scrollToItem(targetIndex, 'center');
      }
    }
  }, [status, chunksToHighlight, flatLines, listRef]);

  const getItemSize = (index: number) => {
    const item = flatLines[index];
    if (item.type === 'spacer') {
      return docFontSize * PARAGRAPH_SPACING_EM * BASE_FONT_SIZE_PX;
    }
    return docFontSize * LINE_HEIGHT_MULTIPLIER * BASE_FONT_SIZE_PX;
  };

  const handleZoomIn = useCallback(() => {
    setDocFontSize(prev => Math.min(prev + 0.1, 1.5));
  }, [setDocFontSize]);

  const handleZoomOut = useCallback(() => {
    setDocFontSize(prev => Math.max(prev - 0.1, 0.7));
  }, [setDocFontSize]);

  const Row = ({ index, style }: { index: number, style: React.CSSProperties }) => {
    const item = flatLines[index];
    switch (item.type) {
      case 'spacer':
        return <div style={{ ...style, fontSize: `${docFontSize}em` }} className="doc-spacer"></div>;
      case 'line':
        return (
          <div style={{ ...style, fontSize: `${docFontSize}em` }} className="doc-line">
            {item.content}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div className='doc-viewer-header'>
        {selectedFile ? (
          <><FileText size={16} /> <span>{selectedFile.path}</span></>
        ) : (
          <span>Document Viewer</span>
        )}
        <div className="doc-viewer-controls">
          <button onClick={handleZoomOut} title="Decrease font size">
            <ZoomOut size={16} />
          </button>
          <button onClick={handleZoomIn} title="Increase font size">
            <ZoomIn size={16} />
          </button>
        </div>
      </div>
      <div className='panel-content doc-viewer-content' ref={containerRef}>
        {status === 'LOADING' && (
          <div className='placeholder-text'>
            <BrainCircuit size={48} className='animate-pulse' />
            <p>Loading layout...</p>
          </div>
        )}
        {status === 'ERROR' && (
          <div className='placeholder-text'>
            <p>Error calculating layout.</p>
          </div>
        )}
        {status === 'READY' && layout && (
          <VariableSizeList
            ref={listRef}
            height={containerHeight}
            itemCount={flatLines.length}
            itemSize={getItemSize}
            width={containerWidth}
          >
            {Row}
          </VariableSizeList>
        )}
        {status === 'READY' && !layout && (
           <div className='placeholder-text'>
             Select a file or click a source link to view content.
           </div>
        )}
      </div>
    </>
  );
});

export default MemoizedDocViewer;