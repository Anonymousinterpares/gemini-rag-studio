import { useState, useEffect } from 'react';
import { ComputeCoordinator } from '../compute/coordinator';
import { ParagraphLayout } from '../compute/types';
import { AppFile } from '../types';
import { useSettingsStore } from '../store';

type LayoutStatus = 'LOADING' | 'READY' | 'ERROR' | 'IDLE';

interface UseLayoutManagerProps {
  coordinator: ComputeCoordinator | null;
  selectedFile: AppFile | null;
}

export const useLayoutManager = ({ coordinator, selectedFile }: UseLayoutManagerProps) => {
  const { appSettings } = useSettingsStore();
  const [layout, setLayout] = useState<ParagraphLayout[] | null>(null);
  const [status, setStatus] = useState<LayoutStatus>('IDLE');

  useEffect(() => {
    if (!selectedFile || !coordinator) {
      setLayout(null);
      setStatus('IDLE');
      return;
    }

    if (selectedFile.layoutStatus === 'ready') {
      const cachedLayout = coordinator.getLayout(selectedFile.id);
      if (cachedLayout) {
        setLayout(cachedLayout);
        setStatus('READY');
      } else {
        if (appSettings.isLoggingEnabled) console.warn(`[useLayoutManager] Ready status but no cache for ${selectedFile.id}.`);
        setStatus('LOADING');
      }
    } else {
      setStatus('LOADING');
    }
  }, [selectedFile, coordinator, appSettings.isLoggingEnabled]);

  useEffect(() => {
    if (selectedFile && coordinator && selectedFile.layoutStatus !== 'ready') {
      coordinator.prioritizeLayoutForDoc(selectedFile.id);
    }
  }, [selectedFile, coordinator]);

  return { layout, status };
};
