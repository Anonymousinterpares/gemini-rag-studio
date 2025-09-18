// src/utils/api-recovery.ts
// Comprehensive API recovery system with state preservation and user interaction

import { Model } from '../types';

export interface RecoveryState<T = any> {
  id: string;
  processType: 'deep_analysis' | 'summary_generation' | 'rag_query' | 'general';
  startTime: number;
  currentStep: string;
  totalSteps: number;
  completedSteps: string[];
  preservedData: T;
  failureCount: number;
  lastError?: {
    message: string;
    type: 'api_overload' | 'network_error' | 'auth_error' | 'unknown';
    timestamp: number;
  };
}

export interface RecoveryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  enableUserInteraction: boolean;
  autoSwitchModels: boolean;
  fallbackModels?: Model[];
}

export interface RecoveryDecision {
  action: 'retry' | 'switch_model' | 'abort' | 'resume';
  newModel?: Model;
  newApiKey?: string;
  skipToStep?: string;
}

// Global recovery state management
class RecoveryStateManager {
  private states = new Map<string, RecoveryState>();
  private listeners = new Map<string, ((state: RecoveryState) => void)[]>();

  saveState<T>(id: string, state: RecoveryState<T>): void {
    this.states.set(id, { ...state, id });
    this.notifyListeners(id, state);
    
    // Persist to localStorage for browser refresh recovery
    try {
      const serialized = JSON.stringify(state);
      localStorage.setItem(`recovery_state_${id}`, serialized);
    } catch (error) {
      console.warn('[Recovery] Failed to persist state:', error);
    }
  }

  getState<T>(id: string): RecoveryState<T> | undefined {
    const memoryState = this.states.get(id);
    if (memoryState) return memoryState as RecoveryState<T>;

    // Try to restore from localStorage
    try {
      const stored = localStorage.getItem(`recovery_state_${id}`);
      if (stored) {
        const state = JSON.parse(stored) as RecoveryState<T>;
        this.states.set(id, state);
        return state;
      }
    } catch (error) {
      console.warn('[Recovery] Failed to restore state from storage:', error);
    }

    return undefined;
  }

  removeState(id: string): void {
    this.states.delete(id);
    localStorage.removeItem(`recovery_state_${id}`);
    this.notifyListeners(id, undefined);
  }

  getAllStates(): RecoveryState[] {
    return Array.from(this.states.values());
  }

  onStateChange(id: string, callback: (state?: RecoveryState) => void): () => void {
    if (!this.listeners.has(id)) {
      this.listeners.set(id, []);
    }
    this.listeners.get(id)!.push(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(id);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) callbacks.splice(index, 1);
      }
    };
  }

  private notifyListeners(id: string, state?: RecoveryState): void {
    const callbacks = this.listeners.get(id);
    if (callbacks) {
      callbacks.forEach(callback => callback(state));
    }
  }
}

export const recoveryStateManager = new RecoveryStateManager();

// API Error classification
export function classifyError(error: Error | any): RecoveryState['lastError']['type'] {
  const errorMessage = error?.message?.toLowerCase() || '';
  const errorName = error?.name?.toLowerCase() || '';
  
  if (errorMessage.includes('overloaded') || errorMessage.includes('503') || errorMessage.includes('service unavailable')) {
    return 'api_overload';
  }
  
  if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorName.includes('network')) {
    return 'network_error';
  }
  
  if (errorMessage.includes('unauthorized') || errorMessage.includes('401') || errorMessage.includes('api key')) {
    return 'auth_error';
  }
  
  return 'unknown';
}

