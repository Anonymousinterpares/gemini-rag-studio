import { cos_sim } from "@xenova/transformers";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

// 1. Document Chunking
// We split the document into smaller chunks to embed them separately.
export interface DocumentChunk {
  text: string;
  start: number;
  end: number;
  parentChunkIndex?: number; // Optional: Link to parent for child chunks
}

export async function chunkDocument(text: string, chunkSize = 1000, overlap = 200): Promise<DocumentChunk[]> {
  console.log("Applying chunking strategy.");

  let processedText = text;
  // First, check if the content is JSON. If so, pretty-print it to prepare for chunking.
  try {
    const parsed = JSON.parse(text);
    processedText = JSON.stringify(parsed, null, 2);
    console.log("Content is JSON, pretty-printing before chunking.");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_e) {
    // Not JSON, so proceed with original text.
    console.log("Content is not JSON, chunking as plain text.");
  }

  // Use LangChain's RecursiveCharacterTextSplitter for robust chunking.
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: overlap,
  });

  const chunks = await splitter.splitText(processedText);
  console.log(`Split text into ${chunks.length} chunks.`);

  // The splitter doesn't track start/end positions, so we'll approximate it.
  // This is a simplification; for exact positions, a more complex mapping would be needed.
  let cumulativeLength = 0;
  return chunks.map(chunkText => {
    const start = cumulativeLength;
    const end = start + chunkText.length;
    cumulativeLength = end; // This doesn't account for overlap, but is a reasonable approximation.
    return { text: chunkText, start, end };
  });
}

// 4. Vector Store and Search
// A simple in-memory vector store to hold the embeddings and perform search.
export class VectorStore {
  // Holds the small, searchable child chunks and their embeddings
  private childVectors: {
    embedding: number[];
    id: string; // Use file ID instead of path
    parentChunkIndex: number; // -1 for legacy chunks
    start: number; // start of the child chunk
    end: number; // end of the child chunk
  }[] = [];
  // Holds the large, contextual parent chunks, indexed by document ID and then by index
  private parentChunkStore: Map<string, DocumentChunk[]> = new Map();
  // Lightweight entity index: per docId -> entity -> { count, positions }
  private entityIndex: Map<string, Map<string, { count: number; positions: number[] }>> = new Map();

  addChunkEmbedding(chunk: DocumentChunk, id: string, embedding: number[]) {
    // This is the legacy path for standard chunking. The parent chunk is the chunk itself.
    this.childVectors.push({
      embedding,
      id, // Use file ID
      parentChunkIndex: -1,
      start: chunk.start,
      end: chunk.end,
    });
    if (!this.parentChunkStore.has(id)) { // Use file ID
      this.parentChunkStore.set(id, []); // Use file ID
    }
    // In the legacy path, each chunk is its own parent.
    this.parentChunkStore.get(id)!.push(chunk); // Use file ID
  }

  addChildChunkEmbedding(
    id: string, // Use file ID
    embedding: number[],
    childChunk: { text: string; start: number; end: number; parentChunkIndex: number }
  ) {
    this.childVectors.push({
      embedding,
      id, // Use file ID
      parentChunkIndex: childChunk.parentChunkIndex,
      start: childChunk.start,
      end: childChunk.end,
    });
  }

