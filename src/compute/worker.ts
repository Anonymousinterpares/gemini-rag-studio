import { franc } from 'franc-min';
import { generateContent } from '../api/llm-provider';
import { SearchResult } from '../types';
import {
  CoordinatorToWorkerMessage,
  TaskType,
  TaskResult,
  ComputeTask,
  ParagraphLayout,
  Line,
} from './types';

// --- Canvas and Caching ---
const canvas = new OffscreenCanvas(1, 1);
const context = canvas.getContext('2d')!;
const localWordWidthCache = new Map<string, number>();

function getWordWidth(word: string): number {
  let width = localWordWidthCache.get(word);
  if (width === undefined) {
    width = context.measureText(word).width;
    localWordWidthCache.set(word, width);
  }
  return width;
}

// --- Word Wrapping Algorithm ---
function wrapParagraph(paragraphText: string, paragraphStartIndex: number, containerWidth: number): ParagraphLayout {
    const words = paragraphText.split(' ');
    const lines: Line[] = [];
    let currentLineText = '';
    let lineStartIndex = paragraphStartIndex;

    if (containerWidth <= 0) {
        return {
        startIndex: paragraphStartIndex,
        lines: [{ text: paragraphText, startIndex: paragraphStartIndex }],
        };
    }
    
    if (words.length === 0 || (words.length === 1 && words[0] === '')) {
        return { startIndex: paragraphStartIndex, lines: [{ text: '', startIndex: paragraphStartIndex }] };
    }

    currentLineText = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const testLine = currentLineText + ' ' + word;
        const testWidth = getWordWidth(testLine);

        if (testWidth <= containerWidth) {
        currentLineText = testLine;
        } else {
        lines.push({ text: currentLineText, startIndex: lineStartIndex });
        lineStartIndex += currentLineText.length + 1; // +1 for the space
        currentLineText = word;
        }
    }

    lines.push({ text: currentLineText, startIndex: lineStartIndex });

    return { startIndex: paragraphStartIndex, lines };
}

let isLoggingEnabled = true; // Default to true
if (isLoggingEnabled) console.log('[GP Worker] Script loaded.');

const workerId = self.name || `gp-worker-${Math.random().toString(36).substring(2, 9)}`;

self.onmessage = (event: MessageEvent<CoordinatorToWorkerMessage>) => {
  const { type } = event.data;

  switch (type) {
    case 'set_logging':
      isLoggingEnabled = event.data.enabled;
      if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Logging is now ${isLoggingEnabled ? 'ON' : 'OFF'}`);
      break;
    case 'start_task': {
      const { task } = event.data;
      if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Received task:`, task.payload);
      executeTask(task);
      break;
    }
  }
};

