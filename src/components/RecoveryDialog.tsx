// src/components/RecoveryDialog.tsx
// User interface for API recovery decisions

import React, { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw, Settings, Play, X } from 'lucide-react';
import { RecoveryState, RecoveryDecision, RecoveryOptions } from '../utils/api-recovery';
import { Model } from '../types';

interface RecoveryDialogProps {
  isOpen: boolean;
  recoveryId: string;
  stepName: string;
  error: Error;
  state: RecoveryState;
  options: RecoveryOptions;
  onDecision: (decision: RecoveryDecision) => void;
  onClose: () => void;
  availableModels: Model[];
  currentModel: Model;
  apiKeys: Record<string, string>;
  onModelChange: (model: Model, apiKey?: string) => void;
}

export const RecoveryDialog: React.FC<RecoveryDialogProps> = ({
  isOpen,
  recoveryId,
  stepName,
  error,
  state,
  onDecision,
  onClose,
  availableModels,
  currentModel,
  apiKeys,
  onModelChange
}) => {
  const [selectedModel, setSelectedModel] = useState<Model>(currentModel);
  const [customApiKey, setCustomApiKey] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    setSelectedModel(currentModel);
  }, [currentModel]);

  if (!isOpen) return null;

  const getErrorTypeMessage = () => {
    switch (state.lastError?.type) {
      case 'api_overload':
        return 'The API is currently overloaded. This usually resolves within a few minutes.';
      case 'network_error':
        return 'Network connection issues detected. Please check your internet connection.';
      case 'auth_error':
        return 'Authentication failed. Please verify your API key is correct.';
      default:
        return 'An unexpected error occurred during processing.';
    }
  };

  const getProgressText = () => {
    const completed = state.completedSteps.length;
    const total = state.totalSteps;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    return `${completed}/${total} steps completed (${percentage}%)`;
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    onDecision({ action: 'retry' });
  };

  const handleSwitchModel = async () => {
    // Update the model/key in the parent component first
    onModelChange(selectedModel, customApiKey || apiKeys[selectedModel.provider]);
    
    // Then trigger retry with new model
    setIsRetrying(true);
    onDecision({ 
      action: 'switch_model',
      newModel: selectedModel,
      newApiKey: customApiKey || apiKeys[selectedModel.provider]
    });
  };

  const handleResume = () => {
    onDecision({ action: 'resume' });
  };

  const handleAbort = () => {
    onDecision({ action: 'abort' });
    onClose();
  };

  const getSuggestedActions = () => {
    switch (state.lastError?.type) {
      case 'api_overload':
        return [
          'Wait a few moments and retry',
          'Switch to a different model/provider',
          'Resume process (skip failed step if possible)'
        ];
      case 'network_error':
        return [
          'Check your internet connection and retry',
          'Try a different provider',
          'Resume process if network is stable'
        ];
      case 'auth_error':
        return [
          'Verify and update your API key',
          'Switch to a different model/provider',
          'Check your API quota and billing'
        ];
      default:
        return [
          'Retry the failed operation',
          'Switch to a different model',
          'Resume process (may affect quality)'
        ];
    }
  };

  const isDifferentModelSelected = selectedModel.id !== currentModel.id || selectedModel.provider !== currentModel.provider;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="text-yellow-500 mt-1" size={24} />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Research Process Interrupted
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {state.processType.replace('_', ' ')} • {getProgressText()}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X size={20} />
            </button>
          </div>

          {/* Error Details */}
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4">
            <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">
              Failed at: {stepName}
            </p>
            <p className="text-sm text-red-600 dark:text-red-300 mb-2">
              {getErrorTypeMessage()}
            </p>
            <details className="text-xs text-red-500 dark:text-red-400">
              <summary className="cursor-pointer hover:text-red-700 dark:hover:text-red-200">
                Technical details
              </summary>
              <pre className="mt-2 p-2 bg-red-100 dark:bg-red-900/30 rounded text-xs overflow-x-auto">
                {error.message}
              </pre>
            </details>
          </div>

          {/* Suggested Actions */}
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
              Suggested Actions:
            </h4>
            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
              {getSuggestedActions().map((action, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="text-gray-400 mt-0.5">•</span>
                  {action}
                </li>
              ))}
            </ul>
          </div>

          {/* Model Selection */}
          <div className="mb-6">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <Settings size={16} />
              Change Model/Provider
            </h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                  Select Provider & Model
                </label>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Currently using: <span className="font-medium">{currentModel.provider} - {currentModel.name}</span>
                </div>
                <select
                  value={`${selectedModel.provider}:${selectedModel.id}`}
                  onChange={(e) => {
                    const [provider, id] = e.target.value.split(':');
                    const model = availableModels.find(m => m.provider === provider && m.id === id);
                    if (model) setSelectedModel(model);
                  }}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-sm"
                >
                  {availableModels.map((model) => (
                    <option key={`${model.provider}:${model.id}`} value={`${model.provider}:${model.id}`}>
                      {model.provider} - {model.name}
                      {model.id === currentModel.id && model.provider === currentModel.provider && ' (current)'}
                    </option>
                  ))}
                </select>
              </div>

              {selectedModel.apiKeyRequired && (
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                    API Key (optional - leave empty to use stored key)
                  </label>
                  <input
                    type="password"
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                    placeholder="Enter new API key or leave empty"
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-sm"
                  />
                </div>
              )}

              {isDifferentModelSelected && (
                <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 p-2 rounded">
                  ⚠️ Switching from <span className="font-medium">{currentModel.provider} - {currentModel.name}</span> to <span className="font-medium">{selectedModel.provider} - {selectedModel.name}</span> may affect result consistency
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
            >
              {isRetrying ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              Retry
            </button>

            {isDifferentModelSelected && (
              <button
                onClick={handleSwitchModel}
                disabled={isRetrying}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              >
                <Settings size={16} />
                Switch & Retry
              </button>
            )}

            <button
              onClick={handleResume}
              disabled={isRetrying}
              className="flex-1 flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-400 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
            >
              <Play size={16} />
              Resume
            </button>

            <button
              onClick={handleAbort}
              disabled={isRetrying}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
            >
              Abort
            </button>
          </div>

          {/* Process Info */}
          <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex justify-between">
              <span>Process ID: {recoveryId}</span>
              <span>Failures: {state.failureCount}</span>
            </div>
            <div className="mt-1">
              Started: {new Date(state.startTime).toLocaleTimeString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecoveryDialog;
