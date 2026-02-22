// src/utils/chatUtils.ts
import { ChatMessage, MessageSection } from '../types';

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

/**
 * Splits message content into logical sections (e.g., paragraphs or Markdown headers).
 */
export function sectionizeMessage(content: string): MessageSection[] {
  if (!content) return [];
  
  // Split by double newlines or headers that start a line
  // Using a more conservative regex: 
  // 1. \n\s*\n matches paragraph breaks
  // 2. (?=\n#{1,6}\s) matches the start of a header section
  const parts = content.split(/\n\s*\n|(?=\n#{1,6}\s)/);
  
  return parts.map((p, idx) => ({
    id: `sec-${idx}`,
    content: p.trim()
  })).filter(s => s.content.length > 0);
}
