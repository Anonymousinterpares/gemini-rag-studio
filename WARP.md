# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Gemini RAG Studio is a fully client-side web application that enables Retrieval-Augmented Generation (RAG) on local documents and source code. Built with React/TypeScript and Vite, it allows users to drag and drop project folders, creates an in-browser knowledge base, and chat with Google's Gemini model about their files with source citations.

## Development Commands

### Quick Start
```bash
npm start
```
This automated startup script will:
- Install dependencies if needed
- Download required AI models if missing  
- Start the development server
- Display setup information

### Core Development Commands
```bash
# Development server
npm run dev
# or alternatively
npm start

# Build for production
npm run build

# Preview production build
npm run preview

# Lint TypeScript/TSX files
npm run lint

# Format code with Prettier
npm run format
```

### Model Setup (Required)
The application requires local embedding models for client-side processing:
```bash
# Create models directory
mkdir -p public/models

# Download required embedding model (automated by npm start)
git clone https://huggingface.co/Xenova/all-MiniLM-L6-v2 public/models/Xenova/all-MiniLM-L6-v2
```

### Environment Configuration
Create `.env.local` with your Gemini API key:
```
VITE_GEMINI_API_KEY=your_api_key_here
```

## Architecture Overview

### Core Architectural Principles
- **100% Client-Side**: All file processing, indexing, and storage occur in the browser for complete privacy
- **Component-Based UI**: React with TypeScript for modular, maintainable design  
- **State-Driven Logic**: React state management drives UI updates
- **Worker-Based Processing**: Web Workers handle heavy computation (embeddings, chunking)

### Key Directory Structure
```
src/
├── components/          # React UI components
│   ├── Monster/        # Animated UI elements (particles, bubbles)
│   └── ...
├── hooks/              # Custom React hooks for state management
├── compute/            # Web Worker coordination and ML processing
├── rag/               # RAG pipeline implementation
├── agents/            # LLM agent implementations
├── api/               # LLM provider abstractions
├── cache/             # Client-side caching systems
├── types/             # TypeScript type definitions
└── utils/             # Utility functions
```

### Critical Architecture Components

#### State Management via Custom Hooks
The application uses custom hooks for managing different aspects of state:
- `useFileState`: File management, drag/drop, embedding
- `useChat`: Chat history, LLM interactions, source citations  
- `useCompute`: Web Worker coordination, ML model management
- `useSettingsState`: App configuration and preferences

#### Web Worker Architecture
Heavy computation is offloaded to Web Workers for performance:
- `compute/coordinator.ts`: Manages worker pool and job distribution
- `compute/ml.worker.ts`: Handles ML model operations (embeddings)
- `rag/worker.ts`: Processes RAG pipeline operations

#### RAG Pipeline Implementation
- **Hierarchical Chunking**: Parent-child document splitting for better context
- **Vector Store**: Client-side embedding storage and similarity search
- **Reranking**: Post-retrieval result refinement
- **Source Citation**: Automatic source linking in responses

## Development Patterns

### Component Development
- Use functional components with TypeScript
- Implement proper memoization with `React.memo()` for performance-critical components
- Follow the established pattern of separating UI logic into custom hooks

### State Updates
- Always use the established custom hooks for state management
- Avoid direct state mutations - use the provided setter functions
- File operations should go through `useFileState` hook

### Worker Communication
- Use the coordinator pattern for Web Worker management
- All ML operations should be dispatched through the compute coordinator
- Handle worker errors gracefully with fallback mechanisms

### LLM Integration
- Use the provider abstraction in `api/llm-provider.ts`
- All LLM calls should include proper error handling and timeout logic
- Respect rate limits and implement proper retry mechanisms

## File Processing Patterns

### Supported File Types
- Text files (`.txt`, `.md`, `.json`, etc.)
- Microsoft Word documents (`.docx`) via `mammoth`
- PDF files via `pdfjs-dist`
- Source code files with syntax highlighting

### File Ingestion Flow
1. User drops files/folders or uses file picker
2. Files are processed recursively with gitignore respect
3. Content extraction based on file type
4. Hierarchical chunking and embedding generation
5. Storage in client-side vector database

## Testing and Quality

### Linting and Formatting
```bash
# Run ESLint
npm run lint

# Auto-format with Prettier  
npm run format
```

### Build Verification
```bash
# Test production build
npm run build
npm run preview
```

## Common Gotchas

### CORS and Web Workers
The application requires specific CORS headers for Web Workers and WebAssembly:
```javascript
// vite.config.ts
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
}
```

### Model Loading
- Models must be placed in `public/models/` directory
- The startup script handles this automatically
- Manual model download may be needed in some environments

### API Key Configuration
- Use `VITE_` prefix for environment variables in Vite
- API keys are client-side visible (this is intentional for the architecture)
- Consider implementing additional security measures for production use

### Windows Development
The project includes Windows-specific batch files (`start-app.bat`) for easier development on Windows environments.

## Performance Considerations

### Client-Side Limitations
- Large document sets may impact browser performance
- Memory usage scales with document count and embedding size
- Consider implementing pagination or virtualization for large file lists

### Web Worker Optimization  
- Worker count is configurable based on system capabilities
- ML operations are batched for efficiency
- Implement proper cleanup for worker resources

### Caching Strategy
- Embeddings are cached client-side via IndexedDB
- Summary cache reduces redundant LLM calls
- Cache invalidation based on content changes
