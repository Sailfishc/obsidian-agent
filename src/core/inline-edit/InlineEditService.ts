/**
 * InlineEditService — Handles inline edit AI queries with read-only vault tools.
 *
 * Uses the same pi-mono Agent pattern as AgentService, but with:
 * - Read-only tools only (no bash/edit/write)
 * - Dedicated inline edit system prompt
 * - Response parsing for <replacement>/<insertion> tags
 */

import { Agent, type AgentEvent } from '@mariozechner/pi-agent-core';
import {
  type KnownProvider,
  type Model,
  getModels,
} from '@mariozechner/pi-ai';
import { convertToLlm } from '@mariozechner/pi-coding-agent';
import type { ObsidianAgentSettings, StreamChunk } from '../types';
import { buildInlineEditSystemPrompt } from '../prompts/inlineEditPrompt';
import { createReadOnlyVaultTools } from '../tools/vaultTools';

export interface InlineEditResult {
  kind: 'replacement' | 'insertion' | 'clarification' | 'answer' | 'error';
  text?: string;
  rawText?: string;
}

/**
 * Parses the raw text response for <replacement> or <insertion> tags.
 */
export function parseInlineEditResponse(responseText: string): InlineEditResult {
  const replacementMatch = responseText.match(/<replacement>([\s\S]*?)<\/replacement>/);
  if (replacementMatch) {
    return { kind: 'replacement', text: replacementMatch[1], rawText: responseText };
  }

  const insertionMatch = responseText.match(/<insertion>([\s\S]*?)<\/insertion>/);
  if (insertionMatch) {
    return { kind: 'insertion', text: insertionMatch[1], rawText: responseText };
  }

  const trimmed = responseText.trim();
  if (trimmed) {
    // If the response ends with '?' it's likely a clarification question;
    // otherwise treat it as an informational answer (read-only display).
    const isClarification = trimmed.endsWith('?');
    return {
      kind: isClarification ? 'clarification' : 'answer',
      text: trimmed,
      rawText: responseText,
    };
  }

  return { kind: 'error', text: 'Empty response from model', rawText: responseText };
}

export class InlineEditService {
  private agent: Agent;
  private vaultPath: string;
  private settings: ObsidianAgentSettings;