  addParentChunks(id: string, parentChunks: DocumentChunk[]) { // Use file ID
    this.parentChunkStore.set(id, parentChunks); // Use file ID
    // Build a lightweight entity index for this doc
    try {
      const entityMap = new Map<string, { count: number; positions: number[] }>();
      // Join text or scan each chunk to track positions
      for (const pc of parentChunks) {
        const text = pc.text;
        // Simple heuristic: capitalized tokens or multi-word capitalized sequences
        const entityRegex = /\b([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'\-]+(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'\-]+)*)\b/g;
        let match: RegExpExecArray | null;
        while ((match = entityRegex.exec(text)) !== null) {
          const entity = match[1].trim();
          // Filter trivial/common words
          if (entity.length < 2) continue;
          const lower = entity.toLowerCase();
          if (['the', 'and', 'or', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'with', 'by'].includes(lower)) continue;
          const pos = pc.start + (match.index || 0);
          if (!entityMap.has(lower)) entityMap.set(lower, { count: 0, positions: [] });
          const rec = entityMap.get(lower)!;
          rec.count += 1;
          rec.positions.push(pos);
        }
      }
      this.entityIndex.set(id, entityMap);
    } catch (e) {
      console.warn('[VectorStore] Failed to build entity index for', id, e);
    }
  }

  search(queryEmbedding: number[], topK = 20, docId?: string): { chunk: string; similarity: number, id: string, start: number, end: number }[] { // Use docId
    if (this.childVectors.length === 0) {
        return [];
    }

    let vectorsToSearch = this.childVectors;
    if (docId) { // Use docId
        vectorsToSearch = this.childVectors.filter(v => v.id === docId); // Use v.id
    }

    // 1. Initial Candidate Retrieval: Fetch a larger pool of candidates (e.g., 100)
    const initialCandidates = vectorsToSearch.map((item) => {
        const similarity = cos_sim(queryEmbedding, item.embedding);
        return { similarity, id: item.id, parentChunkIndex: item.parentChunkIndex, start: item.start }; // Use item.id
    }).sort((a, b) => b.similarity - a.similarity).slice(0, 100);

    // 2. Document Score Aggregation
    const docScores = new Map<string, number>();
    for (const candidate of initialCandidates) {
        docScores.set(candidate.id, (docScores.get(candidate.id) || 0) + candidate.similarity); // Use candidate.id
    }

    // 3. Top Document Selection
    const sortedDocs = Array.from(docScores.entries()).sort((a, b) => b[1] - a[1]);
    console.log(`[DocScore] Top scoring documents:`, JSON.stringify(sortedDocs.slice(0, 5)));
    const topDocIds = new Set(sortedDocs.slice(0, 5).map(entry => entry[0])); // Use doc IDs

    // 4. Finalist Chunk Gathering
    const finalistCandidates = initialCandidates.filter(c => topDocIds.has(c.id)); // Use c.id

    // 5. Unique Parent Chunk Retrieval
    const uniqueParentChunks = new Map<string, { chunk: string; similarity: number, id: string, start: number, end: number }>(); // Use id

    for (const result of finalistCandidates) {
        const parentChunks = this.parentChunkStore.get(result.id); // Use result.id
        if (!parentChunks) {
            console.error(`[VectorStore ERROR] No parent chunks found for ID: ${result.id}`); // Use result.id
            continue;
        }

        let parentChunk: DocumentChunk | undefined;
        if (result.parentChunkIndex >= 0) {
            parentChunk = parentChunks[result.parentChunkIndex];
        } else if (result.parentChunkIndex === -1) {
            parentChunk = parentChunks.find(p => p.start === result.start);
        }

        if (!parentChunk) {
            console.error(`[VectorStore ERROR] Could not retrieve parent chunk for ID ${result.id} with index ${result.parentChunkIndex}.`); // Use result.id
            continue;
        }

        const parentKey = `${result.id}-${parentChunk.start}`; // Use result.id
        if (!uniqueParentChunks.has(parentKey)) {
            uniqueParentChunks.set(parentKey, {
                chunk: parentChunk.text,
                similarity: result.similarity,
                id: result.id, // Use result.id
                start: parentChunk.start,
                end: parentChunk.end,
            });
        }
    }

    // 6. Return Final Results, sorted by similarity and sliced to topK
    return Array.from(uniqueParentChunks.values())
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK);
  }

  clear() {
    this.childVectors = [];
    this.parentChunkStore.clear();
  }

  // New helpers for span-aware selection
  getParentChunks(id: string): DocumentChunk[] | undefined {
    return this.parentChunkStore.get(id);
  }

  // Entity index APIs
  getTopEntities(id: string, minCount = 2, max = 50): { entity: string; count: number }[] {
    const m = this.entityIndex.get(id);
    if (!m) return [];
    return Array.from(m.entries())
      .filter(([_, v]) => v.count >= minCount)
      .map(([k, v]) => ({ entity: k, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, max);
  }

  getEntityMentions(id: string, entity: string): number[] {
    const m = this.entityIndex.get(id);
    if (!m) return [];
    const rec = m.get(entity.toLowerCase());
    return rec ? rec.positions : [];
  }

  getDocSpan(id: string): { minStart: number; maxEnd: number } | undefined {
    const pcs = this.parentChunkStore.get(id);
    if (!pcs || pcs.length === 0) return undefined;
    let minStart = pcs[0].start;
    let maxEnd = pcs[0].end;
    for (const p of pcs) {
      if (p.start < minStart) minStart = p.start;
      if (p.end > maxEnd) maxEnd = p.end;
    }
    return { minStart, maxEnd };
  }

  removeDocument(id: string) { // Use id
    this.childVectors = this.childVectors.filter(v => v.id !== id); // Use v.id
    this.parentChunkStore.delete(id); // Use id
  }

  getEmbeddingCount(): number {
    return this.childVectors.length;
  }
}