// Diagnostic test: replicate exact matching logic against real log data
// Run with: node src/test/table-match-debug.mjs

// === Replicate stripMarkdown ===
function stripMarkdown(t) {
    return t
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[*_~`]+/g, '')
        .replace(/[\u2011\u2013\u2014]/g, '-')   // ‑ – — → -
        .replace(/[\s\u00A0\u202F]+/g, ' ')       // all spaces → normal space
        .trim();
}

// === Replicate getLenientCharPattern + findExactMatchLenient ===
function getLenientCharPattern(c) {
    const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (/[''']/.test(c)) return "['''']";
    if (/["""″]/.test(c)) return '[""""″]';
    if (/[\u2011\u2013\u2014\-]/.test(c)) return '[\u2011\u2013\u2014-]';
    if (/[…..]/.test(c)) return '[…..]+';
    if (/\s/.test(c)) return '[\\s\\n\\r\\t\\u00A0\\u202F]+';
    if (/\d/.test(c)) return '(\\d+|\\[Source:.*?\\])';
    return escaped;
}

function findExactMatchLenient(source, target) {
    const trimmed = target.trim();
    if (!trimmed) return null;
    const pattern = trimmed.split('').map(c => getLenientCharPattern(c)).join('');
    try {
        const regex = new RegExp(pattern, 'i');
        const match = source.match(regex);
        return match ? match[0] : null;
    } catch (e) {
        console.warn('  [findExactMatchLenient] Regex error:', e.message, '(pattern len:', pattern.length, ')');
        return null;
    }
}

// === Real data from logs ===
// selectionText from log (the .slice(0, 120) truncated version — we'll use both)
const selectionTextTruncated = "| Segment\u2011level revenue | \u2022 FY 2024 (pre\u2011split) \u2013 \u00A5 206 billion (\u2248 12 % of total group revenue). \u2022 FY 2025 (post\u2011split) ";
// Full version the LLM saw as the "original snippet":
const selectionTextFull = "| Segment\u2011level revenue | \u2022 FY 2024 (pre\u2011split) \u2013 \u00A5 206 billion (\u2248 12 % of total group revenue). \u2022 FY 2025 (post\u2011split) \u2013 \u00A5 191 billion (\u2248 11 % of total). | Integrated Report 2025 \u2013 Table \u201cRevenue by segment\u201d (Server & Storage) |";

// What the table row likely contains in Markdown (from LLM reasoning, no bold markers):
const mockRow = [
    "Segment\u2011level revenue",
    "\u2022 FY 2024 (pre\u2011split) \u2013 \u00A5 206 billion (\u2248 12 % of total group revenue).<br>\u2022 FY 2025 (post\u2011split) \u2013 \u00A5 191 billion (\u2248 11 % of total).",
    "Integrated Report 2025 \u2013 Table \u201cRevenue by segment\u201d (Server & Storage)"
];

// Also try the bold version (first cell might be **bold**):
const mockRowBold = [
    "**Segment\u2011level revenue**",
    "\u2022 FY 2024 (pre\u2011split) \u2013 **\u00A5 206 billion** (\u2248 12 % of total group revenue).<br>\u2022 FY 2025 (post\u2011split) \u2013 **\u00A5 191 billion** (\u2248 11 % of total).",
    "Integrated Report 2025 \u2013 Table \u201cRevenue by segment\u201d (Server & Storage)"
];

function testRow(label, row, selectionText) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`ROW: ${label}`);
    console.log(`SEL: "${selectionText.slice(0, 80)}..."`);
    console.log(`${'='.repeat(60)}`);

    const selTrimmed = selectionText.trim();

    const selTokens = selTrimmed
        .replace(/^\|\s*/, '')
        .replace(/\s*\|$/, '')
        .split('|')
        .map(c => c.trim())
        .filter(c => c.length >= 4);

    console.log('selTokens:', selTokens.map(t => `"${t.slice(0, 60)}"`));

    const selPlain = stripMarkdown(selTrimmed).replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    console.log('selPlain:', `"${selPlain.slice(0, 80)}"`);

    // Strategy 1
    const rowFull = '| ' + row.join(' | ') + ' |';
    const s1 = findExactMatchLenient(rowFull, selTrimmed);
    console.log('\nStrategy 1 (lenient match of rowFull vs selTrimmed):', s1 !== null ? 'MATCH' : 'miss');

    // Strategy 2 — token match (truncated to 60)
    let s2match = null;
    for (const tok of selTokens) {
        const tokShort = tok.slice(0, 60);
        for (const cell of row) {
            const r = findExactMatchLenient(cell, tokShort);
            if (r !== null) { s2match = `tok="${tokShort.slice(0, 30)}" in cell="${cell.slice(0, 30)}"`; break; }
        }
        if (s2match) break;
    }
    console.log('Strategy 2 (lenient token in cell):', s2match || 'miss');

    // Strategy 2b — plain includes
    let s2bMatch = null;
    for (const tok of selTokens) {
        const tokLower = stripMarkdown(tok).toLowerCase();
        if (tokLower.length < 4) continue;
        for (const cell of row) {
            const cellStripped = stripMarkdown(cell).toLowerCase();
            console.log(`  2b: "${tokLower.slice(0, 30)}" in "${cellStripped.slice(0, 40)}"? ${cellStripped.includes(tokLower)}`);
            if (cellStripped.includes(tokLower)) {
                s2bMatch = `tok="${tokLower.slice(0, 30)}" in cell`;
                break;
            }
        }
        if (s2bMatch) break;
    }
    console.log('Strategy 2b (plain includes):', s2bMatch || 'miss');

    // Strategy 3
    const rowFlat = row.join(' ');
    const s3 = findExactMatchLenient(rowFlat, selTrimmed);
    console.log('Strategy 3 (lenient match of rowFlat vs selTrimmed):', s3 !== null ? 'MATCH' : 'miss');

    // Strategy 4
    const rowStripped = stripMarkdown(rowFlat).replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    const hit4 = selPlain.length >= 8 && rowStripped.toLowerCase().includes(selPlain.toLowerCase().slice(0, 80));
    console.log('Strategy 4 (plain rowStripped includes selPlain slice):', hit4 ? 'MATCH' : 'miss');
    console.log('  rowStripped:', `"${rowStripped.slice(0, 80)}..."`);
    console.log('  selPlain[0:80]:', `"${selPlain.slice(0, 80)}"`);
}

// Run all combinations:
testRow('Plain row vs FULL selection', mockRow, selectionTextFull);
testRow('Plain row vs TRUNCATED selection', mockRow, selectionTextTruncated);
testRow('Bold row vs FULL selection', mockRowBold, selectionTextFull);
testRow('Bold row vs TRUNCATED selection', mockRowBold, selectionTextTruncated);
