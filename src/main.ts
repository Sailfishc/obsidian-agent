import { type Editor, type MarkdownView, Notice, Plugin, debounce } from 'obsidian';
import type { ObsidianAgentSettings } from './core/types';
import { DEFAULT_SETTINGS, VIEW_TYPE_AGENT } from './core/types';
import { McpStorage } from './core/mcp/McpStorage';
import { McpServerManager } from './core/mcp/McpServerManager';
import { McpToolAdapter } from './core/mcp/McpToolAdapter';
import { SkillManager } from './core/skills/SkillManager';
import { SkillStorage } from './core/skills/SkillStorage';
import { ChatView } from './features/chat/ChatView';
import { InlineEditModal } from './features/inline-edit/InlineEditModal';
import { AgentSettingsTab } from './features/settings/SettingsTab';
import { buildCursorContext } from './utils/inlineEditContext';

/**
 * Normalize loaded settings to the current grouped schema (v2).
 * Handles migration from legacy flat settings and deep-merging of partial objects.
 */
function normalizeLoadedSettings(loaded: any): ObsidianAgentSettings {
  if (!loaded || typeof loaded !== 'object') {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  const isLegacy = !loaded.settingsVersion || loaded.settingsVersion < 2;

  // Helper: deep merge two objects (target wins for existing keys, source provides defaults)
  const deepMerge = <T extends Record<string, any>>(defaults: T, partial: any): T => {
    if (!partial || typeof partial !== 'object') return { ...defaults };
    const result = { ...defaults } as any;
    for (const key of Object.keys(defaults)) {
      if (key in partial) {
        if (
          typeof defaults[key] === 'object' &&
          defaults[key] !== null &&
          !Array.isArray(defaults[key])
        ) {
          result[key] = deepMerge(defaults[key], partial[key]);
        } else {
          result[key] = partial[key];
        }
      }
    }
    return result;
  };

  if (isLegacy) {
    // Migrate flat settings → grouped v2
    return {
      settingsVersion: 2,

      general: {
        provider: loaded.provider ?? DEFAULT_SETTINGS.general.provider,
        modelId: loaded.modelId ?? DEFAULT_SETTINGS.general.modelId,
        thinkingLevel: loaded.thinkingLevel ?? DEFAULT_SETTINGS.general.thinkingLevel,
      },

      security: {
        enableBlocklist: loaded.enableBlocklist ?? DEFAULT_SETTINGS.security.enableBlocklist,
        blockedCommands: {
          unix: Array.isArray(loaded.blockedCommands)
            ? loaded.blockedCommands
            : DEFAULT_SETTINGS.security.blockedCommands.unix,
          windows: DEFAULT_SETTINGS.security.blockedCommands.windows,
        },
      },

      context: JSON.parse(JSON.stringify(DEFAULT_SETTINGS.context)),

      appearance: {
        enableAutoScroll: loaded.enableAutoScroll ?? DEFAULT_SETTINGS.appearance.enableAutoScroll,
        showThinkingBlocks: DEFAULT_SETTINGS.appearance.showThinkingBlocks,
        showToolBlocks: DEFAULT_SETTINGS.appearance.showToolBlocks,
      },

      inlineEdit: JSON.parse(JSON.stringify(DEFAULT_SETTINGS.inlineEdit)),

      instructions: {
        systemPrompt: loaded.systemPrompt ?? DEFAULT_SETTINGS.instructions.systemPrompt,
      },

      bash: JSON.parse(JSON.stringify(DEFAULT_SETTINGS.bash)),

      skills: JSON.parse(JSON.stringify(DEFAULT_SETTINGS.skills)),

      apiKeys: loaded.apiKeys && typeof loaded.apiKeys === 'object'
        ? loaded.apiKeys
        : {},

      customOpenAI: deepMerge(
        DEFAULT_SETTINGS.customOpenAI,
        loaded.customOpenAI,
      ),

      lastConversationId: loaded.lastConversationId ?? null,
    };
  }

  // v2 settings: deep merge each group
  return {
    settingsVersion: 2,

    general: deepMerge(DEFAULT_SETTINGS.general, loaded.general),
    security: deepMerge(DEFAULT_SETTINGS.security, loaded.security),
    context: deepMerge(DEFAULT_SETTINGS.context, loaded.context),
    appearance: deepMerge(DEFAULT_SETTINGS.appearance, loaded.appearance),
    inlineEdit: deepMerge(DEFAULT_SETTINGS.inlineEdit, loaded.inlineEdit),
    instructions: deepMerge(DEFAULT_SETTINGS.instructions, loaded.instructions),
    bash: deepMerge(DEFAULT_SETTINGS.bash, loaded.bash),
    skills: deepMerge(DEFAULT_SETTINGS.skills, loaded.skills),

    apiKeys: loaded.apiKeys && typeof loaded.apiKeys === 'object'
      ? loaded.apiKeys
      : {},

    customOpenAI: deepMerge(
      DEFAULT_SETTINGS.customOpenAI,
      loaded.customOpenAI,
    ),

    lastConversationId: loaded.lastConversationId ?? null,
  };
}

export default class ObsidianAgentPlugin extends Plugin {
  settings: ObsidianAgentSettings;
  mcpStorage: McpStorage;
  mcpManager: McpServerManager;
  mcpToolAdapter: McpToolAdapter;
  skillManager: SkillManager;
  skillStorage: SkillStorage;

  /** Debounced skill reload for vault file events (trailing to catch final state). */
  private debouncedSkillReload = debounce(async () => {
    await this.skillManager?.reload();
    this.notifySkillsChanged();
  }, 500);

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize MCP services
    this.mcpStorage = new McpStorage(this.app);
    this.mcpManager = new McpServerManager(this.mcpStorage);
    this.mcpToolAdapter = new McpToolAdapter();
    await this.mcpManager.loadServers();

    // Initialize Skills
    this.skillManager = new SkillManager(this.app, () => this.settings.skills);
    this.skillStorage = new SkillStorage(this.app, () => this.settings.skills);
    await this.skillManager.reload();

    // Watch vault for SKILL.md changes
    this.registerEvent(this.app.vault.on('create', (file) => {
      if (file.name === 'SKILL.md') this.debouncedSkillReload();
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (file.name === 'SKILL.md') this.debouncedSkillReload();
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (file.name === 'SKILL.md' || oldPath.endsWith('SKILL.md')) this.debouncedSkillReload();
    }));
    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (file.name === 'SKILL.md') this.debouncedSkillReload();
    }));

    this.registerView(
      VIEW_TYPE_AGENT,
      (leaf) => new ChatView(leaf, this),
    );

    this.addRibbonIcon('bot', 'Open Obsidian Agent', () => {
      this.activateView();
    });

    this.addCommand({
      id: 'open-view',
      name: 'Open chat view',
      callback: () => {
        this.activateView();
      },
    });

    this.addCommand({
      id: 'new-chat',
      name: 'New chat',
      checkCallback: (checking: boolean) => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT)[0];
        if (!leaf) return false;
        if (!checking) {
          const view = leaf.view as ChatView;
          (view as any).newChat?.();
        }
        return true;
      },
    });

    // Inline Edit command (Cmd/Ctrl+Shift+E)
    this.addCommand({
      id: 'inline-edit',
      name: 'Inline edit',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'e' }],
      editorCallback: (editor: Editor, view: MarkdownView) => {
        // Gate: check if inline edit is enabled
        if (!this.settings.inlineEdit.enabled) {
          new Notice('Inline edit is disabled in settings');
          return;
        }

        const file = view.file;
        if (!file) {
          new Notice('No active file');
          return;
        }
        const notePath = file.path;
        const selectedText = editor.getSelection();

        if (selectedText && selectedText.trim().length > 0) {
          // Selection mode
          const from = editor.getCursor('from');
          const to = editor.getCursor('to');
          new InlineEditModal(this.app, this, editor, view, notePath, {
            mode: 'selection',
            selectedText,
            from,
            to,
            startLine: from.line + 1, // 1-indexed
            lineCount: selectedText.split(/\r?\n/).length,
          }).open();
        } else {
          // Cursor mode
          const cursor = editor.getCursor();
          const lineCount = editor.lineCount();
          const cursorContext = buildCursorContext(
            (line: number) => editor.getLine(line),
            lineCount,
            cursor.line,
            cursor.ch,
          );
          new InlineEditModal(this.app, this, editor, view, notePath, {
            mode: 'cursor',
            pos: cursor,
            cursorContext,
          }).open();
        }
      },
    });

    this.addSettingTab(new AgentSettingsTab(this.app, this));
  }

  onunload(): void {
    // Clean up MCP connections
    this.mcpToolAdapter?.reset();
    // Views are automatically cleaned up by Obsidian
  }

  /**
   * Reload MCP server configs from disk and broadcast to all open ChatViews.
   * Called by McpSettingsManager after any MCP config change.
   */
  async reloadMcpServersAndBroadcast(): Promise<void> {
    await this.mcpManager.loadServers();
    await this.mcpToolAdapter.reset();

    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT);
    for (const leaf of leaves) {
      const view = leaf.view as ChatView;
      view.onMcpConfigChanged?.();
    }
  }

  /** Reload skills from disk and broadcast to all views. Called by SkillsSettingsManager. */
  async reloadSkillsAndBroadcast(): Promise<void> {
    await this.skillManager?.reload();
    this.notifySkillsChanged();
  }

  /** Notify all open ChatViews that skills have been reloaded. */
  private notifySkillsChanged(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT);
    for (const leaf of leaves) {
      const view = leaf.view as ChatView;
      view.onSettingsChanged?.(this.settings);
    }
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = normalizeLoadedSettings(loaded);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);

    // Notify all open chat views about settings changes
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT);
    for (const leaf of leaves) {
      const view = leaf.view as ChatView;
      view.onSettingsChanged?.(this.settings);
    }
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_AGENT)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({
          type: VIEW_TYPE_AGENT,
          active: true,
        });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
}
