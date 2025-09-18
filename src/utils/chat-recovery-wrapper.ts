// src/utils/chat-recovery-wrapper.ts
// Wrapper to add recovery support to existing chat functionality without major refactoring

import { generateContent, LlmResponse } from '../api/llm-provider';
import { ChatMessage, Model } from '../types';
import { callLLMWithRecovery, createRecoveryContext, finalizeRecovery } from './api-recovery';

// Enhanced generateContent with recovery support for chat operations
export async function generateContentWithRecovery(
  model: Model,
  apiKey: string | undefined,
  messages: ChatMessage[],
  processType: 'rag_query' | 'general' = 'general',
  stepName: string = 'llm_call'
): Promise<LlmResponse> {
  const recoveryId = createRecoveryContext(
    processType,
    1,
    {
      model: model,
      apiKey: apiKey,
      messages: messages.slice(-3), // Keep last few messages for context
      timestamp: Date.now()
    }
  );

  try {
    const result = await callLLMWithRecovery(
      recoveryId,
      stepName,
      () => generateContent(model, apiKey, messages),
      {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        enableUserInteraction: true,
        autoSwitchModels: false
      }
    );

    finalizeRecovery(recoveryId);
    return result;
  } catch (error) {
    finalizeRecovery(recoveryId);
    throw error;
  }
}

// Simple wrapper for backward compatibility
export async function generateContentWithQuickRecovery(
  model: Model,
  apiKey: string | undefined,
  messages: ChatMessage[]
): Promise<LlmResponse> {
  return generateContentWithRecovery(model, apiKey, messages, 'general', 'quick_llm_call');
}
