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

/**
 * Universal Interceptor: Catch models that invent their own search syntax
 * Extracted from useChat.ts to improve reusability and reduce hook complexity.
 */
export function createToolCallInterceptor(responseText: string) {
  const xmlMatch = responseText.match(/<search_web>([\s\S]*?)<\/search_web>/i);
  const bracketMatch = responseText.match(/\[search_web:?\s*([\s\S]*?)\]/i);
  const invokeMatch = responseText.match(/<invoke name="search_web">[\s\S]*?<parameter name="query">([\s\S]*?)<\/parameter>[\s\S]*?<\/invoke>/i);
  const tableMatch = responseText.match(/\|\s*tool\s*\|\s*search_web\s*\|[\s\S]*?\|\s*query\s*\|\s*([\s\S]*?)\s*\|/i);
  const jsonMatch = responseText.match(/\{[\s\S]*?"query"[\s\S]*?\}/i) || responseText.match(/\{[\s\S]*?"search"[\s\S]*?\}/i);

  let extractedQuery = '';
  let matchedText = '';

  if (xmlMatch) {
      extractedQuery = xmlMatch[1].trim();
      matchedText = xmlMatch[0];
  } else if (bracketMatch) {
      extractedQuery = bracketMatch[1].trim();
      matchedText = bracketMatch[0];
  } else if (invokeMatch) {
      extractedQuery = invokeMatch[1].trim();
      matchedText = invokeMatch[0];
  } else if (tableMatch) {
      extractedQuery = tableMatch[1].trim();
      matchedText = tableMatch[0];
  } else if (jsonMatch) {
      try {
          const parsed = JSON.parse(jsonMatch[0].replace(/```json|```/g, '').trim());
          extractedQuery = parsed.query || parsed.search || (parsed.parameters?.query);
          if (extractedQuery) matchedText = jsonMatch[0];
      } catch { /* ignore */ }
  }

  if (extractedQuery) {
      return {
          toolCalls: [{
              id: `intercepted_${Date.now()}`,
              type: 'function' as const,
              function: { name: 'search_web', arguments: JSON.stringify({ query: extractedQuery }) }
          }],
          cleanText: responseText.replace(matchedText, '').trim()
      };
  }

  return { toolCalls: [], cleanText: responseText };
}
