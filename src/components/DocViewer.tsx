import React, { memo, useRef, useLayoutEffect, useState, useMemo, useEffect } from 'react';
import { VariableSizeList } from 'react-window';
import { FileText, ZoomIn, ZoomOut, BrainCircuit, List, BookOpen, ChevronRight } from 'lucide-react';
import { AppFile, SearchResult } from '../types';
import { ComputeCoordinator } from '../compute/coordinator';
import { useLayoutManager } from '../hooks/useLayoutManager';

const DocViewer = memo(function DocViewer({ coordinator, selectedFile, chunksToHighlight, docFontSize, setDocFontSize }: {
  coordinator: ComputeCoordinator | null,
  selectedFile: AppFile | null,
  chunksToHighlight: SearchResult[],
  docFontSize: number,
  setDocFontSize: React.Dispatch<React.SetStateAction<number>>,
}) {
  const listRef = useRef<VariableSizeList>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [activeFocusIndex, setActiveFocusIndex] = useState<number | null>(null);

  const LINE_HEIGHT_MULTIPLIER = 1.5;
  const BASE_FONT_SIZE_PX = 16;
  const PARAGRAPH_SPACING_EM = 0.75;

  const hasChunks = chunksToHighlight.length > 0;

  useLayoutEffect(() => {
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        // Leave room for sidebar if it's visible (250px)
        const sidebarWidth = hasChunks ? 250 : 0;
        setContainerWidth(entry.contentRect.width - sidebarWidth);
        setContainerHeight(entry.contentRect.height);
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [hasChunks]);

  const { layout, status } = useLayoutManager({ coordinator, selectedFile });
  
  type ProcessedLine = { type: 'line'; lineId: number; content: React.ReactNode; startIndex: number; endIndex: number; isHighlighted: boolean; } | { type: 'spacer'; };
  
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
        const relevantChunks = chunksToHighlight.filter(chunk => chunk.start < lineEnd && chunk.end > line.startIndex).sort((a, b) => a.start - b.start);
        
        if (relevantChunks.length > 0) {
          const parts: React.ReactNode[] = [];
          let lastIndex = 0;
          relevantChunks.forEach((chunk, i) => {
            const chunkStart = Math.max(0, chunk.start - line.startIndex);
            const chunkEnd = Math.min(line.text.length, chunk.end - line.startIndex);
            if (chunkStart > lastIndex) parts.push(line.text.substring(lastIndex, chunkStart));
            parts.push(<mark key={i}>{line.text.substring(chunkStart, chunkEnd)}</mark>);
            lastIndex = chunkEnd;
          });
          if (lastIndex < line.text.length) parts.push(line.text.substring(lastIndex));
          lineContent = <>{parts}</>;
        }

        processed.push({ 
          type: 'line', 
          lineId: ++lineCounter,
          startIndex: line.startIndex, 
          endIndex: lineEnd, 
          isHighlighted: relevantChunks.length > 0,
          content: lineContent
        });
      });
      if (pIndex < layout.length - 1) processed.push({ type: 'spacer' });
    });
    return processed;
  }, [layout, chunksToHighlight]);

  const scrollToChunk = (start: number) => {
    if (!listRef.current || flatLines.length === 0) return;
    const targetIndex = flatLines.findIndex(item => item.type === 'line' && start >= item.startIndex && start < item.endIndex);
    if (targetIndex !== -1) {
      listRef.current.scrollToItem(targetIndex, 'center');
      setActiveFocusIndex(targetIndex);
      setTimeout(() => setActiveFocusIndex(null), 2000);
    }
  };

  useEffect(() => {
    if (status === 'READY' && chunksToHighlight.length > 0 && flatLines.length > 0) {
      scrollToChunk(chunksToHighlight[0].start);
    }
  }, [status, chunksToHighlight, flatLines.length]); // Scroll when status or highlights change

  const getItemSize = (index: number) => {
    const item = flatLines[index];
    return docFontSize * (item.type === 'spacer' ? PARAGRAPH_SPACING_EM : LINE_HEIGHT_MULTIPLIER) * BASE_FONT_SIZE_PX;
  };

  const Row = ({ index, style }: { index: number, style: React.CSSProperties }) => {
    const item = flatLines[index];
    if (item.type === 'spacer') return <div style={style} className="doc-spacer"></div>;
    
    const isActive = activeFocusIndex === index;
    
    return (
      <div style={{ ...style, fontSize: `${docFontSize}em` }} className={`doc-line-wrapper ${item.isHighlighted ? 'highlighted' : ''} ${isActive ? 'active-focus' : ''}`}>
        <div className="doc-gutter">{item.lineId}</div>
        <pre className="doc-line-text"><code>{item.content}</code></pre>
      </div>
    );
  };

  return (
    <>
      <div className='doc-viewer-header'>
        <div className="flex items-center gap-2">
            <FileText size={18} className="text-primary" />
            <span>{selectedFile?.name || 'Document Viewer'}</span>
            {selectedFile && <span className="text-xs opacity-50 font-normal">({selectedFile.path})</span>}
        </div>
        <div className="doc-viewer-controls">
          <button onClick={() => setDocFontSize(p => Math.max(p - 0.1, 0.7))} title="Zoom Out"><ZoomOut size={16} /></button>
          <button onClick={() => setDocFontSize(p => Math.min(p + 0.1, 1.5))} title="Zoom In"><ZoomIn size={16} /></button>
        </div>
      </div>
      
      <div className='doc-viewer-container' ref={containerRef}>
        <div className="doc-viewer-main">
            {/* Instant Reveal Overlay (Quick View) */}
            {status === 'LOADING' && chunksToHighlight.length > 0 && (
                <div className="doc-quick-view">
                    <div className="doc-quick-view-header">
                        <BrainCircuit size={32} className="animate-pulse" />
                        <div>
                            <h3 className="m-0">Generating Full Layout...</h3>
                            <p className="m-0 text-sm opacity-70">Showing cited fragments immediately.</p>
                        </div>
                    </div>
                    {chunksToHighlight.map((chunk, i) => (
                        <div key={i} className="doc-quick-view-chunk">
                            <div className="text-xs opacity-50 mb-2 flex items-center gap-1">
                                <BookOpen size={12} /> Fragment {i + 1}
                            </div>
                            <div dangerouslySetInnerHTML={{ __html: chunk.chunk.replace(/\n/g, '<br/>') }} />
                        </div>
                    ))}
                </div>
            )}

            {/* Standard Statuses */}
            {status === 'LOADING' && chunksToHighlight.length === 0 && (
                <div className='placeholder-text'>
                    <BrainCircuit size={48} className='animate-pulse' />
                    <p>Loading document layout...</p>
                </div>
            )}
            
            {status === 'ERROR' && <div className='placeholder-text'><p>Error calculating layout.</p></div>}
            
            {status === 'READY' && layout && (
                <VariableSizeList 
                    ref={listRef} 
                    height={containerHeight} 
                    itemCount={flatLines.length} 
                    itemSize={getItemSize} 
                    width={containerWidth}
                    className="doc-viewer-content"
                >
                    {Row}
                </VariableSizeList>
            )}
            
            {status === 'READY' && !layout && <div className='placeholder-text'>Select a file to view content.</div>}
        </div>

        {/* Source Sidebar */}
        {hasChunks && (
            <div className="doc-sidebar">
                <div className="doc-sidebar-header">
                    <List size={14} />
                    Document Sources
                </div>
                <div className="doc-sidebar-list">
                    {chunksToHighlight.map((chunk, i) => (
                        <div 
                            key={i} 
                            className="doc-sidebar-item"
                            onClick={() => scrollToChunk(chunk.start)}
                        >
                            <div className="doc-sidebar-item-header">
                                <span className="doc-sidebar-item-label">Source {i + 1}</span>
                                <ChevronRight size={12} />
                            </div>
                            <div className="doc-sidebar-item-preview">
                                {chunk.chunk}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}
      </div>
    </>
  );
});

export default DocViewer;