// Enhanced LLM wrapper with recovery capabilities
export async function callLLMWithRecovery<T>(
  recoveryId: string,
  stepName: string,
  llmCall: () => Promise<T>,
  options: RecoveryOptions,
  preservedData?: any
): Promise<T> {
  const state = recoveryStateManager.getState(recoveryId) || {
    id: recoveryId,
    processType: 'general' as const,
    startTime: Date.now(),
    currentStep: stepName,
    totalSteps: 1,
    completedSteps: [],
    preservedData: preservedData || {},
    failureCount: 0
  };

  state.currentStep = stepName;
  recoveryStateManager.saveState(recoveryId, state);

  let lastError: Error | null = null;
  let attempt = 0;
  
  while (attempt < options.maxRetries) {
    try {
      const result = await llmCall();
      
      // Success - mark step as completed
      if (!state.completedSteps.includes(stepName)) {
        state.completedSteps.push(stepName);
      }
      state.failureCount = 0;
      recoveryStateManager.saveState(recoveryId, state);
      
      return result;
    } catch (error) {
      lastError = error as Error;
      attempt++;
      
      const errorType = classifyError(error);
      state.lastError = {
        message: lastError.message,
        type: errorType,
        timestamp: Date.now()
      };
      state.failureCount++;
      recoveryStateManager.saveState(recoveryId, state);

      console.warn(`[Recovery] ${stepName} failed (attempt ${attempt}/${options.maxRetries}):`, error);

      if (attempt >= options.maxRetries) {
        break; // Will prompt user for recovery decision
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        options.baseDelay * Math.pow(2, attempt - 1),
        options.maxDelay
      );
      
      console.log(`[Recovery] Retrying ${stepName} in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Max retries reached - handle recovery
  if (options.enableUserInteraction) {
    return await handleUserRecovery(recoveryId, stepName, llmCall, lastError!, options);
  } else {
    // Clean up state and throw
    recoveryStateManager.removeState(recoveryId);
    throw lastError!;
  }
}

// User interaction for recovery decisions
async function handleUserRecovery<T>(
  recoveryId: string,
  stepName: string,
  llmCall: () => Promise<T>,
  lastError: Error,
  options: RecoveryOptions
): Promise<T> {
  const state = recoveryStateManager.getState(recoveryId)!;
  
  return new Promise((resolve, reject) => {
    // Emit custom event for UI to handle
    const recoveryEvent = new CustomEvent('api-recovery-needed', {
      detail: {
        recoveryId,
        stepName,
        error: lastError,
        state,
        options,
        onDecision: async (decision: RecoveryDecision) => {
          try {
            switch (decision.action) {
              case 'retry':
                // Reset failure count and try again
                state.failureCount = 0;
                recoveryStateManager.saveState(recoveryId, state);
                const retryResult = await callLLMWithRecovery(
                  recoveryId, stepName, llmCall, 
                  { ...options, maxRetries: Math.max(3, options.maxRetries) }, 
                  state.preservedData
                );
                resolve(retryResult);
                break;
                
              case 'switch_model':
                // Update the LLM call with new model/key and retry
                console.log('[Recovery] Switching model and retrying...');
                // The actual model switching should be handled by the caller
                // This is just a signal to try again with updated parameters
                state.failureCount = 0;
                recoveryStateManager.saveState(recoveryId, state);
                resolve(await callLLMWithRecovery(
                  recoveryId, stepName, llmCall, options, state.preservedData
                ));
                break;
                
              case 'resume':
                // Skip failed step and continue (if possible)
                if (!state.completedSteps.includes(stepName)) {
                  state.completedSteps.push(stepName); // Mark as completed to skip
                }
                recoveryStateManager.saveState(recoveryId, state);
                // Return a default/empty result - the caller needs to handle this case
                resolve(null as any);
                break;
                
              case 'abort':
                recoveryStateManager.removeState(recoveryId);
                reject(new Error(`Process aborted by user at step: ${stepName}`));
                break;
            }
          } catch (error) {
            reject(error);
          }
        }
      }
    });
    
    // Dispatch to the window for UI components to catch
    window.dispatchEvent(recoveryEvent);
  });
}

// Utility to create process-specific recovery contexts
export function createRecoveryContext(
  processType: RecoveryState['processType'],
  totalSteps: number = 1,
  preservedData?: any
): string {
  const id = `${processType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const state: RecoveryState = {
    id,
    processType,
    startTime: Date.now(),
    currentStep: '',
    totalSteps,
    completedSteps: [],
    preservedData: preservedData || {},
    failureCount: 0
  };
  
  recoveryStateManager.saveState(id, state);
  return id;
}

// Utility to check if a step was already completed
export function isStepCompleted(recoveryId: string, stepName: string): boolean {
  const state = recoveryStateManager.getState(recoveryId);
  return state?.completedSteps.includes(stepName) || false;
}

// Clean up completed processes
export function finalizeRecovery(recoveryId: string): void {
  recoveryStateManager.removeState(recoveryId);
}

// Get progress information
export function getRecoveryProgress(recoveryId: string): { completed: number; total: number; currentStep: string } | null {
  const state = recoveryStateManager.getState(recoveryId);
  if (!state) return null;
  
  return {
    completed: state.completedSteps.length,
    total: state.totalSteps,
    currentStep: state.currentStep
  };
}
