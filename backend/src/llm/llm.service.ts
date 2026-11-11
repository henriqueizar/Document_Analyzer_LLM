import { Injectable, Logger } from '@nestjs/common';
import { stripPreamble } from './clean-response';
import { ChatMessage, ChatOptions, OllamaClient, ollamaConfigFromEnv } from './ollama.client';

export { DEFAULT_LLM_MODEL } from './ollama.client';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: OllamaClient;
  readonly model: string;

  constructor() {
    const config = ollamaConfigFromEnv();
    this.client = new OllamaClient(config);
    this.model = config.model;
    this.logger.log(
      `Using LLM "${config.model}" at ${config.baseUrl} (context ${config.numCtx} tokens)`,
    );
  }

  private complete(messages: ChatMessage[], options: ChatOptions) {
    return this.client.chat(messages, options);
  }

  // automatic initial explanation
  async explainDocument(extractedText: string): Promise<string> {
    const answer = await this.complete(
      [
        {
          role: 'system',
          content:
            'You explain documents objectively in at most 3 paragraphs, in the language of the document. ' +
            'Start directly with the content. Never begin with an introduction, a heading, or phrases like "Sure" or "Here is".',
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
      { temperature: 0, maxTokens: 700 },
    );
    return stripPreamble(answer);
  }

  // user questions, kept separate from the explanation
  async askQuestion(
    extractedText: string,
    question: string,
  ): Promise<string> {
    const answer = await this.complete(
      [
        {
          role: 'system',
          content:
            'You answer questions based on documents. Answer directly, without an introduction or phrases like "Sure".',
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
      { temperature: 0.1, maxTokens: 400 },
    );
    return stripPreamble(answer || 'The model returned an empty response.');
  }
}
