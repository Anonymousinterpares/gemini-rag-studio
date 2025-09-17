import { GoogleGenerativeAI, ChatSession, Content } from '@google/generative-ai'
import { ChatMessage, Model } from '../types';

export interface LlmResponse {
  text: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

function sanitizeHistory(messages: ChatMessage[]): {
    systemPrompt: string | undefined;
    history: ChatMessage[];
} {
    console.log('[DEBUG] History before sanitization:', JSON.stringify(messages, null, 2));
    let systemPrompt: string | undefined = undefined;
    const sanitized: ChatMessage[] = [];

    // 1. Find and remove the system prompt
    const systemMsgIndex = messages.findIndex(m => m.role === 'system');
    if (systemMsgIndex !== -1) {
        systemPrompt = messages.splice(systemMsgIndex, 1)[0].content;
    }

    // 2. Find the first user message and discard anything before it
    const firstUserIndex = messages.findIndex(m => m.role === 'user');
    if (firstUserIndex === -1) {
        // If no user messages, the history is invalid for a chat model
        console.log('[DEBUG] History after sanitization (no user messages):', JSON.stringify([], null, 2));
        return { systemPrompt, history: [] };
    }
    messages = messages.slice(firstUserIndex);

    // 3. Ensure strict alternation of user/model roles, merging consecutive messages
    if (messages.length > 0) {
        sanitized.push({ ...messages[0] }); // Start with the first user message

        for (let i = 1; i < messages.length; i++) {
            const currentMessage = messages[i];
            const lastMessageInSanitized = sanitized[sanitized.length - 1];

            if (currentMessage.role !== lastMessageInSanitized.role) {
                sanitized.push({ ...currentMessage });
            } else {
                // Merge content if roles are the same
                lastMessageInSanitized.content += `\n${currentMessage.content}`;
            }
        }
    }
    
    // 4. The final message in the list to be processed MUST be from the user.
    // If it's not, pop until we find one. This is a safeguard.
    while(sanitized.length > 0 && sanitized[sanitized.length - 1].role !== 'user') {
        sanitized.pop();
    }

    console.log('[DEBUG] History after sanitization:', JSON.stringify(sanitized, null, 2));
    return { systemPrompt, history: sanitized };
}


export async function generateContent(
  model: Model,
  apiKeyFromUI: string | undefined,
  messages: ChatMessage[]
): Promise<LlmResponse> {
  const getApiKey = (provider: 'google' | 'openai' | 'openrouter' | 'ollama'): string | undefined => {
    switch (provider) {
        case 'google':
            return import.meta.env.VITE_GOOGLE_API_KEY || apiKeyFromUI;
        case 'openai':
            return import.meta.env.VITE_OPENAI_API_KEY || apiKeyFromUI;
        case 'openrouter':
             return import.meta.env.VITE_OPENROUTER_API_KEY || apiKeyFromUI;
        default:
            return apiKeyFromUI;
    }
  }

  const apiKey = getApiKey(model.provider as 'google' | 'openai' | 'openrouter' | 'ollama');

  if (model.apiKeyRequired && !apiKey) {
    throw new Error(`API key for ${model.provider} is required. Provide it in the settings or in your .env.local file.`);
  }
  
  const { history, systemPrompt } = sanitizeHistory([...messages]);
  const lastMessage = history.pop(); // The last message is the actual user query

  if (!lastMessage || lastMessage.role !== 'user') {
      throw new Error("Invalid chat history: The last message must be from the user.");
  }


  switch (model.provider) {
    case 'google': {
        if (!apiKey) throw new Error('Google API key not provided.');
        const ai = new GoogleGenerativeAI(apiKey);
        const gemini = ai.getGenerativeModel({
            model: model.id,
            ...(systemPrompt && { systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] } })
        });
        
        const googleHistory: Content[] = history.map(m => ({
            role: m.role,
            parts: [{ text: m.content }],
        }));

        const chat: ChatSession = gemini.startChat({ history: googleHistory });
        
        console.log('[DEBUG] Sending to Google API:', { history: googleHistory, lastMessage: lastMessage.content });
        const result = await chat.sendMessage(lastMessage.content);
        const text = result.response.text();

        // For Google, we need to manually count the tokens for prompt and completion
        const promptTokens = await gemini.countTokens(lastMessage.content);
        const completionTokens = await gemini.countTokens(text);

        console.log('[DEBUG] Google API Response Body:', JSON.stringify(result.response, null, 2));
        return {
            text,
            usage: {
                promptTokens: promptTokens.totalTokens,
                completionTokens: completionTokens.totalTokens,
            },
        };
    }
    case 'openai': {
      if (!apiKey) throw new Error('OpenAI API key not provided.');
      
      const finalMessages: ChatMessage[] = [];
      if (systemPrompt) finalMessages.push({ role: 'system', content: systemPrompt });
      finalMessages.push(...history, lastMessage);

      console.log('[DEBUG] Sending to OpenAI API:', { messages: finalMessages });
      const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model.id,
          messages: finalMessages,
        }),
      });
      if (!openAiResponse.ok) {
        const error = await openAiResponse.json();
        throw new Error(`OpenAI API Error: ${error.error.message}`);
      }
      const openAiData = await openAiResponse.json();
      console.log('[DEBUG] OpenAI API Response Body:', JSON.stringify(openAiData, null, 2));
      return {
        text: openAiData.choices[0].message.content,
        usage: {
          promptTokens: openAiData.usage.prompt_tokens,
          completionTokens: openAiData.usage.completion_tokens,
        },
      };
    }
    case 'openrouter': {
       if (!apiKey) throw new Error('OpenRouter API key not provided.');
       const finalMessages: ChatMessage[] = [];
       if (systemPrompt) finalMessages.push({ role: 'system', content: systemPrompt });
       finalMessages.push(...history, lastMessage);

       console.log('[DEBUG] Sending to OpenRouter API:', { messages: finalMessages });
       const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'Gemini RAG Studio',
        },
        body: JSON.stringify({
          model: model.id,
          messages: finalMessages,
        }),
      });
       if (!openRouterResponse.ok) {
        const error = await openRouterResponse.json();
        throw new Error(`OpenRouter API Error: ${error.error.message}`);
      }
      const openRouterData = await openRouterResponse.json();
      console.log('[DEBUG] OpenRouter API Response Body:', JSON.stringify(openRouterData, null, 2));
      return {
        text: openRouterData.choices[0].message.content,
        usage: {
          promptTokens: openRouterData.usage.prompt_tokens,
          completionTokens: openRouterData.usage.completion_tokens,
        },
      };
    }
    case 'ollama': {
      const finalMessages: ChatMessage[] = [];
      if (systemPrompt) finalMessages.push({ role: 'system', content: systemPrompt });
      finalMessages.push(...history, lastMessage);

      console.log('[DEBUG] Sending to Ollama API:', { messages: finalMessages });
      const ollamaResponse = await fetch('http://localhost:11434/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model.id,
          messages: finalMessages,
          stream: false,
        }),
      });
      if (!ollamaResponse.ok) {
        const error = await ollamaResponse.text();
        throw new Error(`Ollama API Error: ${error}`);
      }
      const ollamaData = await ollamaResponse.json();
      console.log('[DEBUG] Ollama API Response Body:', JSON.stringify(ollamaData, null, 2));
      return {
        text: ollamaData.choices[0].message.content,
        usage: {
          promptTokens: ollamaData.usage.prompt_tokens,
          completionTokens: ollamaData.usage.completion_tokens,
        },
      };
    }
    default:
      throw new Error(`Unsupported provider: ${model.provider}`);
  }
}