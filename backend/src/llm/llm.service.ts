import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

/** OpenAI-compatible endpoint. Default: Ollama running natively on the host. */
export const DEFAULT_LLM_BASE_URL = 'http://localhost:11434/v1';
export const DEFAULT_LLM_MODEL = 'gemma:2b';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: OpenAI;
  readonly model: string;

  constructor() {
    const baseURL = process.env.LLM_BASE_URL || DEFAULT_LLM_BASE_URL;
    this.model = process.env.LLM_MODEL || DEFAULT_LLM_MODEL;
    this.client = new OpenAI({
      // Ollama ignores the key, but the SDK requires a value.
      apiKey: process.env.LLM_API_KEY || 'ollama',
      baseURL,
    });
    this.logger.log(`Using LLM "${this.model}" at ${baseURL}`);
  }

  // automatic initial explanation
  async explainDocument(extractedText: string): Promise<string> {
    try{
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'You are an assistant that explains documents objectively, maximum of 3 paragraphs. Use the language of the document in your explanation.',
        },
        {
          role: 'user',
          content: `
Explain the following document in a clear and structured way, concisely, with maximum of 3 paragraphs. Focus on the main points and avoid unnecessary details:

---
${extractedText}
---
`,
        },
      ],
      temperature: 0.0
    });

    return response.choices[0].message.content ?? '';
  }
 catch (error: any) {
    if (error.status === 429){ 
    return 'Error: LLM Quota exceeded';
    } else if (error.status === 401){
      return 'Error: Invalid API Key';
    }
    throw error;
  }
}
  // user questions, kept separate from the explanation
  async askQuestion(
    extractedText: string,
    question: string,
  ): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        
        model: this.model, 
        messages: [
          {
            role: 'system',
            content: 'You are an assistant that answers questions based on documents.',
          },
          {
            role: 'user',
            content: `
Document text:
---
${extractedText}
---

Question:
"${question}"

Answer clearly and objectively. USE THE LANGUAGE OF THE QUESTION. Maximum 50 words. If the question cannot be answered based on the document, say that the document does not provide enough information to answer the question. 
`,
          },
        ],
        temperature: 0.1 
      });

      return response.choices[0].message.content ?? 'The model returned an empty response.';

    } catch (error: any) {
      return `Error processing the question: ${error.message}`;
      
    }
  }
}