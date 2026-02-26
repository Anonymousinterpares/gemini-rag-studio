import { FC, useState, useRef, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, FileText, FolderOpen, FolderTree, Network } from 'lucide-react';
import { MessageList } from './Chat/MessageList';
import { ChatInputForm } from './Chat/ChatInputForm';
import { ChatHistoryDropdown } from './Chat/ChatHistoryDropdown';
import { useUIStore, useChatStore, useSettingsStore } from '../store';
import { useAppOrchestrator } from '../hooks/useAppOrchestrator';
import { useShallow } from 'zustand/shallow';

export const ChatPanel: FC = () => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [showScrollDown, setShowScrollDown] = useState(false);
    
    // Orchestrator for complex logic
    const orchestrator = useAppOrchestrator();
    
    // UI Store
    const ui = useUIStore(useShallow(s => ({
        isDossierOpen: s.isDossierOpen,
        setIsDossierOpen: s.setIsDossierOpen,
        isMapPanelOpen: s.isMapPanelOpen,
        setIsMapPanelOpen: s.setIsMapPanelOpen
    })));

    // Chat Store
    const chatHistory = useChatStore(s => s.chatHistory);

    // Settings Store
    const { appSettings, setAppSettings } = useSettingsStore(useShallow(s => ({
        appSettings: s.appSettings,
        setAppSettings: s.setAppSettings
    })));

    const { backgroundImages } = orchestrator;

    const handleScroll = useCallback(() => {
        if (scrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            const needsScroll = scrollHeight - scrollTop - clientHeight > 100;
            if (needsScroll !== showScrollDown) {
                setShowScrollDown(needsScroll);
            }
        }
    }, [showScrollDown]);

    useEffect(() => {
        handleScroll();
    }, [handleScroll]);

    useEffect(() => {
        handleScroll();
    }, [chatHistory, handleScroll]);

    const prefetchCaseFile = () => import('./CaseFile/CaseFilePanel');
    const prefetchDossier = () => import('./Dossier/DossierPanel');
    const prefetchMap = () => import('./InvestigationMap/InvestigationMapPanel');

    return (
        <div className='panel chat-panel'>
            <div className='chat-panel-header' style={{ justifyContent: 'space-between', display: 'flex' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        className='button secondary'
                        title='Load a case file (.json or .md) from your computer'
                        onClick={orchestrator.handleLoadCaseFile}
                        onMouseEnter={prefetchCaseFile}
                        style={{ padding: '0.4rem', display: 'flex', alignItems: 'center' }}
                    >
                        <FileText size={16} />
                    </button>
                    <button
                        className='button secondary'
                        title='Open the loaded case file in the overlay panel'
                        onClick={() => orchestrator.setOverlayOpen(true)}
                        onMouseEnter={prefetchCaseFile}
                        disabled={!orchestrator.caseFile}
                        style={{ padding: '0.4rem', display: 'flex', alignItems: 'center' }}
                    >
                        <FolderOpen size={16} />
                    </button>
                    <button
                        className={`button secondary ${ui.isDossierOpen ? 'active' : ''}`}
                        title='Open the Knowledge Base to manage Dossiers and Topics'
                        onClick={() => ui.setIsDossierOpen(!ui.isDossierOpen)}
                        onMouseEnter={prefetchDossier}
                        style={{ padding: '0.4rem', display: 'flex', alignItems: 'center', backgroundColor: ui.isDossierOpen ? 'rgba(52, 152, 219, 0.2)' : undefined, borderColor: ui.isDossierOpen ? '#3498db' : undefined }}
                    >
                        <FolderTree size={16} />
                    </button>
                    <button
                        className={`button secondary ${ui.isMapPanelOpen ? 'active' : ''}`}
                        title='Toggle Investigation Map panel'
                        onClick={() => ui.setIsMapPanelOpen(!ui.isMapPanelOpen)}
                        onMouseEnter={prefetchMap}
                        style={{ padding: '0.4rem', display: 'flex', alignItems: 'center', backgroundColor: ui.isMapPanelOpen ? 'rgba(52, 152, 219, 0.2)' : undefined, borderColor: ui.isMapPanelOpen ? '#3498db' : undefined }}
                    >
                        <Network size={16} />
                    </button>
                </div>
                <div style={{ display: 'flex', gap: '8px', flex: 1, justifyContent: 'center' }}>
                    <ChatHistoryDropdown />
                </div>
                <div className='background-changer'>
                    <button className='background-btn' onClick={() => setAppSettings((p: import('../config').AppSettings) => ({ ...p, backgroundIndex: p.backgroundIndex === 0 ? backgroundImages.length : p.backgroundIndex - 1 }))}><ChevronLeft size={16} /></button>
                    <button className='background-btn' onClick={() => setAppSettings((p: import('../config').AppSettings) => ({ ...p, backgroundIndex: (p.backgroundIndex + 1) % (backgroundImages.length + 1) }))}><ChevronRight size={16} /></button>
                </div>
            </div>
            <div className='panel-content' ref={scrollRef} onScroll={handleScroll} onClick={orchestrator.handleSourceClick} style={{ backgroundImage: backgroundImages[appSettings.backgroundIndex - 1] ? `url('${backgroundImages[appSettings.backgroundIndex - 1]}')` : 'none', backgroundSize: 'cover' }}>
                <MessageList />
            </div>

            <div style={{ position: 'relative', flexShrink: 0 }}>
                {showScrollDown && (
                    <button
                        className="scroll-to-bottom-btn"
                        onClick={() => {
                            if (scrollRef.current) {
                                scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
                            }
                        }}
                        title="Scroll to bottom"
                    >
                        <svg
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="white"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ display: 'block' }}
                        >
                            <path d="M7 10l5 5 5-5" />
                        </svg>
                    </button>
                )}
                <ChatInputForm />
            </div>
        </div>
    );
};
