import { type App, PluginSettingTab, Setting } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { AgentService } from '../../core/agent/AgentService';
import { McpSettingsManager } from './mcp/McpSettingsManager';

const THINKING_LEVELS = [
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

const WELL_KNOWN_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'groq',
  'openrouter',
  'mistral',
  'zai',
];

/** All provider tabs: well-known + custom-openai */
const ALL_PROVIDER_TABS = [...WELL_KNOWN_PROVIDERS, 'custom-openai'];

/** User-friendly labels for provider dropdown / tabs */
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  xai: 'xAI',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  mistral: 'Mistral',
  zai: 'ZAI',
  'custom-openai': 'Custom',
};

export class AgentSettingsTab extends PluginSettingTab {
  plugin: ObsidianAgentPlugin;

  /** UI-only state: which provider tab is currently active in the config panel. */
  private activeProviderTab: string | null = null;

  constructor(app: App, plugin: ObsidianAgentPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('oa-settings');

    // Initialize active tab if needed (default to the active provider)
    if (!this.activeProviderTab) {
      this.activeProviderTab = this.plugin.settings.general.provider;
    }

    this.renderModelSection(containerEl);
    this.renderProviderConfigTabs(containerEl);
    this.renderCustomInstructions(containerEl);
    this.renderSkills(containerEl);
    this.renderMcp(containerEl);
    this.renderSecurity(containerEl);
    this.renderContext(containerEl);
    this.renderAppearance(containerEl);
    this.renderInlineEdit(containerEl);
    this.renderBash(containerEl);
  }

  // ── Model Selection (compact card) ──────────────────────────────────────

  private renderModelSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Model').setHeading();

    const isCustomProvider = this.plugin.settings.general.provider === 'custom-openai';

