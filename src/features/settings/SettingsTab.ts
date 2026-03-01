import { type App, PluginSettingTab, Setting } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { AgentService } from '../../core/agent/AgentService';

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

/** User-friendly labels for provider dropdown */
const PROVIDER_LABELS: Record<string, string> = {
  'custom-openai': 'OpenAI-compatible (custom)',
};

export class AgentSettingsTab extends PluginSettingTab {
  plugin: ObsidianAgentPlugin;

  constructor(app: App, plugin: ObsidianAgentPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const isCustomProvider = this.plugin.settings.provider === 'custom-openai';

    // ── Model Configuration ──
    containerEl.createEl('h2', { text: 'Model' });

    // Provider selector
    new Setting(containerEl)
      .setName('Provider')
      .setDesc('LLM provider to use')
      .addDropdown(dropdown => {
        for (const p of WELL_KNOWN_PROVIDERS) {
          dropdown.addOption(p, PROVIDER_LABELS[p] || p);
        }
        // Add custom-openai at the end
        dropdown.addOption('custom-openai', PROVIDER_LABELS['custom-openai']);

        dropdown.setValue(this.plugin.settings.provider);
        dropdown.onChange(async (value) => {
          this.plugin.settings.provider = value;
          await this.plugin.saveSettings();
          this.display(); // Refresh to update model section
        });
      });

    if (isCustomProvider) {
      // Custom OpenAI-compatible endpoint settings
      new Setting(containerEl)
        .setName('Base URL')
        .setDesc('API endpoint URL (e.g. http://localhost:11434/v1 for Ollama)')
        .addText(text => {
          text.setPlaceholder('http://localhost:11434/v1');
          text.inputEl.style.width = '100%';
          text.setValue(this.plugin.settings.customOpenAI.baseUrl);
          text.onChange(async (value) => {
            this.plugin.settings.customOpenAI.baseUrl = value;
            await this.plugin.saveSettings();
          });
        });

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

      new Setting(containerEl)
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
    } else {
      // Registry-backed model selector
      const models = AgentService.getModelsForProvider(this.plugin.settings.provider);
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
          dropdown.setValue(this.plugin.settings.modelId);
          dropdown.onChange(async (value) => {
            this.plugin.settings.modelId = value;
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
        dropdown.setValue(this.plugin.settings.thinkingLevel);
        dropdown.onChange(async (value) => {
          this.plugin.settings.thinkingLevel = value as any;
          await this.plugin.saveSettings();
        });
      });

    // ── API Keys ──
    containerEl.createEl('h2', { text: 'API Keys' });
    containerEl.createEl('p', {
      text: 'Set API keys for providers. Alternatively, set environment variables (e.g., ANTHROPIC_API_KEY).',
      cls: 'setting-item-description',
    });

    for (const provider of WELL_KNOWN_PROVIDERS) {
      new Setting(containerEl)
        .setName(`${provider} API key`)
        .addText(text => {
          text.inputEl.type = 'password';
          text.inputEl.style.width = '100%';
          text.setValue(this.plugin.settings.apiKeys[provider] || '');
          text.onChange(async (value) => {
            if (value.trim()) {
              this.plugin.settings.apiKeys[provider] = value.trim();
            } else {
              delete this.plugin.settings.apiKeys[provider];
            }
            await this.plugin.saveSettings();
          });
        });
    }

    // ── System Prompt ──
    containerEl.createEl('h2', { text: 'System Prompt' });

    new Setting(containerEl)
      .setName('Custom system prompt')
      .setDesc('Additional instructions appended to the default system prompt')
      .addTextArea(text => {
        text.inputEl.style.width = '100%';
        text.inputEl.style.height = '120px';
        text.setValue(this.plugin.settings.systemPrompt);
        text.onChange(async (value) => {
          this.plugin.settings.systemPrompt = value;
          await this.plugin.saveSettings();
        });
      });

    // ── Safety ──
    containerEl.createEl('h2', { text: 'Safety' });

    new Setting(containerEl)
      .setName('Enable command blocklist')
      .setDesc('Block dangerous bash commands')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.enableBlocklist);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableBlocklist = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Blocked commands')
      .setDesc('Patterns to block (one per line)')
      .addTextArea(text => {
        text.inputEl.style.width = '100%';
        text.inputEl.style.height = '80px';
        text.setValue(this.plugin.settings.blockedCommands.join('\n'));
        text.onChange(async (value) => {
          this.plugin.settings.blockedCommands = value
            .split('\n')
            .map(s => s.trim())
            .filter(s => s.length > 0);
          await this.plugin.saveSettings();
        });
      });

    // ── UI ──
    containerEl.createEl('h2', { text: 'Interface' });

    new Setting(containerEl)
      .setName('Auto-scroll')
      .setDesc('Automatically scroll to bottom during streaming')
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.enableAutoScroll);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableAutoScroll = value;
          await this.plugin.saveSettings();
        });
      });
  }
}
