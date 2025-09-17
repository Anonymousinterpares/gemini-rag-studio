# Application Architecture: Gemini RAG Studio

This document outlines the technical architecture of the Gemini RAG Studio application. The design prioritizes privacy, performance, and user experience by adopting a fully client-side model.

## 1. Core Architectural Principles

- **Client-Side First:** All file processing, indexing, and storage occur within the user's web browser. This eliminates the need for a backend server, reduces latency for data processing, and guarantees that user files are never transmitted to an external server, ensuring maximum privacy.
- **Component-Based UI:** The user interface is built with React, promoting a modular, maintainable, and reactive design.
- **State-Driven Logic:** The application's state (loaded files, chat history, selected view) is managed within React components. Changes in state automatically trigger UI updates.

## 2. Architectural Layers

The application is logically separated into three distinct layers:

### 2.1. Presentation Layer (UI)

- **Technology:** React, TypeScript, CSS.
- **Responsibilities:**
    - Rendering the three-panel layout (File Management, Chat, Document Viewer).
    - Handling all user interactions (drag-and-drop, clicks, text input).
    - Displaying data from the application state, such as the file tree, chat messages, and document content.
    - Orchestrating calls to the Data Processing and AI Layers based on user actions.

### 2.2. Data Processing & Storage Layer

- **Technology:** Browser APIs (`FileReader`, `FileSystem API`), JavaScript data structures.
- **Responsibilities:**
    - **File Ingestion:**
        - Utilizes the browser's Drag and Drop API, specifically `DataTransferItemList` and `webkitGetAsEntry`, to recursively read entire directory structures dropped by the user.
        - Provides a standard `<input type="file">` as a fallback for clicking to select a directory.
        - Uses `FileReader` to read file contents as text.
    - **File Parsing & Normalization:**
        - Extracts plain text content from various file types. The current implementation focuses on text-based files and skips binary formats.
        - Stores file data in a structured format: `AppFile { path, name, content }`.
    - **In-Memory Storage (The "Database"):**
        - A simple `AppFile[]` array held in React state serves as the primary data store for all document content.
        - A derived `FileTree` object is computed from this array to enable the hierarchical tree view.
    - **Indexing for Retrieval:**
        - In the current implementation, the "retrieval" step is simplified for performance and to avoid client-side embedding model dependencies.
        - The entire content of all loaded files is concatenated into a single large string, which is then passed as context to the Gemini API. This approach works well for small-to-medium sized projects.
        - *Future Enhancement:* For larger projects, this layer could be enhanced with a client-side search library (e.g., `FlexSearch` or `MiniSearch`) to create an inverted index for fast keyword-based chunk retrieval, or a WASM-based vector library for semantic search.

### 2.3. AI & Generation Layer

- **Technology:** `@google/genai` SDK for the Gemini API.
- **Responsibilities:**
    - **Prompt Engineering:**
        - Dynamically constructs a detailed prompt for the Gemini model.
        - The prompt includes a system instruction (defining the AI's persona and rules), the retrieved context (the concatenated file contents), and the user's question.
        - The system instruction explicitly commands the model to answer *only* from the provided context and to cite sources using the `[Source: path/to/file]` format.
    - **API Communication:**
        - Manages the asynchronous call to `ai.models.generateContent`.
        - Handles API responses, including successful text generation and potential errors.
    - **Response Processing:**
        - The raw text response from Gemini is processed to render Markdown and convert `[Source: ...]` citations into clickable HTML buttons.
