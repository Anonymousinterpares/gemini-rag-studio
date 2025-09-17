# Gemini RAG Studio

## Overview

Gemini RAG Studio is a powerful, fully client-side web application that enables Retrieval-Augmented Generation (RAG) on your local documents and source code. You can drag and drop an entire project folder, and the application will create an in-browser knowledge base. You can then chat with Google's Gemini model to ask questions about your files, with every answer citing the exact source document.

This tool is designed for developers, researchers, and anyone who needs to quickly understand and query a corpus of text-based documents without any server-side setup or data upload to a third-party service. All processing happens securely in your browser.

## Quick Start

Get up and running with a single command:

```bash
npm start
```

This will automatically:
- Install dependencies if needed
- Download required AI models if missing
- Start the development server
- Display helpful setup information

The application will be available at `http://localhost:5173` (or another port if 5173 is busy).

**Note:** Make sure you have a Gemini API key configured in `.env.local`:
```
VITE_GEMINI_API_KEY=your_api_key_here
```

## Key Features

- **100% Client-Side:** Your files never leave your computer, ensuring complete privacy and security.
- **Drag-and-Drop Interface:** Easily add individual files or entire project folders.
- **Dual File Views:**
    - **Tree View:** Preserves and displays the original folder structure.
    - **List View:** Shows a flat, alphabetized list of all indexed files.
- **Gemini-Powered Chat:** Leverage the power of the Gemini API to ask complex questions about your documents.
- **Source-Cited Responses:** The AI is instructed to base its answers strictly on the provided files and to cite its sources with clickable links (`[Source: path/to/file]`).
- **Integrated Document Viewer:** Clicking a source link or a file in the list instantly displays its content with syntax highlighting and marks the specific text used by the AI.
- **Easy Management:** Clear the entire knowledge base with a single click to start fresh.

## Planned Enhancements

- **Snippet-Based Source Preview:** To improve usability, the source viewer will be updated to first show a list of relevant text snippets. Clicking a snippet will then navigate to its full context within the document.
- **Advanced RAG with Re-ranking:** To increase answer accuracy, the RAG pipeline will be upgraded with a re-ranking step. This will allow the system to more intelligently select the most relevant document chunks to answer a user's query, all while remaining 100% client-side.

## Local Model Setup

This application uses a local model for generating embeddings. Before running the application, you need to download the model files and place them in the `public/models` directory.

1. **Create the directory:**
   ```bash
   mkdir -p public/models
   ```

2. **Clone the model repository:**
   ```bash
   git clone https://huggingface.co/Xenova/all-MiniLM-L6-v2 public/models/Xenova/all-MiniLM-L6-v2
   ```

## Tech Stack

- **Frontend:** React with TypeScript
- **AI:** Google Gemini API (`@google/genai`)
- **UI Components:** Lucide React for icons
- **Markdown Parsing:** `marked`
- **Syntax Highlighting:** `highlight.js`
- **Build/Dependencies:** Handled via ES Module Shims and an `importmap`.
