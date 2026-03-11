// src/utils/chatUtils.ts
import { ChatMessage, MessageSection } from '../types';

// ─── Citation Regex ──────────────────────────────────────────────────────────

/**
 * Robust regex to handle variations: [Source: ID], [ID], 【Source: ID】, 【ID】, and unbracketed Source: ID
 * Also captures variations like [1, 2, 3] or [Source: ID1, ID2]
 */
export const CITATION_REGEX = /\[Source:\s*([^\]]+)\]|\[(\d+(?:\s*,\s*\d+)*)\]|【Source:\s*([^】]+)】|【(\d+(?:\s*,\s*\d+)*)】|\bSource:\s*([^\s\]]+)\b/gi;

/**
 * Regex for extracting/stripping search results from message content.
 * Uses [\s\S] to match across newlines.
 */
export const SEARCH_RESULTS_REGEX = /<!--searchResults:([\s\S]*?)-->/gi;

// ─── Chat History Utilities ───────────────────────────────────────────────────

export function filterVisibleHistory(history: ChatMessage[]): ChatMessage[] {
  return history.filter(m => {
    if (m.isInternal) return false;
    if (m.role === 'tool') return false;
    if (m.role === 'model' && m.tool_calls && m.tool_calls.length > 0) return false;
    return (m.role === 'user' || m.role === 'model') && m.content;
  });
}

/**
 * Splits message content into logical sections separated by blank lines or headers.
 */
export function sectionizeMessage(content: string): MessageSection[] {
  if (!content) return [];
  const parts = content.split(/\n\s*\n|(?=\n#{1,6}\s)/);
  return parts
    .map((p, idx) => ({ id: `sec-${idx}`, content: p.trim() }))
    .filter(s => s.content.length > 0);
}

// ─── Markdown Table Codec ─────────────────────────────────────────────────────

export interface MarkdownTable {
  headers: string[];
  alignments: string[];
  rows: string[][];
  raw: string;
}

/**
 * Returns true if the given text block contains a GFM Markdown table.
 */
export function isMarkdownTable(block: string): boolean {
  const lines = block.trim().split('\n').map(l => l.trim());
  if (lines.length < 2) return false;
  const sepLine = lines[1];
  return /^\|?[\s\-:|]+\|/.test(sepLine);
}

/**
 * Parses a GFM Markdown table string into a structured object.
 * Returns null if the block is not a recognizable Markdown table.
 */
export function parseMarkdownTable(block: string): MarkdownTable | null {
  // Split by \n, trim each line, drop blank lines so stray CRLF/trailing newlines don't add phantom rows
  const lines = block.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return null;

  const splitRow = (line: string): string[] => {
    const stripped = line.startsWith('|') ? line.slice(1) : line;
    return stripped
      .split('|')
      .map(c => c.trim())
      .slice(0, stripped.endsWith('|') ? -1 : undefined);
  };

  const headers = splitRow(lines[0]);
  const sepParts = splitRow(lines[1]);

  if (!sepParts.every(p => /^:?-+:?$/.test(p.trim()))) return null;

  const alignments = sepParts.map(p => {
    const t = p.trim();
    if (t.startsWith(':') && t.endsWith(':')) return ':-:';
    if (t.endsWith(':')) return '--:';
    if (t.startsWith(':')) return ':--';
    return '---';
  });

  // Filter blank lines from rows too, and only keep rows that have at least some cell content
  const rows = lines.slice(2)
    .map(splitRow)
    .filter(cells => cells.some(c => c.length > 0));

  return { headers, alignments, rows, raw: block };
}

/**
 * Regenerates a clean GFM Markdown table string from a MarkdownTable structure.
 */
export function generateMarkdownTable(table: MarkdownTable): string {
  const colCount = table.headers.length;

  const colWidths = table.headers.map((h, i) => {
    const cellWidths = [h.length, 3, ...table.rows.map(r => (r[i] ?? '').length)];
    return Math.max(...cellWidths);
  });

  const formatRow = (cells: string[]): string => {
    const padded = Array.from({ length: colCount }, (_, i) => {
      const cell = cells[i] ?? '';
      return cell.padEnd(colWidths[i]);
    });
    return `| ${padded.join(' | ')} |`;
  };

  const formatSep = (): string => {
    const parts = table.alignments.map((a, i) => {
      const w = colWidths[i];
      if (a === ':-:') return `:${'-'.repeat(w - 2)}:`;
      if (a === '--:') return `${'-'.repeat(w - 1)}:`;
      if (a === ':--') return `:${'-'.repeat(w - 1)}`;
      return '-'.repeat(w);
    });
    return `| ${parts.join(' | ')} |`;
  };

  const lines = [
    formatRow(table.headers),
    formatSep(),
    ...table.rows.map(formatRow),
  ];
  return lines.join('\n');
}

// ─── Non-Table Fragment Matching ──────────────────────────────────────────────

function getLenientCharPattern(c: string): string {
  const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/[''']/.test(c)) return "['''']";
  if (/["""″]/.test(c)) return '[""""″]';
  if (/[–—‑-]/.test(c)) return '[–—‑-]';
  if (/[….]/.test(c)) return '[….]+';
  if (/\s/.test(c)) return '[\\s\\n\\r\\t\\u00A0\\u202F]+';
  if (/\d/.test(c)) return '(\\d+|\\[Source:.*?\\])';
  return escaped;
}

/**
 * Searches source for an exact-ish match of target, tolerating differences
 * in smart quotes, dashes, and whitespace but NOT crossing Markdown structure.
 * Returns the matched substring from source, or null on failure.
 */
export function findExactMatchLenient(source: string, target: string): string | null {
  const trimmed = target.trim();
  if (!trimmed) return null;
  const pattern = trimmed.split('').map(c => getLenientCharPattern(c)).join('');
  try {
    const match = source.match(new RegExp(pattern, 'i'));
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

/**
 * Creates a fuzzy regex that tolerates HTML tags and Markdown formatting between words.
 * Used as a last-resort fallback for non-table plain-text fragment replacement.
 */
export function createFuzzyRegex(text: string, mode: 'markdown' | 'html' = 'markdown'): RegExp {
  const trimmed = text.trim();
  if (!trimmed) return /^$/;

  const fuzzySeparator = mode === 'markdown'
    ? '(?:<[^>]*>|[*_~`|\\s\\n\\r\\t\\u00A0\\u202F])*?'
    : '(?:<[^>]*>|\\s|\\n|[\\u00A0\\u202F])*?';

  const pattern = trimmed.split('')
    .map((c, idx, arr) => {
      const p = getLenientCharPattern(c);
      return idx < arr.length - 1 ? `${p}${fuzzySeparator}` : p;
    })
    .join('');

  const final = mode === 'html' ? `(${pattern})(?![^<]*>)` : pattern;
  return new RegExp(final, 'gi');
}
