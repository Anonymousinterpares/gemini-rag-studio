import { GoogleGenerativeAI, ChatSession, Content } from '@google/generative-ai'
import { ChatMessage, Model } from '../types';

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LlmResponse {
  text: string | null;
  toolCalls?: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

function sanitizeHistory(messages: ChatMessage[]): {
    systemPrompt: string | undefined;
    history: ChatMessage[];
} {
    // console.log('[DEBUG] History before sanitization:', JSON.stringify(messages, null, 2));
    let systemPrompt: string | undefined = undefined;
    const sanitized: ChatMessage[] = [];

    // 1. Find and remove the system prompt
    const systemMsgIndex = messages.findIndex(m => m.role === 'system');
    if (systemMsgIndex !== -1) {
        systemPrompt = messages.splice(systemMsgIndex, 1)[0].content;
    }

    // 2. Find the first user message. Discard anything before it, UNLESS it's a sequence of tool interactions 
    // that might be relevant? actually usually a conversation starts with User.
    const firstUserIndex = messages.findIndex(m => m.role === 'user');
    if (firstUserIndex === -1) {
        // If no user messages, check if we have a valid tool sequence (rare for start). 
        // For safety, return empty if no user interaction found at all.
        // console.log('[DEBUG] History after sanitization (no user messages):', JSON.stringify([], null, 2));
        return { systemPrompt, history: [] };
    }
    messages = messages.slice(firstUserIndex);

    // 3. Process messages
    if (messages.length > 0) {
        sanitized.push({ ...messages[0] }); // Start with the first user message

        for (let i = 1; i < messages.length; i++) {
            const currentMessage = messages[i];
            const lastMessageInSanitized = sanitized[sanitized.length - 1];

            // Don't merge if either message involves tools
            const isToolRelated = (m: ChatMessage) => m.role === 'tool' || (m.role === 'model' && m.tool_calls);

            if (currentMessage.role !== lastMessageInSanitized.role || isToolRelated(currentMessage) || isToolRelated(lastMessageInSanitized)) {
                sanitized.push({ ...currentMessage });
            } else {
                // Merge content if roles are the same and NOT tool related
                // (e.g. two user messages in a row -> merge them)
                // Note: ChatMessage content can be null for tool calls, so handle that
                const lastContent = lastMessageInSanitized.content || '';
                const currentContent = currentMessage.content || '';
                lastMessageInSanitized.content = lastContent + `\n${currentContent}`;
            }
        }
    }
    
    // 4. Ensure the conversation ends with a User message OR a Tool message (if the model requested it)
    // Actually, for "generateContent", we usually expect the last message to be User or Tool Output.
    // If the last message is Model (without tool calls), then there's nothing to generate?
    // But in a chat loop, we might append a user message and ask for generation.
    // Let's just ensure we don't have trailing Model messages unless they are tool calls waiting for execution?
    // No, generateContent is called TO GET a model response. So the last message should be User or Tool.
    
    // For now, relax the "last must be user" check to allow "last must be user OR tool"
    while(sanitized.length > 0) {
        const last = sanitized[sanitized.length - 1];
        if (last.role === 'user' || last.role === 'tool') break;
        sanitized.pop();
    }

    // console.log('[DEBUG] History after sanitization:', JSON.stringify(sanitized, null, 2));
    return { systemPrompt, history: sanitized };
}

export async function generateContent(
  model: Model,
  apiKeyFromUI: string | undefined,
  messages: ChatMessage[],
  tools?: Tool[],
  signal?: AbortSignal
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
  
  const { history: fullHistory, systemPrompt } = sanitizeHistory([...messages]);
  
  // The last message is the prompt trigger.
  // We must pop it because providers expect (history + new_message) structure.
  const lastMessage = fullHistory.pop(); 

  if (!lastMessage) {
      throw new Error("Invalid chat history: No messages to process.");
  }

  // Use 'fullHistory' as the history (now without the last message)
  const history = fullHistory;

  switch (model.provider) {
    case 'google': {
        if (!apiKey) throw new Error('Google API key not provided.');
        
        // Map our Tool format to Gemini's functionDeclarations
        const geminiTools = tools && tools.length > 0 ? [{
            functionDeclarations: tools.map(t => ({
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters
            }))
        }] : undefined;

        const ai = new GoogleGenerativeAI(apiKey);
        const gemini = ai.getGenerativeModel({
            model: model.id,
            ...(systemPrompt && { systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] } }),
            tools: geminiTools as any
        }, { requestOptions: { signal } as any });
        
        const googleHistory: Content[] = history.map(m => {
            if (m.role === 'tool') {
                return {
                    role: 'function' as const,
                    parts: [{ 
                        functionResponse: { 
                            name: m.name || '', 
                            response: { content: m.content } 
                        } 
                    }],
                };
            }
            
            const parts: any[] = [];
            if (m.content) parts.push({ text: m.content });
            if (m.tool_calls) {
                m.tool_calls.forEach(tc => {
                    parts.push({ 
                        functionCall: { 
                            name: tc.function.name, 
                            args: JSON.parse(tc.function.arguments) 
                        } 
                    });
                });
            }

            return {
                role: m.role === 'model' ? 'model' as const : 'user' as const,
                parts
            };
        });

        const chat: ChatSession = gemini.startChat({ history: googleHistory });
        
        console.log('[DEBUG] Sending to Google API:', { history: googleHistory, lastMessage: lastMessage.content });
        const result = await chat.sendMessage(lastMessage.content || '');
        const response = result.response;
        const candidate = response.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        
        const textPart = parts.find(p => p.text);
        const callParts = parts.filter(p => p.functionCall);

        const toolCalls: ToolCall[] = callParts.map((p, i) => ({
            id: `call_${Date.now()}_${i}`,
            type: 'function',
            function: {
                name: p.functionCall!.name,
                arguments: JSON.stringify(p.functionCall!.args)
            }
        }));

        // For Google, we need to manually count the tokens
        const promptTokens = await gemini.countTokens(lastMessage.content || '');
        const completionTokens = await gemini.countTokens(textPart?.text || 'tool_call');

        return {
            text: textPart?.text || null,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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
      
      const body: any = {
        model: model.id,
        messages: finalMessages,
      };
      if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }

      console.log('[DEBUG] Sending to OpenAI API:', { messages: finalMessages, tools });
      const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal
      });

      if (!openAiResponse.ok) {
        const error = await openAiResponse.json();
        throw new Error(`OpenAI API Error: ${error.error.message}`);
      }
      const openAiData = await openAiResponse.json();
      console.log('[DEBUG] OpenAI API Response Body:', JSON.stringify(openAiData, null, 2));
      return {
        text: openAiData.choices[0].message.content,
        toolCalls: openAiData.choices[0].message.tool_calls,
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

       const body: any = {
          model: model.id,
          messages: finalMessages,
        };
       if (tools && tools.length > 0) {
          body.tools = tools;
          body.tool_choice = 'auto';
       }

       console.log('[DEBUG] Sending to OpenRouter API:', { messages: finalMessages, tools });
       const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'Gemini RAG Studio',
        },
        body: JSON.stringify(body),
        signal
      });

      if (!openRouterResponse.ok) {
        const error = await openRouterResponse.json();
        throw new Error(`OpenRouter API Error: ${error.error.message}`);
      }
      const openRouterData = await openRouterResponse.json();
      console.log('[DEBUG] OpenRouter API Response Body:', JSON.stringify(openRouterData, null, 2));
      return {
        text: openRouterData.choices[0].message.content,
        toolCalls: openRouterData.choices[0].message.tool_calls,
        usage: {
          promptTokens: openRouterData.usage?.prompt_tokens || 0,
          completionTokens: openRouterData.usage?.completion_tokens || 0,
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
        signal
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