  constructor(vaultPath: string, settings: ObsidianAgentSettings) {
    this.vaultPath = vaultPath;
    this.settings = settings;

    const tools = createReadOnlyVaultTools(vaultPath);
    const systemPrompt = buildInlineEditSystemPrompt({ vaultPath });
    const model = this.resolveModel();

    const thinkingLevel = settings.general.thinkingLevel;

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        thinkingLevel: (thinkingLevel && thinkingLevel !== 'off')
          ? thinkingLevel
          : 'medium',
        tools,
      },
      convertToLlm,
      getApiKey: async (provider: string) => {
        return this.getApiKey(provider);
      },
    });
  }

  private resolveModel(): Model<any> | undefined {
    // Use override model if inline edit is configured to not use global model
    const useGlobal = this.settings.inlineEdit.useGlobalModel;
    const override = this.settings.inlineEdit.modelOverride;

    const provider = (!useGlobal && override?.provider)
      ? override.provider
      : this.settings.general.provider;
    const modelId = (!useGlobal && override?.modelId)
      ? override.modelId
      : this.settings.general.modelId;

    if (provider === 'custom-openai') {
      const cfg = this.settings.customOpenAI;
      if (!cfg.baseUrl?.trim() || !cfg.modelId?.trim()) return undefined;
      return {
        id: cfg.modelId.trim(),
        name: cfg.modelId.trim(),
        api: 'openai-completions' as const,
        provider: 'openai',
        baseUrl: cfg.baseUrl.trim(),
        reasoning: false,
        input: ['text'] as ('text' | 'image')[],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      };
    }

    if (!provider || !modelId) return undefined;

    try {
      const allModels = getModels(provider as KnownProvider);
      const found = allModels.find((m) => m.id === modelId);
      if (found) return found;
      return allModels.length > 0 ? allModels[0] : undefined;
    } catch {
      return undefined;
    }
  }

  /** Compute the effective provider for inline edit (respecting model override). */
  private getEffectiveProvider(): string {
    const useGlobal = this.settings.inlineEdit.useGlobalModel;
    const override = this.settings.inlineEdit.modelOverride;
    return (!useGlobal && override?.provider) ? override.provider : this.settings.general.provider;
  }

  private getApiKey(provider: string): string | undefined {
    if (this.getEffectiveProvider() === 'custom-openai') {
      return this.settings.customOpenAI.apiKey?.trim() || undefined;
    }

    if (this.settings.apiKeys[provider]) {
      return this.settings.apiKeys[provider];
    }

    const envKeyMap: Record<string, string[]> = {
      anthropic: ['ANTHROPIC_API_KEY'],
      openai: ['OPENAI_API_KEY'],
      google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
      xai: ['XAI_API_KEY'],
      groq: ['GROQ_API_KEY'],
      openrouter: ['OPENROUTER_API_KEY'],
      mistral: ['MISTRAL_API_KEY'],
      zai: ['ZAI_API_KEY'],
    };

    const envVars = envKeyMap[provider] || [`${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`];
    for (const envVar of envVars) {
      const val = process.env[envVar];
      if (val) return val;
    }

    return undefined;
  }

  /**
   * Streams an inline edit query, yielding StreamChunks.
   * Uses the same subscription -> queue -> AsyncGenerator pattern as AgentService.
   */
  async *streamEdit(prompt: string): AsyncGenerator<StreamChunk> {
    const model = this.resolveModel();
    if (!model) {
      yield { type: 'error', content: 'No model configured. Please set a provider and model in settings.' };
      return;
    }

    const isCustomEndpoint = this.getEffectiveProvider() === 'custom-openai';
    const apiKey = this.getApiKey(model.provider);
    if (!apiKey && !isCustomEndpoint) {
      yield { type: 'error', content: `No API key found for provider "${model.provider}". Set it in plugin settings or environment variables.` };
      return;
    }

    this.agent.setModel(model);

    const chunkQueue: StreamChunk[] = [];
    let resolveChunk: ((chunk: StreamChunk | null) => void) | null = null;
    let done = false;

    const pushChunk = (chunk: StreamChunk) => {
      if (resolveChunk) {
        const r = resolveChunk;
        resolveChunk = null;
        r(chunk);
      } else {
        chunkQueue.push(chunk);
      }
    };

    const unsubscribe = this.agent.subscribe((event: AgentEvent) => {
      switch (event.type) {
        case 'message_update': {
          const msg = event.message;
          if (!msg || msg.role !== 'assistant') break;

          const assistantEvent = event.assistantMessageEvent;
          if (!assistantEvent) break;

          switch (assistantEvent.type) {
            case 'text_delta':
              pushChunk({ type: 'text', content: assistantEvent.delta });
              break;
            case 'thinking_delta':
              pushChunk({ type: 'thinking', content: assistantEvent.delta });
              break;
          }
          break;
        }

        case 'agent_end': {
          done = true;
          pushChunk({ type: 'done' });
          break;
        }
      }
    });

    const promptPromise = this.agent.prompt(prompt).catch((err: Error) => {
      pushChunk({ type: 'error', content: err.message || 'Unknown error' });
      done = true;
    });

    try {
      while (!done) {
        if (chunkQueue.length > 0) {
          const chunk = chunkQueue.shift()!;
          yield chunk;
          if (chunk.type === 'done' || chunk.type === 'error') break;
        } else {
          const chunk = await new Promise<StreamChunk | null>((resolve) => {
            resolveChunk = resolve;
            setTimeout(() => {
              if (resolveChunk === resolve) {
                resolveChunk = null;
                resolve(null);
              }
            }, 120000); // 2 min timeout for inline edit
          });
          if (chunk) {
            yield chunk;
            if (chunk.type === 'done' || chunk.type === 'error') break;
          }
          if (done && chunkQueue.length === 0) break;
        }
      }

      while (chunkQueue.length > 0) {
        yield chunkQueue.shift()!;
      }
    } finally {
      unsubscribe();
      await promptPromise;
    }
  }

  cancel(): void {
    this.agent.abort();
  }

  resetSession(): void {
    this.agent.reset();
  }
}
