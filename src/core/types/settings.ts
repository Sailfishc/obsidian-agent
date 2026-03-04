export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

export interface EnvironmentSnippet {
  name: string;
  description: string;
  envText: string;
  modelContextLimits: Record<string, number>;
}

export interface CustomOpenAISettings {
  baseUrl: string;     // e.g. http://localhost:11434/v1 or https://api.example.com/v1
  apiKey: string;      // allow empty for local/self-hosted endpoints (Ollama, LM Studio, etc.)
  modelId: string;     // free-form model identifier passed to the API
}

export interface ObsidianAgentSettings {
  settingsVersion: 2;

  general: {
    provider: string;
    modelId: string;
    thinkingLevel: ThinkingLevel;
  };

  security: {
    enableBlocklist: boolean;
    blockedCommands: {
      unix: string[];
      windows: string[];
    };
  };

  context: {
    includeActiveFileByDefault: boolean;
    excludedTags: string[];
    limits: {
      maxContextFiles: number;
      maxCharsPerFile: number;
      maxTotalChars: number;
    };
  };

  appearance: {
    enableAutoScroll: boolean;
    showThinkingBlocks: boolean;
    showToolBlocks: boolean;
  };

  inlineEdit: {
    enabled: boolean;
    useGlobalModel: boolean;
    modelOverride?: {
      provider: string;
      modelId: string;
    };
  };

  instructions: {
    systemPrompt: string;
  };

  bash: {
    enabled: boolean;
  };

  skills: {
    enabled: boolean;
    enableSkillCommands: boolean;
    roots: string[];
  };

  environment: {
    envText: string;
    modelContextLimits: Record<string, number>;
    snippets: EnvironmentSnippet[];
  };

  apiKeys: Record<string, string>;
  customOpenAI: CustomOpenAISettings;

  /** ID of the last active conversation (for restoring on reload). */
  lastConversationId?: string | null;
}

export const DEFAULT_SETTINGS: ObsidianAgentSettings = {
  settingsVersion: 2,

  general: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    thinkingLevel: 'medium',
  },

  security: {
    enableBlocklist: true,
    blockedCommands: {
      unix: [
        'rm -rf',
        'chmod 777',
        'chmod -R 777',
      ],
      windows: [
        'format',
        'del /f /s /q',
        'rd /s /q',
      ],
    },
  },

  context: {
    includeActiveFileByDefault: true,
    excludedTags: [],
    limits: {
      maxContextFiles: 10,
      maxCharsPerFile: 20_000,
      maxTotalChars: 100_000,
    },
  },

  appearance: {
    enableAutoScroll: true,
    showThinkingBlocks: true,
    showToolBlocks: true,
  },

  inlineEdit: {
    enabled: true,
    useGlobalModel: true,
  },

  instructions: {
    systemPrompt: '',
  },

  bash: {
    enabled: true,
  },

  skills: {
    enabled: true,
    enableSkillCommands: true,
    roots: ['.claude/skills', '.agents/skills'],
  },

  environment: {
    envText: '',
    modelContextLimits: {},
    snippets: [],
  },

  apiKeys: {},

  customOpenAI: {
    baseUrl: '',
    apiKey: '',
    modelId: '',
  },
};
