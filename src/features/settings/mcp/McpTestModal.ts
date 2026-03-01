import type { App } from 'obsidian';
import { Modal, Notice, setIcon } from 'obsidian';

import type { McpTestResult, McpTool } from '../../../core/mcp/McpTester';

export class McpTestModal extends Modal {
  private serverName: string;
  private result: McpTestResult | null = null;
  private loading = true;
  private contentEl_: HTMLElement | null = null;
  private disabledTools: Set<string>;
  private onToolToggle?: (toolName: string, enabled: boolean) => Promise<void>;
  private onBulkToggle?: (disabledTools: string[]) => Promise<void>;
  private toolToggles: Map<string, { checkbox: HTMLInputElement; container: HTMLElement }> = new Map();
  private toolElements: Map<string, HTMLElement> = new Map();
  private toggleAllBtn: HTMLButtonElement | null = null;
  private pendingToggle = false;

  constructor(
    app: App,
    serverName: string,
    initialDisabledTools?: string[],
    onToolToggle?: (toolName: string, enabled: boolean) => Promise<void>,
    onBulkToggle?: (disabledTools: string[]) => Promise<void>,
  ) {
    super(app);
    this.serverName = serverName;
    this.disabledTools = new Set(
      (initialDisabledTools ?? [])
        .map((tool) => tool.trim())
        .filter((tool) => tool.length > 0)
    );
    this.onToolToggle = onToolToggle;
    this.onBulkToggle = onBulkToggle;
  }

  onOpen() {
    this.setTitle(`Verify: ${this.serverName}`);
    this.modalEl.addClass('oa-mcp-test-modal');
    this.contentEl_ = this.contentEl;
    this.renderLoading();
  }

  setResult(result: McpTestResult) {
    this.result = result;
    this.loading = false;
    this.render();
  }

  setError(error: string) {
    this.result = { success: false, tools: [], error };
    this.loading = false;
    this.render();
  }

  private renderLoading() {
    if (!this.contentEl_) return;
    this.contentEl_.empty();

    const loadingEl = this.contentEl_.createDiv({ cls: 'oa-mcp-test-loading' });
    loadingEl.createSpan({ text: '⏳ Connecting to MCP server...' });
  }

  private render() {
    if (!this.contentEl_) return;
    this.contentEl_.empty();

    if (!this.result) {
      this.renderLoading();
      return;
    }

    const statusEl = this.contentEl_.createDiv({ cls: 'oa-mcp-test-status' });

    const iconEl = statusEl.createSpan({ cls: 'oa-mcp-test-icon' });
    if (this.result.success) {
      setIcon(iconEl, 'check-circle');
      iconEl.addClass('oa-mcp-test-success');
    } else {
      setIcon(iconEl, 'x-circle');
      iconEl.addClass('oa-mcp-test-error');
    }

    const textEl = statusEl.createSpan({ cls: 'oa-mcp-test-text' });
    if (this.result.success) {
      let statusText = 'Connected successfully';
      if (this.result.serverName) {
        statusText += ` to ${this.result.serverName}`;
        if (this.result.serverVersion) {
          statusText += ` v${this.result.serverVersion}`;
        }
      }
      textEl.setText(statusText);
    } else {
      textEl.setText('Connection failed');
    }

    if (this.result.error) {
      const errorEl = this.contentEl_.createDiv({ cls: 'oa-mcp-test-error-msg' });
      errorEl.setText(this.result.error);
    }

    this.toolToggles.clear();
    this.toolElements.clear();

    if (this.result.tools.length > 0) {
      const toolsSection = this.contentEl_.createDiv({ cls: 'oa-mcp-test-tools' });

      const toolsHeader = toolsSection.createDiv({ cls: 'oa-mcp-test-tools-header' });
      toolsHeader.setText(`Available Tools (${this.result.tools.length})`);

      const toolsList = toolsSection.createDiv({ cls: 'oa-mcp-test-tools-list' });

      for (const tool of this.result.tools) {
        this.renderTool(toolsList, tool);
      }
    } else if (this.result.success) {
      const noToolsEl = this.contentEl_.createDiv({ cls: 'oa-mcp-test-no-tools' });
      noToolsEl.setText('No tools available from this server.');
    }

    const buttonContainer = this.contentEl_.createDiv({ cls: 'oa-mcp-test-buttons' });

    if (this.result.tools.length > 0 && this.onToolToggle) {
      this.toggleAllBtn = buttonContainer.createEl('button', {
        cls: 'oa-mcp-toggle-all-btn',
      });
      this.updateToggleAllButton();
      this.toggleAllBtn.addEventListener('click', () => this.handleToggleAll());
    }

    const closeBtn = buttonContainer.createEl('button', {
      text: 'Close',
      cls: 'mod-cta',
    });
    closeBtn.addEventListener('click', () => this.close());
  }

