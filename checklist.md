# Application Improvement Checklist

This document outlines the planned enhancements for the RAG application, based on our analysis of the current architecture.

### Retrieval and Reranking Pipeline

- [x] **Implement Semantic Chunking (via Parent Document Retriever):**
  - [x] Replaced the standard `RecursiveCharacterTextSplitter` with a hierarchical chunking strategy.
  - [x] The document is first split into large "parent" chunks for context.
  - [x] Each parent chunk is then split into smaller, sentence-level "child" chunks.
  - [x] The RAG pipeline now searches over the precise child chunks but retrieves the corresponding parent chunks, improving contextual accuracy.

- [ ] **Introduce Document-Level Scoring:**
  - [ ] After initial candidate retrieval, add a step to aggregate similarity scores for each source document.
  - [ ] Prioritize candidates from the top-scoring documents before passing them to the reranker.
  - [ ] This will ensure the final context is both relevant and coherent.

- [ ] **Implement Hybrid Search:**
  - [ ] Integrate a keyword-based search index (e.g., `FlexSearch`) alongside the existing vector store.
  - [ ] During search, query both the vector store and the keyword index.
  - [ ] Combine the results using a Reciprocal Rank Fusion (RRF) algorithm to leverage both semantic and keyword relevance.

- [x] **Add Light Query Transformation:**
  - [x] For standard retrieval, implement a fast, single-call LLM transformation to refine user queries.
  - [x] This will improve the quality of the initial search without incurring the high cost and latency of the full "Deep Analysis" mode.

### Data Ingestion and Storage

- [ ] **Implement Structure-Aware Ingestion:**
  - [ ] For structured file types (like DOCX), use a library (e.g., `mammoth.js`) to convert them to HTML.
  - [ ] Use the HTML structure (headings, paragraphs) to guide the chunking process, creating more logical and semantically meaningful chunks.

- [ ] **Integrate a Persistent Vector Database:**
  - [ ] Replace the in-memory `VectorStore` with a disk-based solution (e.g., `LanceDB` or `ChromaDB`) to ensure scalability.
  - [ ] Implement a threshold-based strategy: use the in-memory store for a small number of chunks and automatically switch to the persistent database for larger datasets.