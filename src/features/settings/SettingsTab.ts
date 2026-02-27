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
];

export class AgentSettingsTab extends PluginSettingTab {
  plugin: ObsidianAgentPlugin;

  constructor(app: App, plugin: ObsidianAgentPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Model Configuration
    containerEl.createEl('h2', { text: 'Model' });

    // Provider selector
    new Setting(containerEl)
      .setName('Provider')
      .setDesc('LLM provider to use')
      .addDropdown(dropdown => {
        const providers = WELL_KNOWN_PROVIDERS;
        for (const p of providers) {
          dropdown.addOption(p, p);
        }
        dropdown.setValue(this.plugin.settings.provider);
        dropdown.onChange(async (value) => {
          this.plugin.settings.provider = value;
          await this.plugin.saveSettings();
          this.display(); // Refresh to update model list
        });
      });

    // Model selector
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

    // API Keys
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

    // System Prompt
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

    // Safety
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

    // UI
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