async function executeTask(task: ComputeTask) {
  const { id: taskId, jobId, payload: taskPayload } = task;
  const taskTypeString = TaskType[taskPayload.type]; // Get type name before switch

  try {
    let result: TaskResult;

    switch (taskPayload.type) {
      case TaskType.CalculateLayout: {
        if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Starting layout calculation for: ${taskPayload.docId}`);
        const { docContent, containerWidth, fontSize, fontFamily } = taskPayload;
        
        context.font = `${fontSize}em ${fontFamily}`;
        localWordWidthCache.clear();

        const paragraphs = docContent.split('\n');
        const layout: ParagraphLayout[] = [];
        let currentParagraphStartIndex = 0;

        for (const pText of paragraphs) {
            const paragraphLayout = wrapParagraph(pText, currentParagraphStartIndex, containerWidth);
            layout.push(paragraphLayout);
            currentParagraphStartIndex += pText.length + 1; // +1 for newline
        }
        
        result = {
          docId: taskPayload.docId,
          layout,
        };
        if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Finished layout calculation for: ${taskPayload.docId}`);
        break;
      }
      case TaskType.GenerateSummaryQuery: {
        if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Starting summary query generation for: ${taskId}`);
        const { docId, firstTwoChunks, model, apiKey } = taskPayload;

        const llmResponse = await generateContent(model, apiKey, [
            {
                role: 'system',
                content: 'You are an expert query generation assistant. Based on the following initial text from a document, generate a single, concise question that would best elicit a high-level summary of the entire document.'
            },
            {
                role: 'user',
                content: `DOCUMENT START:\n\n${firstTwoChunks}`
            }
        ]);

        result = {
            docId,
            query: llmResponse.text,
            model,
            apiKey,
        };
        if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Finished summary query generation for: ${taskId}`);
        break;
      }
      case TaskType.ExecuteRAGForSummary: {
        if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Starting RAG for summary for: ${taskId}`);
        const { docId, query, model, apiKey } = taskPayload;

        // This worker can't embed, so we ask the coordinator to do it.
        // This is a temporary solution until we have a proper service architecture.
        const searchResultPromise = new Promise<SearchResult[]>((resolve) => {
            const listener = (event: MessageEvent) => {
                if (event.data.type === 'search_result') {
                    self.removeEventListener('message', listener);
                    resolve(event.data.results);
                }
            };
            self.addEventListener('message', listener);
        });

        self.postMessage({
            type: 'embed_and_search',
            query: query,
            topK: 5,
            docId,
        });

        const searchResults = await searchResultPromise;
        if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Received ${searchResults.length} search results from coordinator for ${docId}.`, { searchResults });

        result = {
            docId,
            searchResults,
            model,
            apiKey,
        };

        if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Finished RAG for summary for: ${taskId}`);
        break;
      }
      case TaskType.Summarize: {
        if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Starting summarization for: ${taskId}`);
        const { docId, searchResults, model, apiKey } = taskPayload;
        
        const context = searchResults.map((r) => r.chunk).join('\n\n---\n\n');
        if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Constructed summary context for ${docId}. Context length: ${context.length}.`, { context });

        const llmResponse = await generateContent(model, apiKey, [
          {
            role: 'system',
            content: 'You are expert summarization assistant. Based on following context retrieved from a document, generate concise, high-level summary. The summary should capture main topics and key points, suitable for providing context to LLM. You MUST start the summary with educated guess on the nature of the document (novel, journal article, science article/document, code file of ... type and so on ). Dont exceed 200 words.'
          },
          {
            role: 'user',
            content: `CONTEXT:\n\n${context}`
          }
        ]);

        result = {
          docId,
          summary: llmResponse.text,
          tokenUsage: llmResponse.usage,
        };
        if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Finished summarization for: ${taskId}`);
        break;
      }
      case TaskType.DetectLanguage: {
        if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Starting language detection for: ${taskPayload.docId}`);
        const { docId, content, model, apiKey } = taskPayload;
        let languageCode = franc(content);

        if (languageCode === 'und') {
            if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] franc could not determine the language. Falling back to LLM.`);
            const llmResponse = await generateContent(model, apiKey, [
                {
                    role: 'system',
                    content: 'You are a language detection expert. Identify the language of the following text and respond with only the three-letter ISO 639-3 code.'
                },
                {
                    role: 'user',
                    content: `TEXT: "${content.slice(0, 500)}"`
                }
            ]);
            languageCode = llmResponse.text.trim().toLowerCase();
            if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] LLM detected language: ${languageCode}`);
        }
        
        result = {
            docId,
            language: languageCode,
        };
        if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Finished language detection for: ${taskPayload.docId}. Detected: ${languageCode}`, { result });
        break;
      }
      default: {
        // This worker should not receive other task types
        throw new Error(`[GP Worker] Received unsupported task type: ${taskTypeString}`);
      }
    }

    self.postMessage({
      type: 'task_complete',
      taskId,
      jobId,
      taskType: taskPayload.type,
      result,
    });

  } catch (error) {
    console.error(`[GP Worker ${workerId}] Error executing task ${taskId}:`, error);
    self.postMessage({
      type: 'task_error',
      taskId,
      jobId,
      error: error instanceof Error ? error.message : 'An unknown error occurred',
    });
  }
}

// Notify the coordinator that the worker is initialized and ready for tasks.
self.postMessage({ type: 'worker_ready', workerId });
if (isLoggingEnabled) console.log(`[GP Worker ${workerId}] Initialized and ready.`);