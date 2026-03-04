import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import type { EnvironmentSnippet } from '../../../core/types';

export class EnvironmentSnippetModal extends Modal {
  private onSave: (snippet: EnvironmentSnippet) => void;
  private existingSnippet: EnvironmentSnippet | null;

  private snippetName = '';
  private description = '';
  private envText = '';
  private modelContextLimits: Record<string, number> = {};

  constructor(
    app: App,
    existing: EnvironmentSnippet | null,
    currentEnv: { envText: string; modelContextLimits: Record<string, number> },
    onSave: (snippet: EnvironmentSnippet) => void,
  ) {
    super(app);
    this.existingSnippet = existing;
    this.onSave = onSave;

    if (existing) {
      this.snippetName = existing.name;
      this.description = existing.description;
      this.envText = existing.envText;
      this.modelContextLimits = { ...existing.modelContextLimits };
    } else {
      // Pre-fill with current environment settings
      this.envText = currentEnv.envText;
      this.modelContextLimits = { ...currentEnv.modelContextLimits };
    }
  }

  onOpen() {
    this.setTitle(this.existingSnippet ? 'Edit Snippet' : 'Save Snippet');
    this.modalEl.addClass('oa-env-snippet-modal');

    const { contentEl } = this;

    // Name
    new Setting(contentEl)
      .setName('Name')
      .setDesc('A descriptive name for this environment configuration')
      .addText((text) => {
        text.setValue(this.snippetName);
        text.setPlaceholder('e.g., Production API keys');
        text.inputEl.style.width = '100%';
        text.onChange((value) => {
          this.snippetName = value;
        });
        text.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            this.save();
          }
        });
      });

    // Description
    new Setting(contentEl)
      .setName('Description')
      .setDesc('Optional description')
      .addText((text) => {
        text.inputEl.style.width = '100%';
        text.setValue(this.description);
        text.setPlaceholder('API keys for production environment');
        text.onChange((value) => {
          this.description = value;
        });
      });

    // Environment variables
    new Setting(contentEl)
      .setName('Environment variables')
      .setDesc('KEY=VALUE format, one per line (export prefix supported)');

    const envTextarea = contentEl.createEl('textarea', {
      cls: 'oa-env-textarea',
    });
    envTextarea.value = this.envText;
    envTextarea.placeholder = 'ANTHROPIC_API_KEY=sk-ant-...\nOPENAI_API_KEY=sk-...';
    envTextarea.rows = 8;
    envTextarea.addEventListener('input', () => {
      this.envText = envTextarea.value;
    });

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: 'oa-env-snippet-buttons' });

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = buttonContainer.createEl('button', {
      text: this.existingSnippet ? 'Update' : 'Save',
      cls: 'mod-cta',
    });
    saveBtn.addEventListener('click', () => this.save());
  }

  private save() {
    const name = this.snippetName.trim();

    if (!name) {
      new Notice('Please enter a snippet name');
      return;
    }

    const snippet: EnvironmentSnippet = {
      name,
      description: this.description.trim(),
      envText: this.envText,
      modelContextLimits: { ...this.modelContextLimits },
    };

    this.onSave(snippet);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
