import { CaseFile, CaseFileSection } from '../types';

// ─── Safe Replace ─────────────────────────────────────────────────────────────

/**
 * Attempts to replace the full content of a section identified by sectionId.
 * The original case file is NEVER mutated on failure.
 */
export function tryReplaceSection(
    caseFile: CaseFile,
    sectionId: string,
    newContent: string
): { ok: true; next: CaseFile } | { ok: false; failedContent: string } {
    const sectionExists = caseFile.sections.some((s) => s.id === sectionId);
    if (!sectionExists || !newContent.trim()) {
        return { ok: false, failedContent: newContent };
    }

    const next: CaseFile = {
        ...caseFile,
        sections: caseFile.sections.map((s) =>
            s.id === sectionId ? { ...s, content: newContent } : s
        ),
    };
    return { ok: true, next };
}

// ─── Parse plain Markdown into a CaseFile ────────────────────────────────────

/**
 * Converts a plain .md string into a CaseFile by splitting on top-level headings.
 *
 * KEY DESIGN: The heading line is kept INSIDE section.content so that marked.parse()
 * renders it as a visible heading in the overlay. section.title is only metadata
 * (for the panel sidebar / navigation).
 */
export function parseCaseFileFromMarkdown(md: string, title = 'Case File'): CaseFile {
    // Normalise escaped newlines that come from LLM JSON string values
    const normalised = md
        .replace(/\\n/g, '\n')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\t/g, '    ');

    const lines = normalised.split('\n');
    const sections: CaseFileSection[] = [];
    let currentLines: string[] = [];
    let currentTitle: string | undefined;
    let secIndex = 0;

    const flushSection = () => {
        const content = currentLines.join('\n').trim();
        if (content) {
            sections.push({
                id: `sec-${secIndex++}`,
                title: currentTitle,
                content,
                comments: [],
            });
        }
        currentLines = [];
        currentTitle = undefined;
    };

    for (const line of lines) {
        // Match h1, h2 or h3 headings
        const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
        if (headingMatch) {
            flushSection();
            currentTitle = headingMatch[2].trim();
            // Keep the heading line in content so marked renders it as a heading
            currentLines.push(line);
        } else {
            currentLines.push(line);
        }
    }
    flushSection(); // final section

    // If nothing parsed (e.g. no headings at all), put whole content in one section
    if (sections.length === 0) {
        sections.push({ id: 'sec-0', content: normalised, comments: [] });
    }

    return {
        version: 1,
        title,
        createdAt: Date.now(),
        sections,
    };
}

// ─── Serialise CaseFile to markdown (for display / export) ────────────────────

export function caseFileToMarkdown(cf: CaseFile): string {
    return cf.sections.map((s) => s.content).join('\n\n');
}
