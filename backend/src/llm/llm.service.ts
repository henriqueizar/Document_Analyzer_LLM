import { Injectable } from "@nestjs/common";
import OpenAI from 'openai';
import { puter } from '@heyputer/puter.js'; 

@Injectable()
export class LlmService {
  private client: OpenAI;

  constructor() {
    console.log('usando Ollama Local (gemma:2b)');
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
      model: 'gemma:2b',
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
  //perguntas do usuario, separando a explicaçao da pergunta
  async askQuestion(
    extractedText: string,
    question: string,
  ): Promise<string> {
    if (!this.client) return 'AI not initialized';
    
    try {
      const response = await this.client.chat.completions.create({
        
        model: 'gemma:2b', 
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

      // O SDK da OpenAI vai processar a resposta do Puter como se fosse dele
      return response.choices[0].message.content ?? 'The model returned an empty response.';

    } catch (error: any) {
      return `Error processing the question: ${error.message}`;
      
    }
  }
}