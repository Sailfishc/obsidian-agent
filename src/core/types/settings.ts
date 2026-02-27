export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

export interface ObsidianAgentSettings {
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;

  apiKeys: Record<string, string>;

  systemPrompt: string;
  enableBlocklist: boolean;
  blockedCommands: string[];

  enableAutoScroll: boolean;
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
};
