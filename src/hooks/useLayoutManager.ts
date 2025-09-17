import { useState, useEffect } from 'react';
import { ComputeCoordinator } from '../compute/coordinator';
import { ParagraphLayout } from '../compute/types';
import { AppFile } from '../types';
import { AppSettings } from '../config'; // Import AppSettings

type LayoutStatus = 'LOADING' | 'READY' | 'ERROR' | 'IDLE';

interface UseLayoutManagerProps {
  coordinator: ComputeCoordinator | null;
  selectedFile: AppFile | null;
  appSettings: AppSettings; // Add appSettings to props
}

export const useLayoutManager = ({ coordinator, selectedFile, appSettings }: UseLayoutManagerProps) => {
  const [layout, setLayout] = useState<ParagraphLayout[] | null>(null);
  const [status, setStatus] = useState<LayoutStatus>('IDLE');

  useEffect(() => {
    if (!selectedFile || !coordinator) {
      setLayout(null);
      setStatus('IDLE');
      return;
    }
    // DIAGNOSTIC: Log the layoutStatus of the selected file
    if (appSettings.isLoggingEnabled) {
      console.log(`[${new Date().toISOString()}] [useLayoutManager DIAGNOSTIC] Effect triggered for selectedFile: ${selectedFile.id}, layoutStatus: ${selectedFile.layoutStatus}`);
    }

    // Use the new layoutStatus property to determine the state
    if (selectedFile.layoutStatus === 'ready') {
      if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [useLayoutManager DIAGNOSTIC] selectedFile.layoutStatus is 'ready' for ${selectedFile.id}. Attempting to retrieve from cache.`);
      const cachedLayout = coordinator.getLayout(selectedFile.id);
      if (cachedLayout) {
        if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [useLayoutManager DIAGNOSTIC] Layout found in cache for ${selectedFile.id}. Setting status to 'READY'.`);
        setLayout(cachedLayout);
        setStatus('READY');
      } else {
        // This case might happen if the state is ready but cache is somehow cleared.
        // We should probably re-request the layout calculation, but for now, we'll show loading.
        if (appSettings.isLoggingEnabled) console.warn(`[${new Date().toISOString()}] [useLayoutManager WARNING] Layout status for ${selectedFile.id} is 'ready' but no layout found in cache. Setting status to 'LOADING'.`);
        setStatus('LOADING');
      }
    } else {
      // If status is pending or undefined, it's loading.
      if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [useLayoutManager DIAGNOSTIC] selectedFile.layoutStatus is '${selectedFile.layoutStatus || 'undefined'}' for ${selectedFile.id}. Setting status to 'LOADING'.`);
      setStatus('LOADING');
    }
  }, [selectedFile, coordinator, ]);

  // This effect will handle prioritizing the layout when a file is selected
  useEffect(() => {
    if (selectedFile && coordinator && selectedFile.layoutStatus !== 'ready') {
      if (appSettings.isLoggingEnabled) console.log(`[${new Date().toISOString()}] [useLayoutManager DIAGNOSTIC] Prioritizing layout for ${selectedFile.id} as its status is not 'ready'.`);
      coordinator.prioritizeLayoutForDoc(selectedFile.id);
    }
  }, [selectedFile, coordinator, appSettings.isLoggingEnabled]);


  return { layout, status };
};