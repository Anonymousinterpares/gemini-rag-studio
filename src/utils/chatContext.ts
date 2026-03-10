// src/utils/chatContext.ts
// Utility for extracting paged chat context for use in KB updates and agents.

import { ChatMessage } from '../types';

/** Roles that should be treated as visible, contextual conversation turns. */
const VISIBLE_ROLES = new Set(['user', 'model']);

/**
 * Message types that contain critical investigation context and must ALWAYS
 * be included in the chat context block regardless of character budget.
 */
const PRIORITY_TYPES = new Set(['case_file_report', 'case_file_analysis']);

/**
 * Maximum characters a single message's content may occupy in the context block
 * before being truncated. Large case files are truncated, not dropped.
 */
const MAX_SINGLE_MSG_CHARS = 24000;

/**
 * Returns a page of visible, non-internal chat messages from the end of history.
 *
 * - Filters out internal/system/tool messages.
 * - Includes `case_file_report` and `case_file_analysis` typed messages — they
 *   live in the chat body and contain crucial investigation context.
 * - Each page is `pageSize` messages; page 0 = most recent.
 * - Returns an empty array if the requested page is out of range.
 *
 * @param history  The full chat history array.
 * @param pageSize Number of messages per page (default: 20).
 * @param page     Zero-indexed page number, 0 = most recent (default: 0).
 */
export function getPagedChatContext(
    history: ChatMessage[],
    pageSize = 20,
    page = 0
): ChatMessage[] {
    const visible = history.filter(
        (m) =>
            !m.isInternal &&
            VISIBLE_ROLES.has(m.role) &&
            m.content !== null
    );

    if (visible.length === 0) return [];

    const totalPages = Math.ceil(visible.length / pageSize);
    if (page >= totalPages) return [];

    // Page 0 = last `pageSize` messages, page 1 = the previous `pageSize`, etc.
    const endIdx = visible.length - page * pageSize;
    const startIdx = Math.max(0, endIdx - pageSize);
    return visible.slice(startIdx, endIdx);
}

/**
 * Formats a slice of chat messages into a readable block for inclusion
 * in an LLM system prompt.
 *
 * Strategy:
 * 1. Priority messages (case_file_report, case_file_analysis) are always included
 *    first, each truncated to MAX_SINGLE_MSG_CHARS if needed.
 * 2. Remaining messages are added in chronological order until `maxChars` is reached.
 *    Each is individually truncated rather than dropped.
 *
 * @param messages  Array of ChatMessage objects to format (chronological order).
 * @param maxChars  Total character cap for the entire block (default: 40000).
 */
export function formatChatContextBlock(messages: ChatMessage[], maxChars = 40000): string {
    if (messages.length === 0) return '';

    // ── Step 1: Separate priority messages from regular messages ──────────────
    const priorityMessages = messages.filter(m => m.type && PRIORITY_TYPES.has(m.type));
    const regularMessages = messages.filter(m => !m.type || !PRIORITY_TYPES.has(m.type));

    const parts: string[] = [];
    let usedChars = 0;

    // ── Step 2: Always include priority messages (truncated if needed) ─────────
    for (const m of priorityMessages) {
        const roleLabel = m.role === 'model' ? 'ASSISTANT' : 'USER';
        const typeTag = m.type ? ` [${m.type}]` : '';
        const rawContent = m.content ?? '';

        // Strip embedded <!--searchResults:...---> annotations from case file content
        const cleanContent = rawContent.replace(/<!--searchResults:[\s\S]*?-->/g, '').trim();

        const truncatedContent = cleanContent.length > MAX_SINGLE_MSG_CHARS
            ? cleanContent.slice(0, MAX_SINGLE_MSG_CHARS) + '\n[...truncated for context budget]'
            : cleanContent;

        const entry = `${roleLabel}${typeTag}:\n${truncatedContent}\n\n`;
        parts.push(entry);
        usedChars += entry.length;
    }

    // ── Step 3: Add regular messages until budget is reached ──────────────────
    // Regular messages are iterated chronologically (oldest → newest).
    for (const m of regularMessages) {
        if (usedChars >= maxChars) break;

        const roleLabel = m.role === 'model' ? 'ASSISTANT' : 'USER';
        const typeTag = m.type ? ` [${m.type}]` : '';
        const rawContent = m.content ?? '';
        const cleanContent = rawContent.replace(/<!--searchResults:[\s\S]*?-->/g, '').trim();

        const remaining = maxChars - usedChars;
        const truncatedContent = cleanContent.length > Math.min(MAX_SINGLE_MSG_CHARS, remaining)
            ? cleanContent.slice(0, Math.min(MAX_SINGLE_MSG_CHARS, remaining)) + '\n[...truncated]'
            : cleanContent;

        const entry = `${roleLabel}${typeTag}:\n${truncatedContent}\n\n`;
        parts.push(entry);
        usedChars += entry.length;
    }

    return parts.join('').trim();
}
