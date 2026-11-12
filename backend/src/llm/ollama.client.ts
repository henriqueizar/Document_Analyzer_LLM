import { ServiceUnavailableException } from '@nestjs/common';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature: number;
  /** Maximum tokens the model may generate. */
  maxTokens: number;
}

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  /** Context window in tokens (prompt + answer). */
  numCtx: number;
  timeoutMs: number;
}

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_LLM_MODEL = 'qwen3:8b';
export const DEFAULT_NUM_CTX = 8192;
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function ollamaConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OllamaConfig {
  // LLM_BASE_URL (previous name, OpenAI-compatible ".../v1") is still accepted.
  const raw = env.OLLAMA_URL || env.LLM_BASE_URL || DEFAULT_OLLAMA_URL;
  return {
    baseUrl: raw.replace(/\/+$/, '').replace(/\/v1$/, ''),
    model: env.LLM_MODEL || DEFAULT_LLM_MODEL,
    numCtx: Number(env.LLM_NUM_CTX) || DEFAULT_NUM_CTX,
    timeoutMs: Number(env.LLM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  };
}

/** Reasoning models (qwen3, deepseek-r1) may still emit <think> blocks. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Minimal client for Ollama's native chat API.
 *
 * The native API is used instead of the OpenAI-compatible /v1 endpoint because
 * only the native API accepts `options.num_ctx`. Through /v1 the context stays
 * at Ollama's default (4k tokens on machines with < 24 GB of VRAM), so long
 * documents were silently truncated before the model ever saw them.
 */
export class OllamaClient {
  constructor(readonly config: OllamaConfig) {}

  /**
   * Whether Ollama answers and has the configured model (for the admin's
   * health view). Local request with a short timeout; never throws.
   */
  async status(): Promise<{ reachable: boolean; modelInstalled: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.config.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { reachable: false, modelInstalled: false, error: `HTTP ${res.status}` };
      const { models = [] } = (await res.json()) as { models?: { name: string }[] };
      const wanted = this.config.model.includes(':') ? this.config.model : `${this.config.model}:latest`;
      return { reachable: true, modelInstalled: models.some((m) => m.name === wanted) };
    } catch (error) {
      return { reachable: false, modelInstalled: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const body = {
      model: this.config.model,
      messages,
      stream: false,
      // Disable the "thinking" phase of reasoning models: slower, and its text
      // must never reach the user.
      think: false,
      options: {
        num_ctx: this.config.numCtx,
        temperature: options.temperature,
        num_predict: options.maxTokens,
      },
    };

    let res = await this.post(body);
    if (res.status === 400) {
      // Older Ollama versions / non-reasoning models may reject `think`.
      const text = await res.text();
      if (/think/i.test(text)) {
        const { think: _think, ...withoutThink } = body;
        res = await this.post(withoutThink);
      } else {
        throw this.error(`Ollama rejected the request: ${text}`);
      }
    }
    if (res.status === 404) {
      throw this.error(
        `Model "${this.config.model}" is not installed in Ollama. Run: ollama pull ${this.config.model}`,
      );
    }
    if (!res.ok) {
      throw this.error(`Ollama error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as { message?: { content?: string } };
    return stripThinking(data.message?.content ?? '');
  }

  private async post(body: object): Promise<Response> {
    try {
      return await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError'
          ? `did not answer within ${Math.round(this.config.timeoutMs / 1000)} s`
          : `is not reachable at ${this.config.baseUrl} (is it running?)`;
      throw this.error(`Ollama ${reason}`);
    }
  }

  private error(message: string) {
    return new ServiceUnavailableException(`LLM unavailable: ${message}`);
  }
}
