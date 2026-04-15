import { Injectable } from "@nestjs/common";
import OpenAI from 'openai';
import { puter } from '@heyputer/puter.js'; 

@Injectable()
export class LlmService {
  private client: OpenAI;

  constructor() {
    console.log('sando Ollama Local (gemma:2b)');
      this.client = new OpenAI({
        apiKey: 'ollama', // Ollama nao pede chave, mas o SDK exige um valor
        baseURL: 'http://localhost:11434/v1', //URL padrao Ollama
      });
    }
  

  //explicação automática inicial
  async explainDocument(extractedText: string): Promise<string> {
    if (!this.client) {
      return 'Simulated explanation of the document content:\n ' + extractedText;
    }
    try{
    const response = await this.client.chat.completions.create({
      model: 'qwen2:0.5b',
      messages: [
        {
          role: 'system',
          content: 'You are an assistant that explains documents objectively.',
        },
        {
          role: 'user',
          content: `
Explain the following document in a clear and structured way:

---
${extractedText}
---
`,
        },
      ],
      temperature: 0.7
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
  //perguntas do usuario, separando a explicaçao da pergunta
  async askQuestion(
    extractedText: string,
    question: string,
  ): Promise<string> {
    if (!this.client) return 'AI not initialized';
    
    try {
      const response = await this.client.chat.completions.create({
        
        model: 'qwen2:0.5b', 
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

Answer clearly and objectively.
`,
          },
        ],
        temperature: 0.7
      });

      // O SDK da OpenAI vai processar a resposta do Puter como se fosse dele
      return response.choices[0].message.content ?? 'The model returned an empty response.';

    } catch (error: any) {
      return `Error processing the question: ${error.message}`;
      
    }
  }
}