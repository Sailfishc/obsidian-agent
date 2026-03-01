import { Agent, type AgentEvent, type AgentMessage, type ThinkingLevel } from '@mariozechner/pi-agent-core';
import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type ImageContent,
  type KnownProvider,
  type Model,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
  getModel,
  getModels,
  getProviders,
} from '@mariozechner/pi-ai';
import { convertToLlm } from '@mariozechner/pi-coding-agent';
import type { CustomOpenAISettings, ObsidianAgentSettings, StreamChunk } from '../types';
import { buildVaultSystemPrompt } from '../prompts/systemPrompt';
import { createVaultTools } from '../tools/vaultTools';

export class AgentService {
  private agent: Agent;
  private vaultPath: string;
  private settings: ObsidianAgentSettings;

  constructor(vaultPath: string, settings: ObsidianAgentSettings) {
    this.vaultPath = vaultPath;
    this.settings = settings;

    const tools = createVaultTools(vaultPath, {
      blockedCommands: settings.blockedCommands,
      enableBlocklist: settings.enableBlocklist,
    });

    const systemPrompt = buildVaultSystemPrompt({
      vaultPath,
      customPrompt: settings.systemPrompt,
    });

    const model = this.resolveModel();

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        thinkingLevel: settings.thinkingLevel || 'medium',
        tools,
      },
      convertToLlm,
      getApiKey: async (provider: string) => {
        return this.getApiKey(provider);
      },
    });
  }

  private resolveModel(): Model<any> | undefined {
    const { provider, modelId } = this.settings;

    // Custom OpenAI-compatible endpoint: construct model manually
    if (provider === 'custom-openai') {
      return this.resolveCustomOpenAIModel(this.settings.customOpenAI);
    }

    if (!provider || !modelId) return undefined;

    try {
      const allModels = getModels(provider as KnownProvider);
      const found = allModels.find(m => m.id === modelId);
      if (found) return found;
      // Return first model as fallback
      return allModels.length > 0 ? allModels[0] : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Constructs a Model object for a custom OpenAI-compatible endpoint.
   * Uses sensible defaults for fields that the user doesn't configure.
   */
  private resolveCustomOpenAIModel(cfg: CustomOpenAISettings): Model<'openai-completions'> | undefined {
    if (!cfg.baseUrl?.trim() || !cfg.modelId?.trim()) return undefined;

    return {
      id: cfg.modelId.trim(),
      name: cfg.modelId.trim(),
      api: 'openai-completions' as const,
      provider: 'openai',  // reuse pi-ai's OpenAI completions streaming implementation
      baseUrl: cfg.baseUrl.trim(),
      reasoning: false,
      input: ['text'] as ('text' | 'image')[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    };
  }

  private getApiKey(provider: string): string | undefined {
    // Custom OpenAI-compatible endpoint: use its own API key (may be empty for local endpoints)
    if (this.settings.provider === 'custom-openai') {
      return this.settings.customOpenAI.apiKey?.trim() || undefined;
    }

    // Check settings first
    if (this.settings.apiKeys[provider]) {
      return this.settings.apiKeys[provider];
    }

    // Check environment variables
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

  updateSettings(settings: ObsidianAgentSettings): void {
    this.settings = settings;

    // Update model
    const model = this.resolveModel();
    if (model) {
      this.agent.setModel(model);
    }

    // Update thinking level
    this.agent.setThinkingLevel(settings.thinkingLevel || 'medium');

    // Update system prompt
    const systemPrompt = buildVaultSystemPrompt({
      vaultPath: this.vaultPath,
      customPrompt: settings.systemPrompt,
    });
    this.agent.setSystemPrompt(systemPrompt);

    // Update tools with new blocklist settings
    const tools = createVaultTools(this.vaultPath, {
      blockedCommands: settings.blockedCommands,
      enableBlocklist: settings.enableBlocklist,
    });
    this.agent.setTools(tools);
  }

  async *query(prompt: string): AsyncGenerator<StreamChunk> {
    const model = this.resolveModel();
    if (!model) {
      yield { type: 'error', content: 'No model configured. Please set a provider and model in settings.' };
      return;
    }

    const isCustomEndpoint = this.settings.provider === 'custom-openai';
    const apiKey = this.getApiKey(model.provider);
    // Custom endpoints may not require an API key (e.g. Ollama, LM Studio)
    if (!apiKey && !isCustomEndpoint) {
      yield { type: 'error', content: `No API key found for provider "${model.provider}". Set it in plugin settings or environment variables.` };
      return;
    }

    // Ensure model is current
    this.agent.setModel(model);

    // Collect chunks via event subscription
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

    // Track state for delta extraction
    let lastTextLength = 0;
    let lastThinkingLength = 0;
    let seenToolCalls = new Set<string>();

    const unsubscribe = this.agent.subscribe((event: AgentEvent) => {
      switch (event.type) {
        case 'message_update': {
          const msg = event.message as AssistantMessage;
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
            case 'toolcall_end': {
              const tc = assistantEvent.toolCall;
              if (tc && !seenToolCalls.has(tc.id)) {
                seenToolCalls.add(tc.id);
                pushChunk({
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.name,
                  input: tc.arguments,
                });
              }
              break;
            }
          }
          break;
        }

        case 'tool_execution_end': {
          const resultContent = event.result?.content;
          const textParts = resultContent
            ?.filter((c: any) => c.type === 'text')
            ?.map((c: any) => c.text)
            ?.join('\n') || '';

          pushChunk({
            type: 'tool_result',
            id: event.toolCallId,
            content: textParts,
            isError: event.isError,
          });
          break;
        }

        case 'message_end': {
          const msg = event.message;
          if (msg && msg.role === 'assistant') {
            const assistantMsg = msg as AssistantMessage;
            if (assistantMsg.usage) {
              pushChunk({
                type: 'usage',
                usage: {
                  model: assistantMsg.model,
                  inputTokens: assistantMsg.usage.input,
                  outputTokens: assistantMsg.usage.output,
                  totalTokens: assistantMsg.usage.totalTokens,
                  cost: assistantMsg.usage.cost ? {
                    input: assistantMsg.usage.cost.input,
                    output: assistantMsg.usage.cost.output,
                    total: assistantMsg.usage.cost.total,
                  } : undefined,
                },
              });
            }
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

    // Start the prompt
    const promptPromise = this.agent.prompt(prompt).catch((err: Error) => {
      pushChunk({ type: 'error', content: err.message || 'Unknown error' });
      done = true;
    });

    // Yield chunks as they arrive
    try {
      while (!done) {
        if (chunkQueue.length > 0) {
          const chunk = chunkQueue.shift()!;
          yield chunk;
          if (chunk.type === 'done' || chunk.type === 'error') break;
        } else {
          const chunk = await new Promise<StreamChunk | null>((resolve) => {
            resolveChunk = resolve;
            // Safety timeout
            setTimeout(() => {
              if (resolveChunk === resolve) {
                resolveChunk = null;
                resolve(null);
              }
            }, 60000);
          });
          if (chunk) {
            yield chunk;
            if (chunk.type === 'done' || chunk.type === 'error') break;
          }
          if (done && chunkQueue.length === 0) break;
        }
      }

      // Drain remaining chunks
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

  isStreaming(): boolean {
    return this.agent.state.isStreaming;
  }

  getMessages(): AgentMessage[] {
    return this.agent.state.messages;
  }

  resetSession(): void {
    this.agent.reset();
  }

  static getAvailableProviders(): string[] {
    try {
      const providers = getProviders() as string[];
      // Ensure zai is included and add synthetic custom-openai provider
      if (!providers.includes('zai')) providers.push('zai');
      providers.push('custom-openai');
      return providers;
    } catch {
      return ['anthropic', 'openai', 'google', 'zai', 'custom-openai'];
    }
  }

  static getModelsForProvider(provider: string): Array<{ id: string; name: string }> {
    // Custom endpoint uses free-form model ID input, not a dropdown
    if (provider === 'custom-openai') return [];

    try {
      return getModels(provider as KnownProvider).map(m => ({ id: m.id, name: m.name }));
    } catch {
      return [];
    }
  }
}