  private renderTool(container: HTMLElement, tool: McpTool) {
    const toolEl = container.createDiv({ cls: 'oa-mcp-test-tool' });

    const headerEl = toolEl.createDiv({ cls: 'oa-mcp-test-tool-header' });

    const iconEl = headerEl.createSpan({ cls: 'oa-mcp-test-tool-icon' });
    setIcon(iconEl, 'wrench');

    const nameEl = headerEl.createSpan({ cls: 'oa-mcp-test-tool-name' });
    nameEl.setText(tool.name);

    const toggleEl = headerEl.createDiv({ cls: 'oa-mcp-test-tool-toggle' });
    const toggleContainer = toggleEl.createDiv({ cls: 'checkbox-container' });
    const checkbox = toggleContainer.createEl('input', {
      type: 'checkbox',
      attr: { tabindex: '0' },
    });

    const isEnabled = !this.disabledTools.has(tool.name);
    checkbox.checked = isEnabled;
    toggleContainer.toggleClass('is-enabled', isEnabled);
    toolEl.toggleClass('oa-mcp-test-tool-disabled', !isEnabled);

    this.toolToggles.set(tool.name, { checkbox, container: toggleContainer });
    this.toolElements.set(tool.name, toolEl);

    if (!this.onToolToggle) {
      checkbox.disabled = true;
    } else {
      toggleContainer.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (checkbox.disabled) return;
        checkbox.checked = !checkbox.checked;
        this.handleToolToggle(tool.name, checkbox, toggleContainer);
      });
    }

    if (tool.description) {
      const descEl = toolEl.createDiv({ cls: 'oa-mcp-test-tool-desc' });
      descEl.setText(tool.description);
    }
  }

  private async handleToolToggle(
    toolName: string,
    checkbox: HTMLInputElement,
    container: HTMLElement,
  ) {
    const toolEl = this.toolElements.get(toolName);
    if (!toolEl) return;

    const wasDisabled = this.disabledTools.has(toolName);
    const nextDisabled = !checkbox.checked;

    if (nextDisabled) {
      this.disabledTools.add(toolName);
    } else {
      this.disabledTools.delete(toolName);
    }

    container.toggleClass('is-enabled', !nextDisabled);
    toolEl.toggleClass('oa-mcp-test-tool-disabled', nextDisabled);
    this.updateToggleAllButton();
    checkbox.disabled = true;

    try {
      await this.onToolToggle?.(toolName, !nextDisabled);
    } catch (error) {
      // Rollback
      if (nextDisabled) {
        this.disabledTools.delete(toolName);
      } else {
        this.disabledTools.add(toolName);
      }
      checkbox.checked = !wasDisabled;
      container.toggleClass('is-enabled', !wasDisabled);
      toolEl.toggleClass('oa-mcp-test-tool-disabled', wasDisabled);
      this.updateToggleAllButton();
      new Notice(error instanceof Error ? error.message : 'Failed to update tool setting');
    } finally {
      checkbox.disabled = false;
    }
  }

  private updateToggleAllButton() {
    if (!this.toggleAllBtn || !this.result) return;

    const allEnabled = this.disabledTools.size === 0;

    if (allEnabled) {
      this.toggleAllBtn.setText('Disable All');
    } else {
      this.toggleAllBtn.setText('Enable All');
    }
  }

  private async handleToggleAll() {
    if (!this.result || this.pendingToggle || !this.onBulkToggle) return;

    const allEnabled = this.disabledTools.size === 0;
    const previousDisabled = new Set(this.disabledTools);

    const newDisabledTools: string[] = allEnabled
      ? this.result.tools.map((t) => t.name)
      : [];

    this.pendingToggle = true;
    if (this.toggleAllBtn) this.toggleAllBtn.disabled = true;

    for (const { checkbox } of this.toolToggles.values()) {
      checkbox.disabled = true;
    }

    // Optimistic UI update
    this.disabledTools = new Set(newDisabledTools);
    for (const tool of this.result.tools) {
      const toggle = this.toolToggles.get(tool.name);
      const toolEl = this.toolElements.get(tool.name);
      if (!toggle || !toolEl) continue;

      const isEnabled = !this.disabledTools.has(tool.name);
      toggle.checkbox.checked = isEnabled;
      toggle.container.toggleClass('is-enabled', isEnabled);
      toolEl.toggleClass('oa-mcp-test-tool-disabled', !isEnabled);
    }
    this.updateToggleAllButton();

    try {
      await this.onBulkToggle(newDisabledTools);
    } catch (error) {
      this.disabledTools = previousDisabled;
      for (const tool of this.result.tools) {
        const toggle = this.toolToggles.get(tool.name);
        const toolEl = this.toolElements.get(tool.name);
        if (!toggle || !toolEl) continue;

        const isEnabled = !this.disabledTools.has(tool.name);
        toggle.checkbox.checked = isEnabled;
        toggle.container.toggleClass('is-enabled', isEnabled);
        toolEl.toggleClass('oa-mcp-test-tool-disabled', !isEnabled);
      }
      this.updateToggleAllButton();
      new Notice(error instanceof Error ? error.message : 'Failed to update tool settings');
    }

    for (const { checkbox } of this.toolToggles.values()) {
      checkbox.disabled = false;
    }

    this.pendingToggle = false;
    if (this.toggleAllBtn) this.toggleAllBtn.disabled = false;
  }

  onClose() {
    this.contentEl.empty();
  }
}
