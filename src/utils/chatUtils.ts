// src/utils/chatUtils.ts
import { ChatMessage } from '../types';

/**
 * Helper to filter chat history to only include what the user sees in the UI.
 * This excludes internal system messages, tool calls, and tool results.
 */
export function filterVisibleHistory(history: ChatMessage[]): ChatMessage[] {
  return history.filter(m => {
    if (m.isInternal) return false;
    if (m.role === 'tool') return false;
    if (m.role === 'model' && m.tool_calls && m.tool_calls.length > 0) return false;
    return (m.role === 'user' || m.role === 'model') && m.content;
  });
}
