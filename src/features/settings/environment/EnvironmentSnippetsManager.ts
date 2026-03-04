import { Notice, setIcon } from 'obsidian';

import type { EnvironmentSnippet } from '../../../core/types';
import type ObsidianAgentPlugin from '../../../main';
import { EnvironmentSnippetModal } from './EnvironmentSnippetModal';

export class EnvironmentSnippetsManager {
  private containerEl: HTMLElement;
  private plugin: ObsidianAgentPlugin;
  private onApply: () => void;

  constructor(containerEl: HTMLElement, plugin: ObsidianAgentPlugin, onApply: () => void) {
    this.containerEl = containerEl;
    this.plugin = plugin;
    this.onApply = onApply;
    this.render();
  }

  private render() {
    this.containerEl.empty();

    // Header with add button
    const headerEl = this.containerEl.createDiv({ cls: 'oa-env-snippet-header' });
    headerEl.createSpan({ text: 'Snippets', cls: 'oa-env-snippet-label' });

    const actionsEl = headerEl.createDiv({ cls: 'oa-env-snippet-header-actions' });

    const addBtn = actionsEl.createEl('button', {
      cls: 'oa-mcp-action-btn',
      attr: { 'aria-label': 'Save current as snippet', type: 'button' },
    });
    setIcon(addBtn, 'plus');
    addBtn.addEventListener('click', () => this.openCreateModal());

    // Snippet list
    const snippets = this.plugin.settings.environment.snippets;

    if (snippets.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: 'oa-env-snippet-empty' });
      emptyEl.setText('No saved environment snippets yet. Click + to save your current configuration.');
      return;
    }

    const listEl = this.containerEl.createDiv({ cls: 'oa-env-snippet-list' });
    for (const snippet of snippets) {
      this.renderSnippetItem(listEl, snippet);
    }
  }

  private renderSnippetItem(listEl: HTMLElement, snippet: EnvironmentSnippet) {
    const itemEl = listEl.createDiv({ cls: 'oa-env-snippet-item' });

    // Info
    const infoEl = itemEl.createDiv({ cls: 'oa-env-snippet-info' });
    infoEl.createDiv({ cls: 'oa-env-snippet-name', text: snippet.name });

    if (snippet.description) {
      infoEl.createDiv({ cls: 'oa-env-snippet-desc', text: snippet.description });
    }

    // Actions
    const actionsEl = itemEl.createDiv({ cls: 'oa-env-snippet-actions' });

    // Apply button
    const applyBtn = actionsEl.createEl('button', {
      cls: 'oa-mcp-action-btn',
      attr: { 'aria-label': 'Apply snippet', type: 'button' },
    });
    setIcon(applyBtn, 'check');
    applyBtn.addEventListener('click', () => this.applySnippet(snippet));

    // Edit button
    const editBtn = actionsEl.createEl('button', {
      cls: 'oa-mcp-action-btn',
      attr: { 'aria-label': 'Edit snippet', type: 'button' },
    });
    setIcon(editBtn, 'pencil');
    editBtn.addEventListener('click', () => this.openEditModal(snippet));

    // Delete button
    const deleteBtn = actionsEl.createEl('button', {
      cls: 'oa-mcp-action-btn oa-mcp-delete-btn',
      attr: { 'aria-label': 'Delete snippet', type: 'button' },
    });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.addEventListener('click', () => this.deleteSnippet(snippet));
  }

  private openCreateModal() {
    const env = this.plugin.settings.environment;
    const modal = new EnvironmentSnippetModal(
      this.plugin.app,
      null,
      {
        envText: env.envText,
        modelContextLimits: env.modelContextLimits,
      },
      async (snippet) => {
        await this.saveSnippet(snippet);
      },
    );
    modal.open();
  }

  private openEditModal(existing: EnvironmentSnippet) {
    const modal = new EnvironmentSnippetModal(
      this.plugin.app,
      existing,
      {
        envText: existing.envText,
        modelContextLimits: existing.modelContextLimits,
      },
      async (updated) => {
        await this.updateSnippet(existing.name, updated);
      },
    );
    modal.open();
  }

  private async saveSnippet(snippet: EnvironmentSnippet) {
    const snippets = this.plugin.settings.environment.snippets;
    const existingIdx = snippets.findIndex(s => s.name === snippet.name);
    if (existingIdx >= 0) {
      new Notice(`Snippet "${snippet.name}" already exists. Choose a different name or edit the existing one.`);
      return;
    }

    snippets.push(snippet);
    await this.plugin.saveSettings();
    this.render();
    new Notice(`Snippet "${snippet.name}" saved`);
  }

  private async updateSnippet(oldName: string, updated: EnvironmentSnippet) {
    const snippets = this.plugin.settings.environment.snippets;
    const idx = snippets.findIndex(s => s.name === oldName);
    if (idx < 0) {
      new Notice(`Snippet "${oldName}" not found`);
      return;
    }

    // Check for name conflict if renamed
    if (oldName !== updated.name) {
      const conflictIdx = snippets.findIndex(s => s.name === updated.name);
      if (conflictIdx >= 0) {
        new Notice(`Snippet "${updated.name}" already exists`);
        return;
      }
    }

    snippets[idx] = updated;
    await this.plugin.saveSettings();
    this.render();
    new Notice(`Snippet "${updated.name}" updated`);
  }

  private async applySnippet(snippet: EnvironmentSnippet) {
    const env = this.plugin.settings.environment;
    env.envText = snippet.envText;
    env.modelContextLimits = { ...snippet.modelContextLimits };

    await this.plugin.saveSettings();

    // Reset MCP connections so new env vars take effect
    await this.plugin.mcpToolAdapter?.reset();

    this.onApply();
    new Notice(`Applied snippet "${snippet.name}"`);
  }

  private async deleteSnippet(snippet: EnvironmentSnippet) {
    if (!confirm(`Delete snippet "${snippet.name}"?`)) {
      return;
    }

    const snippets = this.plugin.settings.environment.snippets;
    const idx = snippets.findIndex(s => s.name === snippet.name);
    if (idx >= 0) {
      snippets.splice(idx, 1);
      await this.plugin.saveSettings();
      this.render();
      new Notice(`Snippet "${snippet.name}" deleted`);
    }
  }

  public refresh() {
    this.render();
  }
}
