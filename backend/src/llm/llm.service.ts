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
          content: 'You are an assistant that explains documents objectively, maximum 3 sentences, to optimize your response speed.',
        },
        {
          role: 'user',
          content: `
Explain the following document in a clear and structured way, maximum 3 sentences. Focus on the main points and avoid unnecessary details. Remember to replicate the document language in your answer.:

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

Answer clearly and objectively, in the language of the question. Maximum 50 words. If the question cannot be answered based on the document, say that the document does not provide enough information to answer the question. 
`,
          },
        ],
        temperature: 0.5 
      });

      // O SDK da OpenAI vai processar a resposta do Puter como se fosse dele
      return response.choices[0].message.content ?? 'The model returned an empty response.';

    } catch (error: any) {
      return `Error processing the question: ${error.message}`;
      
    }
  }
}