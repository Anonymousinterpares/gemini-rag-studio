// src/components/RecoveryDialogContainer.tsx
// Container component that listens for API recovery events and manages dialog state

import React, { useState, useEffect } from 'react';
import RecoveryDialog from './RecoveryDialog';
import { RecoveryState, RecoveryOptions, RecoveryDecision } from '../utils/api-recovery';
import { Model } from '../types';

interface RecoveryDialogContainerProps {
  availableModels: Model[];
  currentModel: Model;
  apiKeys: Record<string, string>;
  onModelChange: (model: Model, apiKey?: string) => void;
}

export const RecoveryDialogContainer: React.FC<RecoveryDialogContainerProps> = ({
  availableModels,
  currentModel,
  apiKeys,
  onModelChange
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [recoveryId, setRecoveryId] = useState('');
  const [stepName, setStepName] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [state, setState] = useState<RecoveryState | null>(null);
  const [options, setOptions] = useState<RecoveryOptions | null>(null);
  const [onDecision, setOnDecision] = useState<((decision: RecoveryDecision) => void) | null>(null);

  useEffect(() => {
    const handleRecoveryEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{
        recoveryId: string;
        stepName: string;
        error: Error;
        state: RecoveryState;
        options: RecoveryOptions;
        onDecision: (decision: RecoveryDecision) => void;
      }>;
      
      const { recoveryId, stepName, error, state, options, onDecision } = customEvent.detail;
      
      setRecoveryId(recoveryId);
      setStepName(stepName);
      setError(error);
      setState(state);
      setOptions(options);
      setOnDecision(() => onDecision);
      setIsOpen(true);
    };

    window.addEventListener('api-recovery-needed', handleRecoveryEvent);
    
    return () => {
      window.removeEventListener('api-recovery-needed', handleRecoveryEvent);
    };
  }, []);

  const handleClose = () => {
    // If dialog is closed without making a decision, default to abort
    if (onDecision) {
      onDecision({ action: 'abort' });
    }
    setIsOpen(false);
  };

  const handleDecision = (decision: RecoveryDecision) => {
    if (onDecision) {
      onDecision(decision);
    }
    setIsOpen(false);
  };

  if (!isOpen || !state || !error || !options || !onDecision) {
    return null;
  }

  return (
    <RecoveryDialog
      isOpen={isOpen}
      recoveryId={recoveryId}
      stepName={stepName}
      error={error}
      state={state}
      options={options}
      onDecision={handleDecision}
      onClose={handleClose}
      availableModels={availableModels}
      currentModel={currentModel}
      apiKeys={apiKeys}
      onModelChange={onModelChange}
    />
  );
};

export default RecoveryDialogContainer;
