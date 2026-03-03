import { Notice, setIcon } from 'obsidian';

import type { SkillDefinition } from '../../../core/skills/types';
import type { SkillData } from '../../../core/skills/SkillStorage';
import type ObsidianAgentPlugin from '../../../main';
import { SkillModal } from './SkillModal';
import { parseFrontmatter, stripFrontmatter } from '../../../utils/frontmatter';
import type { SkillFrontmatter } from '../../../core/skills/types';

export class SkillsSettingsManager {
  private containerEl: HTMLElement;
  private plugin: ObsidianAgentPlugin;

  constructor(containerEl: HTMLElement, plugin: ObsidianAgentPlugin) {
    this.containerEl = containerEl;
    this.plugin = plugin;
    this.render();
  }

  private render() {
    this.containerEl.empty();

    // Header with actions
    const headerEl = this.containerEl.createDiv({ cls: 'oa-skill-header' });
    headerEl.createSpan({ text: 'Skills', cls: 'oa-skill-label' });

    const actionsEl = headerEl.createDiv({ cls: 'oa-skill-header-actions' });

    const refreshBtn = actionsEl.createEl('button', {
      cls: 'oa-mcp-action-btn',
      attr: { 'aria-label': 'Refresh', type: 'button' },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => { void this.refreshSkills(); });

    const addBtn = actionsEl.createEl('button', {
      cls: 'oa-mcp-action-btn',
      attr: { 'aria-label': 'Create skill', type: 'button' },
    });
    setIcon(addBtn, 'plus');
    addBtn.addEventListener('click', () => this.openCreateModal());

    // Skills list
    const skills = this.plugin.skillManager?.getSkills() ?? [];
    const diagnostics = this.plugin.skillManager?.getDiagnostics() ?? [];

    if (skills.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: 'oa-skill-empty' });
      emptyEl.setText('No skills found. Click + to create one, or place SKILL.md files in the configured directories.');
      return;
    }

    const listEl = this.containerEl.createDiv({ cls: 'oa-skill-list' });
    for (const skill of skills) {
      this.renderSkillItem(listEl, skill);
    }

    // Diagnostics
    if (diagnostics.length > 0) {
      const diagEl = this.containerEl.createDiv({ cls: 'oa-skill-diagnostics' });
      diagEl.createEl('p', {
        text: `⚠️ ${diagnostics.length} diagnostic(s):`,
        cls: 'oa-skill-diag-header',
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

  private renderSkillItem(listEl: HTMLElement, skill: SkillDefinition) {
    const itemEl = listEl.createDiv({ cls: 'oa-skill-item' });

    // Status dot
    const statusEl = itemEl.createDiv({ cls: 'oa-skill-status' });
    statusEl.addClass(
      skill.disableModelInvocation ? 'oa-skill-status-manual' : 'oa-skill-status-active',
    );

    // Info
    const infoEl = itemEl.createDiv({ cls: 'oa-skill-info' });

    const nameRow = infoEl.createDiv({ cls: 'oa-skill-name-row' });
    nameRow.createSpan({ cls: 'oa-skill-name', text: skill.name });

    if (skill.disableModelInvocation) {
      const badge = nameRow.createSpan({ cls: 'oa-skill-manual-badge' });
      badge.setText('manual');
      badge.setAttribute('title', 'Only invocable via /skill:' + skill.name);
    }

    infoEl.createDiv({
      cls: 'oa-skill-desc',
      text: skill.description,
    });

    // Actions
    const actionsEl = itemEl.createDiv({ cls: 'oa-skill-actions' });

    const editBtn = actionsEl.createEl('button', {
      cls: 'oa-mcp-action-btn',
      attr: { 'aria-label': 'Edit', type: 'button' },
    });
    setIcon(editBtn, 'pencil');
    editBtn.addEventListener('click', () => this.openEditModal(skill));

    const deleteBtn = actionsEl.createEl('button', {
      cls: 'oa-mcp-action-btn oa-mcp-delete-btn',
      attr: { 'aria-label': 'Delete', type: 'button' },
    });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.addEventListener('click', () => this.deleteSkill(skill));
  }

  private openCreateModal() {
    const modal = new SkillModal(
      this.plugin.app,
      null,
      async (data) => {
        await this.saveSkill(data);
      },
    );
    modal.open();
  }

  private async openEditModal(skill: SkillDefinition) {
    // Read current file content to get the prompt body
    let prompt = '';
    let disableModelInvocation = skill.disableModelInvocation;

    try {
      const content = await this.plugin.app.vault.adapter.read(skill.filePath);
      prompt = stripFrontmatter(content);

      // Also re-read frontmatter in case there are extra fields
      try {
        const { frontmatter } = parseFrontmatter<SkillFrontmatter>(content);
        disableModelInvocation = frontmatter['disable-model-invocation'] === true;
      } catch {
        // Keep defaults from skill definition
      }
    } catch {
      new Notice(`Could not read skill file: ${skill.filePath}`);
      return;
    }

    const data: SkillData = {
      name: skill.name,
      description: skill.description,
      prompt,
      disableModelInvocation,
    };

    const modal = new SkillModal(
      this.plugin.app,
      data,
      async (updatedData, oldName) => {
        await this.saveSkill(updatedData, oldName);
      },
    );
    modal.open();
  }

  private async saveSkill(data: SkillData, oldName?: string) {
    try {
      // Check for conflicts when creating new or renaming
      const isNew = !oldName;
      const isRename = oldName && oldName !== data.name;

      if (isNew || isRename) {
        const exists = await this.plugin.skillStorage.exists(data.name);
        if (exists) {
          new Notice(`Skill "${data.name}" already exists`);
          return;
        }
      }

      await this.plugin.skillStorage.save(data, oldName);
      await this.plugin.reloadSkillsAndBroadcast();
      this.render();
      new Notice(oldName ? `Skill "${data.name}" updated` : `Skill "${data.name}" created`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      new Notice(`Failed to save skill: ${msg}`);
    }
  }

  private async deleteSkill(skill: SkillDefinition) {
    if (!confirm(`Delete skill "${skill.name}"?`)) {
      return;
    }

    try {
      await this.plugin.skillStorage.delete(skill.name);
      await this.plugin.reloadSkillsAndBroadcast();
      this.render();
      new Notice(`Skill "${skill.name}" deleted`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      new Notice(`Failed to delete skill: ${msg}`);
    }
  }

  /** Manually reload skills from disk and re-render the list. */
  private async refreshSkills(): Promise<void> {
    try {
      await this.plugin.reloadSkillsAndBroadcast();
      this.render();
      new Notice('Skills refreshed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      new Notice(`Failed to refresh skills: ${msg}`);
    }
  }

  /** Refresh the list (call after external changes). */
  public refresh() {
    this.render();
  }
}
