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

export interface DocumentStructureMap {
  chapters: { name: string; start: number; end: number }[];
  paragraphs: { start: number; end: number }[];
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
interface SearchCandidate {
  id: string;
  similarity: number;
  start: number;
  end: number;
  parentChunkIndex: number;
  embedding?: number[];
}

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
  // Document structure (chapters/paragraphs)
  private structureIndex: Map<string, DocumentStructureMap> = new Map();

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
  }

  setIndexes(id: string, entities: Record<string, { count: number; positions: number[] }>, structure: DocumentStructureMap) {
    const entityMap = new Map<string, { count: number; positions: number[] }>();
    for (const [k, v] of Object.entries(entities)) {
      entityMap.set(k, v);
    }
    this.entityIndex.set(id, entityMap);
    this.structureIndex.set(id, structure);
  }

  /**
   * Diversifies an existing set of candidates using MMR and Span Diversity.
   * Useful for agents that merge results from multiple sub-queries.
   */
  diversify(
    candidates: ({ chunk: string; similarity: number, id: string, start: number, end: number, embedding: number[] })[], 
    topK: number, 
    options: { lambda?: number, spanWeight?: number } = {}
  ): { chunk: string; similarity: number, id: string, start: number, end: number }[] {
    if (candidates.length === 0) return [];
    
    const { lambda = 0.7, spanWeight = 0.1 } = options;
    
    const selectedIndices: number[] = [];
    const sectionUsage = new Map<string, number>();

    const candidateSections = candidates.map(c => {
        const struct = this.structureIndex.get(c.id);
        if (!struct || !struct.chapters || struct.chapters.length === 0) return `${c.id}-root`;
        const chapter = struct.chapters.find(ch => c.start >= ch.start && c.start < ch.end);
        return chapter ? `${c.id}-${chapter.name}` : `${c.id}-unknown`;
    });

    while (selectedIndices.length < Math.min(topK, candidates.length)) {
        let bestScore = -Infinity;
        let bestIndex = -1;

        for (let i = 0; i < candidates.length; i++) {
            if (selectedIndices.includes(i)) continue;

            const candidate = candidates[i];
            const relevance = candidate.similarity;
            
            let maxSimilarityToSelected = 0;
            for (const selIdx of selectedIndices) {
                const sim = cos_sim(candidate.embedding, candidates[selIdx].embedding);
                if (sim > maxSimilarityToSelected) maxSimilarityToSelected = sim;
            }

            const sectionKey = candidateSections[i];
            const sectionCount = sectionUsage.get(sectionKey) || 0;
            const progressiveSpanPenalty = sectionCount === 0 ? 0 : spanWeight * Math.pow(1.5, sectionCount - 1);

            const score = (lambda * relevance) - ((1 - lambda) * maxSimilarityToSelected) - progressiveSpanPenalty;

            if (score > bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }

        if (bestIndex !== -1) {
            selectedIndices.push(bestIndex);
            const sectionKey = candidateSections[bestIndex];
            sectionUsage.set(sectionKey, (sectionUsage.get(sectionKey) || 0) + 1);
        } else {
            break;
        }
    }

    return selectedIndices.map(idx => {
        const { embedding: _emb, ...rest } = candidates[idx];
        return rest;
    });
  }

  /**
   * Performs an intelligent diversity search using Maximal Marginal Relevance (MMR)
   * and Dynamic Span-Aware Diversity.
   */
  search(
    queryEmbedding: number[], 
    topK = 20, 
    docId?: string, 
    options: { lambda?: number, spanWeight?: number, diversityType?: 'mmr' | 'simple', includeEmbeddings?: boolean } = {}
  ): { chunk: string; similarity: number, id: string, start: number, end: number, embedding?: number[] }[] {
    if (this.childVectors.length === 0) return [];

    const { 
      lambda = 0.7,      // 1.0 = Pure Relevance, 0.0 = Pure Diversity
      spanWeight = 0.1,  // Base penalty for repeating a section
      diversityType = 'mmr',
      includeEmbeddings = false
    } = options;

    let vectorsToSearch = this.childVectors;
    if (docId) {
        vectorsToSearch = this.childVectors.filter(v => v.id === docId);
    }

    // 1. Candidate Retrieval (O(N))
    const initialCandidates = vectorsToSearch.map((item) => {
        const similarity = cos_sim(queryEmbedding, item.embedding);
        return { 
            similarity, 
            id: item.id, 
            parentChunkIndex: item.parentChunkIndex, 
            start: item.start,
            embedding: item.embedding 
        };
    }).sort((a, b) => b.similarity - a.similarity).slice(0, 100);

    if (initialCandidates.length === 0) return [];
    if (diversityType === 'simple' || initialCandidates.length === 1) {
        return this.resolveParentChunks(initialCandidates.slice(0, topK), includeEmbeddings);
    }

    // 2. Intelligent Selection via internal diversification
    const diversifiedChildren = this.diversify(initialCandidates, topK, { lambda, spanWeight });
    
    // Resolve back to parents for rich context
    return this.resolveParentChunks(diversifiedChildren, includeEmbeddings);
  }

  /**
   * Helper to map child candidates back to their rich parent context
   */
  private resolveParentChunks(candidates: SearchCandidate[], includeEmbeddings: boolean = false): { chunk: string; similarity: number, id: string, start: number, end: number, embedding?: number[] }[] {
    const results: { chunk: string; similarity: number, id: string, start: number, end: number, embedding?: number[] }[] = [];
    const seenParentKeys = new Set<string>();

    for (const result of candidates) {
        const parentChunks = this.parentChunkStore.get(result.id);
        if (!parentChunks) continue;

        let parentChunk: DocumentChunk | undefined;
        if (result.parentChunkIndex >= 0) {
            parentChunk = parentChunks[result.parentChunkIndex];
        } else if (result.parentChunkIndex === -1) {
            parentChunk = parentChunks.find(p => p.start === result.start);
        }

        if (!parentChunk) continue;

        const parentKey = `${result.id}-${parentChunk.start}`;
        if (!seenParentKeys.has(parentKey)) {
            seenParentKeys.add(parentKey);
            results.push({
                chunk: parentChunk.text,
                similarity: result.similarity,
                id: result.id,
                start: parentChunk.start,
                end: parentChunk.end,
                ...(includeEmbeddings ? { embedding: result.embedding } : {})
            });
        }
    }
    return results;
  }

  clear() {
    this.childVectors = [];
    this.parentChunkStore.clear();
    // Also clear related indexes to avoid stale metadata
    this.entityIndex.clear();
    this.structureIndex.clear();
  }

  // New helpers for span-aware selection
  getParentChunks(id: string): DocumentChunk[] | undefined {
    return this.parentChunkStore.get(id);
  }

  // Entity index APIs
  getEntities(id: string): Record<string, { count: number; positions: number[] }> | undefined {
    const m = this.entityIndex.get(id);
    if (!m) return undefined;
    const res: Record<string, { count: number; positions: number[] }> = {};
    for (const [k, v] of m.entries()) {
      res[k] = v;
    }
    return res;
  }

  getTopEntities(id: string, minCount = 2, max = 50): { entity: string; count: number }[] {
    const m = this.entityIndex.get(id);
    if (!m) return [];
    return Array.from(m.entries())
      .filter(([_unused, v]) => v.count >= minCount)
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

  getStructure(id: string): DocumentStructureMap | undefined {
    return this.structureIndex.get(id);
  }

  removeDocument(id: string) { // Use id
    this.childVectors = this.childVectors.filter(v => v.id !== id); // Use v.id
    this.parentChunkStore.delete(id); // Use id
    // Ensure indexes are also cleared for this document
    this.entityIndex.delete(id);
    this.structureIndex.delete(id);
  }

  getEmbeddingCount(): number {
    return this.childVectors.length;
  }
}