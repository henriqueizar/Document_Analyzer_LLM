import { Injectable } from "@nestjs/common";
import OpenAI from 'openai';

@Injectable()
export class LlmService {
  private client?: OpenAI | null;;

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    } else {
      this.client = null;
    }
  }

  //explicação automática inicial
  async explainDocument(extractedText: string): Promise<string> {
    if (!this.client) {
      return 'Simulated explanation of the document content:\n ' + extractedText;
    }
    try{
    const response = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
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
    if (!this.client) { //se a chave OPENAI_API_KEY não estiver definida
      return `Simulated answer for the question: "${question}"`;
    }
    try{
    const response = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
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
    });

    return response.choices[0].message.content ?? '';
  }catch (error: any) {
    if (error.status === 429){ 
    return 'Error: LLM Quota exceeded';
    } else if (error.status === 401){
      return 'Error: Invalid API Key';
    }
    throw error;
  }
  }
}
