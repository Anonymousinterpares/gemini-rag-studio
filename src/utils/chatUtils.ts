// src/utils/chatUtils.ts
import { ChatMessage, MessageSection } from '../types';

/**
 * Helper to filter chat history to only include what the user sees in the UI.
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
  const parts = content.split(/\n\s*\n|(?=\n#{1,6}\s)/);
  return parts.map((p, idx) => ({
    id: `sec-${idx}`,
    content: p.trim()
  })).filter(s => s.content.length > 0);
}

/**
 * Normalizes a single character into a regex part.
 */
function getLenientCharPattern(c: string): string {
  // Escape regex special chars
  const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (/[’‘’]/.test(c)) return "['’‘’]";
  if (/[“”"″]/.test(c)) return '["“”"″]';
  if (/[–—]/.test(c)) return '[–—-]';
  if (/[….]/.test(c)) return '[….]+';
  if (/\s/.test(c)) return '[\\s\\n\\r\\t\\u00A0\\u202F]+';
  if (/\d/.test(c)) return '(\\d+|\\[Source:.*?\\])';

  return escaped;
}

/**
 * Creates a fuzzy regex pattern to match a text fragment despite formatting or HTML tags.
 */
export function createFuzzyRegex(text: string, mode: 'markdown' | 'html' = 'markdown'): RegExp {
  const trimmed = text.trim();
  if (!trimmed) return /^$/;

  // We split the ORIGINAL text by character to avoid splitting our own regex escape sequences later
  const chars = trimmed.split('');

  // Separator between characters
  // For Markdown: allow markers (*, _, ~, `, |) and ANY whitespace/newlines
  // For HTML: allow tags and ANY whitespace/newlines
  const fuzzySeparator = mode === 'markdown'
    ? '[*_~`|\\s\\n\\r\\t\\u00A0\\u202F]*'
    : '(?:<[^>]*>|\\s|\\n|[\\u00A0\\u202F])*';

  const pattern = chars
    .map((c, idx) => {
      const charPart = getLenientCharPattern(c);
      // Add the fuzzy separator AFTER every character except the last one
      return idx < chars.length - 1 ? `${charPart}${fuzzySeparator}` : charPart;
    })
    .join('');

  const finalPattern = mode === 'html' ? `(${pattern})(?![^<]*>)` : pattern;

  return new RegExp(finalPattern, 'gi');
}