    // Provider selector
    new Setting(containerEl)
      .setName('Provider')
      .setDesc('LLM provider to use')
      .addDropdown(dropdown => {
        for (const p of WELL_KNOWN_PROVIDERS) {
          dropdown.addOption(p, PROVIDER_LABELS[p] || p);
        }
        dropdown.addOption('custom-openai', 'OpenAI-compatible (custom)');

        dropdown.setValue(this.plugin.settings.general.provider);
        dropdown.onChange(async (value) => {
          this.plugin.settings.general.provider = value;
          // Auto-switch to that provider's tab so the user can configure it
          this.activeProviderTab = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (isCustomProvider) {
      // For custom-openai, show model ID in the model section (base URL + API key are in provider tab)
      new Setting(containerEl)
        .setName('Model ID')
        .setDesc('Model identifier passed to the API (e.g. llama3.1:8b, gpt-4o)')
        .addText(text => {
          text.setPlaceholder('llama3.1:8b');
          text.inputEl.style.width = '100%';
          text.setValue(this.plugin.settings.customOpenAI.modelId);
          text.onChange(async (value) => {
            this.plugin.settings.customOpenAI.modelId = value;
            await this.plugin.saveSettings();
          });
        });
    } else {
      // Registry-backed model selector
      const models = AgentService.getModelsForProvider(this.plugin.settings.general.provider);
      new Setting(containerEl)
        .setName('Model')
        .setDesc('Model to use for conversations')
        .addDropdown(dropdown => {
          if (models.length === 0) {
            dropdown.addOption('', 'No models available');
          } else {
            for (const m of models) {
              dropdown.addOption(m.id, m.name || m.id);
            }
          }
          dropdown.setValue(this.plugin.settings.general.modelId);
          dropdown.onChange(async (value) => {
            this.plugin.settings.general.modelId = value;
            await this.plugin.saveSettings();
          });
        });
    }

    // Thinking level
    new Setting(containerEl)
      .setName('Thinking level')
      .setDesc('Controls how much the model reasons before responding')
      .addDropdown(dropdown => {
        for (const level of THINKING_LEVELS) {
          dropdown.addOption(level.value, level.label);
        }
        dropdown.setValue(this.plugin.settings.general.thinkingLevel);
        dropdown.onChange(async (value) => {
          this.plugin.settings.general.thinkingLevel = value as any;
          await this.plugin.saveSettings();
        });
      });
  }

  // ── Provider Config Tabs ────────────────────────────────────────────────

  /** Check if a provider has its API key configured. */
  private providerHasConfig(provider: string): boolean {
    if (provider === 'custom-openai') {
      return !!(this.plugin.settings.customOpenAI.baseUrl?.trim());
    }
    return !!(this.plugin.settings.apiKeys[provider]?.trim());
  }

  private renderProviderConfigTabs(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Provider Configuration').setHeading();

    containerEl.createEl('p', {
      text: 'Configure API keys and endpoints for each provider. You can also set environment variables (e.g., ANTHROPIC_API_KEY).',
      cls: 'setting-item-description oa-settings-description',
    });

    // ── Tab bar ──
    const tabsContainer = containerEl.createDiv({ cls: 'oa-provider-tabs' });

    for (const provider of ALL_PROVIDER_TABS) {
      const label = PROVIDER_LABELS[provider] || provider;
      const isActive = this.activeProviderTab === provider;
      const hasConfig = this.providerHasConfig(provider);

      const tabBtn = tabsContainer.createEl('button', {
        cls: `oa-provider-tab${isActive ? ' is-active' : ''}${hasConfig ? ' has-config' : ''}`,
        text: label,
        attr: { type: 'button' },
      });

      tabBtn.addEventListener('click', () => {
        this.activeProviderTab = provider;
        this.display();
      });
    }

    // ── Config panel ──
    const panelEl = containerEl.createDiv({ cls: 'oa-provider-panel' });
    this.renderProviderPanel(panelEl, this.activeProviderTab || 'anthropic');
  }

  private renderProviderPanel(panelEl: HTMLElement, provider: string): void {
    if (provider === 'custom-openai') {
      this.renderCustomOpenAIPanel(panelEl);
    } else {
      this.renderStandardProviderPanel(panelEl, provider);
    }
  }

  private renderStandardProviderPanel(panelEl: HTMLElement, provider: string): void {
    const label = PROVIDER_LABELS[provider] || provider;

    new Setting(panelEl)
      .setName(`${label} API key`)
      .setDesc(`Enter your ${label} API key`)
      .addText(text => {
        text.inputEl.type = 'password';
        text.inputEl.style.width = '100%';
        text.setPlaceholder(`sk-...`);
        text.setValue(this.plugin.settings.apiKeys[provider] || '');
        text.onChange(async (value) => {
          if (value.trim()) {
            this.plugin.settings.apiKeys[provider] = value.trim();
          } else {
            delete this.plugin.settings.apiKeys[provider];
          }
          await this.plugin.saveSettings();
          // Update tab indicator
          const tabs = this.containerEl.querySelectorAll('.oa-provider-tab');
          const idx = ALL_PROVIDER_TABS.indexOf(provider);
          if (idx >= 0 && tabs[idx]) {
            tabs[idx].toggleClass('has-config', this.providerHasConfig(provider));
          }
        });
      });

    // Show env var hint
    const envVarName = this.getEnvVarName(provider);
    if (envVarName) {
      panelEl.createEl('p', {
        text: `💡 Alternatively, set the ${envVarName} environment variable.`,
        cls: 'setting-item-description oa-settings-hint',
      });
    }
  }

  private renderCustomOpenAIPanel(panelEl: HTMLElement): void {
    new Setting(panelEl)
      .setName('Base URL')
      .setDesc('API endpoint URL (e.g. http://localhost:11434/v1 for Ollama)')
      .addText(text => {
        text.setPlaceholder('http://localhost:11434/v1');
        text.inputEl.style.width = '100%';
        text.setValue(this.plugin.settings.customOpenAI.baseUrl);
        text.onChange(async (value) => {
          this.plugin.settings.customOpenAI.baseUrl = value;
          await this.plugin.saveSettings();
          // Update tab indicator
          const tabs = this.containerEl.querySelectorAll('.oa-provider-tab');
          const idx = ALL_PROVIDER_TABS.indexOf('custom-openai');
          if (idx >= 0 && tabs[idx]) {
            tabs[idx].toggleClass('has-config', this.providerHasConfig('custom-openai'));
          }
        });
      });

    new Setting(panelEl)
      .setName('API key')
      .setDesc('Leave empty for local endpoints that don\'t require authentication')
      .addText(text => {
        text.inputEl.type = 'password';
        text.inputEl.style.width = '100%';
        text.setPlaceholder('(optional)');
        text.setValue(this.plugin.settings.customOpenAI.apiKey);
        text.onChange(async (value) => {
          this.plugin.settings.customOpenAI.apiKey = value;
          await this.plugin.saveSettings();
        });
      });

    panelEl.createEl('p', {
      text: '💡 Select "OpenAI-compatible (custom)" as your Provider above, then set the Model ID in the Model section.',
      cls: 'setting-item-description oa-settings-hint',
    });
  }

  /** Map provider to its environment variable name for the hint. */
  private getEnvVarName(provider: string): string | null {
    const envMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GOOGLE_API_KEY / GEMINI_API_KEY',
      xai: 'XAI_API_KEY',
      groq: 'GROQ_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      mistral: 'MISTRAL_API_KEY',
      zai: 'ZAI_API_KEY',
    };
    return envMap[provider] || null;
  }

  // ── Custom Instructions ─────────────────────────────────────────────────

  private renderCustomInstructions(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Custom Instructions').setHeading();

    new Setting(containerEl)
      .setName('System prompt')
      .setDesc('Additional instructions appended to the default system prompt. Use this to customize the agent\'s behavior, tone, or focus areas.')
      .addTextArea(text => {
        text.inputEl.style.width = '100%';
        text.inputEl.style.height = '120px';
        text.inputEl.style.fontFamily = 'var(--font-monospace)';
        text.setPlaceholder('e.g., Always respond in Chinese. Focus on explaining code clearly.');
        text.setValue(this.plugin.settings.instructions.systemPrompt);
        text.onChange(async (value) => {
          this.plugin.settings.instructions.systemPrompt = value;
          await this.plugin.saveSettings();
        });
      });
  }

  // ── Skills ───────────────────────────────────────────────────────────────

  private renderSkills(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Skills').setHeading();

    containerEl.createEl('p', {
      text: 'Skills are SKILL.md files that provide specialized instructions for the agent. Place them in the configured directories within your vault.',
      cls: 'setting-item-description oa-settings-description',
    });

    new Setting(containerEl)
      .setName('Enable skills')
      .setDesc('Discover and use SKILL.md files from the vault')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.skills.enabled);
        toggle.onChange(async (value) => {
          this.plugin.settings.skills.enabled = value;
          await this.plugin.saveSettings();
          await this.plugin.skillManager?.reload();
          this.display();
        });
      });

