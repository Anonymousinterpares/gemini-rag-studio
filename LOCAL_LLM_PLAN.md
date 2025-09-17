# Local LLM Integration Plan

## Executive Summary

This document outlines a plan to integrate local Large Language Model (LLM) support into the application, allowing for offline functionality. The proposed solution is to leverage **Ollama** as the local LLM server due to its ease of use and OpenAI-compatible API. The integration will involve adding a new "Local LLM" provider in the application's frontend. Users will be required to install and run Ollama and their desired models manually. Automating the Ollama server management from the web application is not feasible without a dedicated backend, which is outside the scope of the current architecture.

## Chosen Technology: Ollama

**Recommendation:** Ollama is the recommended local LLM server.

**Justification:**

*   **Ease of Use:** Ollama simplifies the process of downloading, setting up, and running various open-source LLMs with a single command.
*   **OpenAI API Compatibility:** Ollama exposes a local server at `http://localhost:11434` that is compatible with the OpenAI Chat Completions API. This allows for seamless integration with the existing `llm-provider.ts` structure by adding a new case that mirrors the `openai` or `openrouter` implementation.
*   **Cross-Platform:** Ollama is available on macOS, Windows, and Linux.
*   **Active Community:** Ollama has a large and active community, with a wide range of models available.

Other alternatives like LM Studio exist, but Ollama's command-line interface and API-first approach make it a better fit for this integration.

## User Setup Guide

To use the local LLM feature, users will need to perform a one-time setup:

1.  **Install Ollama:** Download and install Ollama from the official website: [https://ollama.com/](https://ollama.com/)
2.  **Download a Model:** Open a terminal or command prompt and pull a model. For example, to download Llama 3:
    ```bash
    ollama run llama3
    ```
    This command will download the model and start the Ollama server. The server will continue running in the background.
3.  **Select Local LLM in the App:** Once the integration is complete, users will be able to select "Local LLM" from the provider list in the application and choose a model they have downloaded.

## Implementation Steps

The engineering team will need to implement the following changes in the frontend codebase:

1.  **Update `llm-provider.ts`:**
    *   Add a new `case` to the `switch` statement in the `generateContent` function in [`src/api/llm-provider.ts`](src/api/llm-provider.ts:20).
    *   This new case, let's call it `ollama`, will handle requests for the local provider.
    *   The implementation will be very similar to the existing `openrouter` case, making a `fetch` request to `http://localhost:11434/v1/chat/completions`.
    *   The `apiKey` will not be required for this provider, so the `apiKeyRequired` property for local models should be `false`.

    **Code Snippet Example for [`src/api/llm-provider.ts`](src/api/llm-provider.ts):**

    ```typescript
    // ... inside generateContent function
    switch (model.provider) {
      // ... existing cases
      case 'ollama': {
        const ollamaResponse = await fetch('http://localhost:11434/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: model.id, // e.g., "llama3"
            messages: [{ role: 'user', content: prompt }],
            stream: false, // Or true if we want to handle streaming
          }),
        });
        if (!ollamaResponse.ok) {
          const error = await ollamaResponse.text();
          throw new Error(`Ollama API Error: ${error}`);
        }
        const ollamaData = await ollamaResponse.json();
        return ollamaData.choices[0].message.content;
      }
      default:
        throw new Error(`Unsupported provider: ${model.provider}`);
    }
    ```

2.  **Update Model Configuration:**
    *   The application needs a way to list available local models. Since we cannot dynamically query the Ollama server for a list of installed models from the frontend, we can start by adding a default local model to [`src/models.json`](src/models.json).
    *   Users could later be given an interface to add the names of the models they have downloaded locally.

    **Example addition to [`src/models.json`](src/models.json):**
    ```json
    {
      "id": "llama3",
      "name": "Llama 3 (Local)",
      "provider": "ollama",
      "apiKeyRequired": false
    }
    ```

3.  **Update UI:**
    *   The UI for selecting a model should be updated to show the new "Local LLM" provider and its associated models.
    *   When a local model is selected, the API key input field should be hidden or disabled.

## Risks and Considerations

*   **Prerequisite: Backend for Server Management:** Starting, stopping, or managing the Ollama server (e.g., pulling new models) directly from the web application is **not feasible** with the current frontend-only architecture. A backend component (e.g., using Tauri or Electron) would be required to execute shell commands. The current plan assumes the user manages the Ollama server manually. This should be clearly communicated to the user.
*   **Resource Management:** Running LLMs locally is resource-intensive (CPU, RAM, VRAM). The application should not be responsible for this; it is up to the user to ensure their machine is capable.
*   **Error Handling:** The application must gracefully handle errors when the local server is not running or not reachable at `http://localhost:11434`. The `fetch` call should be wrapped in a `try...catch` block that provides a clear error message to the user, e.g., "Could not connect to local LLM server. Please ensure Ollama is running."
*   **CORS:** The Ollama server by default allows requests from `localhost`. If the application is hosted on a different domain during development or production, CORS (Cross-Origin Resource Sharing) issues might arise. Ollama's configuration may need to be adjusted, or a proxy server might be needed. For a local-first application, this is less of a concern.
*   **Discovering Local Models:** The plan suggests manually adding model definitions. A more advanced solution would be to allow the user to specify the models they have installed. The most advanced solution (requiring a backend) would be to query the Ollama API (`/api/tags`) to get a list of installed models automatically.