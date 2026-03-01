export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

export interface CustomOpenAISettings {
  baseUrl: string;     // e.g. http://localhost:11434/v1 or https://api.example.com/v1
  apiKey: string;      // allow empty for local/self-hosted endpoints (Ollama, LM Studio, etc.)
  modelId: string;     // free-form model identifier passed to the API
}

export interface ObsidianAgentSettings {
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;

  apiKeys: Record<string, string>;

  systemPrompt: string;
  enableBlocklist: boolean;
  blockedCommands: string[];

  enableAutoScroll: boolean;

  customOpenAI: CustomOpenAISettings;
}

export const DEFAULT_SETTINGS: ObsidianAgentSettings = {
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-20250514',
  thinkingLevel: 'medium',

  apiKeys: {},

  systemPrompt: '',
  enableBlocklist: true,
  blockedCommands: [
    'rm -rf',
    'chmod 777',
    'chmod -R 777',
  ],

  enableAutoScroll: true,

  customOpenAI: {
    baseUrl: '',
    apiKey: '',
    modelId: '',
  },
};