    if (this.plugin.settings.skills.enabled) {
      new Setting(containerEl)
        .setName('Enable /skill: commands')
        .setDesc('Allow invoking skills explicitly with /skill:name in chat input')
        .addToggle(toggle => {
          toggle.setValue(this.plugin.settings.skills.enableSkillCommands);
          toggle.onChange(async (value) => {
            this.plugin.settings.skills.enableSkillCommands = value;
            await this.plugin.saveSettings();
          });
        });

      new Setting(containerEl)
        .setName('Skill directories')
        .setDesc('Vault-relative directories to scan for SKILL.md files (one per line)')
        .addTextArea(text => {
          text.inputEl.style.width = '100%';
          text.inputEl.style.height = '80px';
          text.inputEl.style.fontFamily = 'var(--font-monospace)';
          text.setPlaceholder('.claude/skills\n.agents/skills');
          text.setValue(this.plugin.settings.skills.roots.join('\n'));
          text.onChange(async (value) => {
            this.plugin.settings.skills.roots = value
              .split('\n')
              .map(s => s.trim())
              .filter(s => s.length > 0);
            await this.plugin.saveSettings();
            await this.plugin.skillManager?.reload();
          });
        });

      // Show loaded skills summary
      const skills = this.plugin.skillManager?.getSkills() ?? [];
      const diagnostics = this.plugin.skillManager?.getDiagnostics() ?? [];

      if (skills.length > 0) {
        const summaryEl = containerEl.createDiv({ cls: 'oa-settings-description' });
        summaryEl.createEl('p', {
          text: `✅ ${skills.length} skill(s) loaded: ${skills.map(s => s.name).join(', ')}`,
        });
      } else {
        containerEl.createEl('p', {
          text: '📭 No skills found. Create SKILL.md files in the configured directories.',
          cls: 'setting-item-description oa-settings-description',
        });
      }

      if (diagnostics.length > 0) {
        const diagEl = containerEl.createDiv({ cls: 'oa-settings-description' });
        diagEl.createEl('p', {
          text: `⚠️ ${diagnostics.length} diagnostic(s):`,
        });
        const list = diagEl.createEl('ul');
        for (const d of diagnostics.slice(0, 5)) {
          list.createEl('li', { text: `[${d.type}] ${d.message} (${d.path})` });
        }
        if (diagnostics.length > 5) {
          list.createEl('li', { text: `… and ${diagnostics.length - 5} more` });
        }
      }
    }
  }

  // ── MCP ──────────────────────────────────────────────────────────────────

  private renderMcp(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('MCP Servers').setHeading();

    containerEl.createEl('p', {
      text: 'Configure Model Context Protocol servers to extend the agent with external tools. Servers with context-saving mode are only activated when @-mentioned.',
      cls: 'setting-item-description oa-settings-description',
    });

    const mcpContainer = containerEl.createDiv({ cls: 'oa-mcp-settings' });
    new McpSettingsManager(mcpContainer, this.plugin);
  }

  // ── Security ────────────────────────────────────────────────────────────

  private renderSecurity(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Security').setHeading();

    new Setting(containerEl)
      .setName('Enable command blocklist')
      .setDesc('Block dangerous bash commands from being executed')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.security.enableBlocklist);
        toggle.onChange(async (value) => {
          this.plugin.settings.security.enableBlocklist = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (this.plugin.settings.security.enableBlocklist) {
      const isWindows = process.platform === 'win32';

      new Setting(containerEl)
        .setName('Blocked commands (Unix)')
        .setDesc('Patterns to block on Unix/macOS (one per line)')
        .addTextArea(text => {
          text.inputEl.style.width = '100%';
          text.inputEl.style.height = '80px';
          text.inputEl.style.fontFamily = 'var(--font-monospace)';
          text.setValue(this.plugin.settings.security.blockedCommands.unix.join('\n'));
          text.onChange(async (value) => {
            this.plugin.settings.security.blockedCommands.unix = value
              .split('\n')
              .map(s => s.trim())
              .filter(s => s.length > 0);
            await this.plugin.saveSettings();
          });
        });

      if (isWindows) {
        new Setting(containerEl)
          .setName('Blocked commands (Windows)')
          .setDesc('Patterns to block on Windows (one per line)')
          .addTextArea(text => {
            text.inputEl.style.width = '100%';
            text.inputEl.style.height = '80px';
            text.inputEl.style.fontFamily = 'var(--font-monospace)';
            text.setValue(this.plugin.settings.security.blockedCommands.windows.join('\n'));
            text.onChange(async (value) => {
              this.plugin.settings.security.blockedCommands.windows = value
                .split('\n')
                .map(s => s.trim())
                .filter(s => s.length > 0);
              await this.plugin.saveSettings();
            });
          });
      }
    }
  }

  // ── Context ─────────────────────────────────────────────────────────────

  private renderContext(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Context').setHeading();

    new Setting(containerEl)
      .setName('Include active file by default')
      .setDesc('Automatically attach the currently open file as context for new conversations')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.context.includeActiveFileByDefault);
        toggle.onChange(async (value) => {
          this.plugin.settings.context.includeActiveFileByDefault = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Excluded tags')
      .setDesc('Notes with these tags will not be auto-included as context (one per line, without #)')
      .addTextArea(text => {
        text.inputEl.style.width = '100%';
        text.inputEl.style.height = '60px';
        text.inputEl.style.fontFamily = 'var(--font-monospace)';
        text.setPlaceholder('e.g., private\nsecret\ndraft');
        text.setValue(this.plugin.settings.context.excludedTags.join('\n'));
        text.onChange(async (value) => {
          this.plugin.settings.context.excludedTags = value
            .split('\n')
            .map(s => s.trim().replace(/^#/, ''))
            .filter(s => s.length > 0);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Max context files')
      .setDesc('Maximum number of files that can be attached as context')
      .addText(text => {
        text.inputEl.type = 'number';
        text.inputEl.style.width = '60px';
        text.inputEl.min = '1';
        text.inputEl.max = '50';
        text.setValue(String(this.plugin.settings.context.limits.maxContextFiles));
        text.onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num >= 1 && num <= 50) {
            this.plugin.settings.context.limits.maxContextFiles = num;
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName('Max characters per file')
      .setDesc('Truncate context files beyond this character limit')
      .addText(text => {
        text.inputEl.type = 'number';
        text.inputEl.style.width = '80px';
        text.inputEl.min = '1000';
        text.inputEl.max = '200000';
        text.setValue(String(this.plugin.settings.context.limits.maxCharsPerFile));
        text.onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num >= 1000) {
            this.plugin.settings.context.limits.maxCharsPerFile = num;
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName('Max total context characters')
      .setDesc('Total character budget across all context files')
      .addText(text => {
        text.inputEl.type = 'number';
        text.inputEl.style.width = '80px';
        text.inputEl.min = '5000';
        text.inputEl.max = '1000000';
        text.setValue(String(this.plugin.settings.context.limits.maxTotalChars));
        text.onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num >= 5000) {
            this.plugin.settings.context.limits.maxTotalChars = num;
            await this.plugin.saveSettings();
          }
        });
      });
  }

  // ── Appearance ──────────────────────────────────────────────────────────

  private renderAppearance(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Appearance').setHeading();

    new Setting(containerEl)
      .setName('Auto-scroll')
      .setDesc('Automatically scroll to bottom during streaming responses')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.appearance.enableAutoScroll);
        toggle.onChange(async (value) => {
          this.plugin.settings.appearance.enableAutoScroll = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Show thinking blocks')
      .setDesc('Display the model\'s reasoning process in chat messages')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.appearance.showThinkingBlocks);
        toggle.onChange(async (value) => {
          this.plugin.settings.appearance.showThinkingBlocks = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Show tool blocks')
      .setDesc('Display tool call details (read, bash, edit, etc.) in chat messages')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.appearance.showToolBlocks);
        toggle.onChange(async (value) => {
          this.plugin.settings.appearance.showToolBlocks = value;
          await this.plugin.saveSettings();
        });
      });
  }

  // ── Inline Edit ─────────────────────────────────────────────────────────

  private renderInlineEdit(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Inline Edit').setHeading();

    new Setting(containerEl)
      .setName('Enable inline edit')
      .setDesc('Allow using Cmd/Ctrl+Shift+E to edit selected text or insert at cursor with AI')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.inlineEdit.enabled);
        toggle.onChange(async (value) => {
          this.plugin.settings.inlineEdit.enabled = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (this.plugin.settings.inlineEdit.enabled) {
      new Setting(containerEl)
        .setName('Use global model')
        .setDesc('Use the same model configured in Model settings for inline edits')
        .addToggle(toggle => {
          toggle.setValue(this.plugin.settings.inlineEdit.useGlobalModel);
          toggle.onChange(async (value) => {
            this.plugin.settings.inlineEdit.useGlobalModel = value;
            await this.plugin.saveSettings();
            this.display();
          });
        });

      if (!this.plugin.settings.inlineEdit.useGlobalModel) {
        const override = this.plugin.settings.inlineEdit.modelOverride ?? { provider: 'anthropic', modelId: '' };

        new Setting(containerEl)
          .setName('Override provider')
          .setDesc('Provider for inline edit')
          .addDropdown(dropdown => {
            for (const p of WELL_KNOWN_PROVIDERS) {
              dropdown.addOption(p, PROVIDER_LABELS[p] || p);
            }
            dropdown.setValue(override.provider);
            dropdown.onChange(async (value) => {
              if (!this.plugin.settings.inlineEdit.modelOverride) {
                this.plugin.settings.inlineEdit.modelOverride = { provider: value, modelId: '' };
              } else {
                this.plugin.settings.inlineEdit.modelOverride.provider = value;
              }
              await this.plugin.saveSettings();
              this.display();
            });
          });

        const overrideModels = AgentService.getModelsForProvider(override.provider);
        if (overrideModels.length > 0) {
          new Setting(containerEl)
            .setName('Override model')
            .setDesc('Model for inline edit')
            .addDropdown(dropdown => {
              for (const m of overrideModels) {
                dropdown.addOption(m.id, m.name || m.id);
              }
              dropdown.setValue(override.modelId);
              dropdown.onChange(async (value) => {
                if (!this.plugin.settings.inlineEdit.modelOverride) {
                  this.plugin.settings.inlineEdit.modelOverride = { provider: override.provider, modelId: value };
                } else {
                  this.plugin.settings.inlineEdit.modelOverride.modelId = value;
                }
                await this.plugin.saveSettings();
              });
            });
        } else {
          new Setting(containerEl)
            .setName('Override model ID')
            .setDesc('Model identifier for inline edit')
            .addText(text => {
              text.setValue(override.modelId);
              text.onChange(async (value) => {
                if (!this.plugin.settings.inlineEdit.modelOverride) {
                  this.plugin.settings.inlineEdit.modelOverride = { provider: override.provider, modelId: value };
                } else {
                  this.plugin.settings.inlineEdit.modelOverride.modelId = value;
                }
                await this.plugin.saveSettings();
              });
            });
        }
      }
    }
  }

  // ── Bash ────────────────────────────────────────────────────────────────

  private renderBash(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Bash Tool').setHeading();

    new Setting(containerEl)
      .setName('Enable bash tool')
      .setDesc('Allow the agent to execute bash commands. When disabled, only file tools (read, edit, write, grep, find, ls) are available.')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.bash.enabled);
        toggle.onChange(async (value) => {
          this.plugin.settings.bash.enabled = value;
          await this.plugin.saveSettings();
        });
      });
  }
}
