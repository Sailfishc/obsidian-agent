import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import type { SkillData } from '../../../core/skills/SkillStorage';

export class SkillModal extends Modal {
  private onSave: (data: SkillData, oldName?: string) => void;
  private existingData: SkillData | null;

  private skillName = '';
  private description = '';
  private prompt = '';
  private disableModelInvocation = false;

  private nameInputEl: HTMLInputElement | null = null;

  constructor(
    app: App,
    existing: SkillData | null,
    onSave: (data: SkillData, oldName?: string) => void,
  ) {
    super(app);
    this.existingData = existing;
    this.onSave = onSave;

    if (existing) {
      this.skillName = existing.name;
      this.description = existing.description;
      this.prompt = existing.prompt;
      this.disableModelInvocation = existing.disableModelInvocation;
    }
  }

  onOpen() {
    this.setTitle(this.existingData ? 'Edit Skill' : 'Create Skill');
    this.modalEl.addClass('oa-skill-modal');

    const { contentEl } = this;

    // Name
    new Setting(contentEl)
      .setName('Name')
      .setDesc('Lowercase letters, numbers, and hyphens (e.g. code-review)')
      .addText((text) => {
        this.nameInputEl = text.inputEl;
        text.setValue(this.skillName);
        text.setPlaceholder('my-skill');
        text.onChange((value) => {
          this.skillName = value;
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
      .setDesc('Short description of what this skill does (shown in autocomplete)')
      .addText((text) => {
        text.inputEl.style.width = '100%';
        text.setValue(this.description);
        text.setPlaceholder('Reviews code for common issues');
        text.onChange((value) => {
          this.description = value;
        });
      });

    // Prompt
    const promptSetting = new Setting(contentEl)
      .setName('Instructions')
      .setDesc('The skill instructions (markdown). This becomes the body of SKILL.md.');

    const promptTextarea = promptSetting.controlEl.createEl('textarea', {
      cls: 'oa-skill-textarea',
    });
    promptTextarea.value = this.prompt;
    promptTextarea.placeholder = 'You are a code reviewer. Analyze the provided code for...';
    promptTextarea.rows = 10;
    promptTextarea.addEventListener('input', () => {
      this.prompt = promptTextarea.value;
    });

    // Advanced section
    new Setting(contentEl)
      .setName('Disable model invocation')
      .setDesc('When enabled, the agent cannot auto-invoke this skill — only /skill:name works')
      .addToggle((toggle) => {
        toggle.setValue(this.disableModelInvocation);
        toggle.onChange((value) => {
          this.disableModelInvocation = value;
        });
      });

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: 'oa-skill-buttons' });

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = buttonContainer.createEl('button', {
      text: this.existingData ? 'Update' : 'Create',
      cls: 'mod-cta',
    });
    saveBtn.addEventListener('click', () => this.save());
  }

  private save() {
    const name = this.skillName.trim().toLowerCase();

    if (!name) {
      new Notice('Please enter a skill name');
      this.nameInputEl?.focus();
      return;
    }

    if (!/^[a-z0-9-]+$/.test(name)) {
      new Notice('Name must only contain lowercase letters, numbers, and hyphens');
      this.nameInputEl?.focus();
      return;
    }

    if (name.startsWith('-') || name.endsWith('-') || name.includes('--')) {
      new Notice('Name must not start/end with a hyphen or contain consecutive hyphens');
      this.nameInputEl?.focus();
      return;
    }

    if (name.length > 64) {
      new Notice('Name must be 64 characters or less');
      this.nameInputEl?.focus();
      return;
    }

    const description = this.description.trim();
    if (!description) {
      new Notice('Please enter a description');
      return;
    }

    const data: SkillData = {
      name,
      description,
      prompt: this.prompt,
      disableModelInvocation: this.disableModelInvocation,
    };

    const oldName = this.existingData?.name;
    this.onSave(data, oldName);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
