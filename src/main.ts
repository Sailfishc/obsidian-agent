import { type Editor, type MarkdownView, Notice, Plugin } from 'obsidian';
import type { ObsidianAgentSettings } from './core/types';
import { DEFAULT_SETTINGS, VIEW_TYPE_AGENT } from './core/types';
import { ChatView } from './features/chat/ChatView';
import { InlineEditModal } from './features/inline-edit/InlineEditModal';
import { AgentSettingsTab } from './features/settings/SettingsTab';
import { buildCursorContext } from './utils/inlineEditContext';

export default class ObsidianAgentPlugin extends Plugin {
  settings: ObsidianAgentSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

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
    // Views are automatically cleaned up by Obsidian
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

    // Deep-merge nested objects that Object.assign won't handle correctly
    // (older installs may have partial, null, or missing customOpenAI)
    const loadedCustom = loaded?.customOpenAI && typeof loaded.customOpenAI === 'object'
      ? loaded.customOpenAI
      : {};
    this.settings.customOpenAI = Object.assign(
      {},
      DEFAULT_SETTINGS.customOpenAI,
      loadedCustom,
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);

    // Refresh chat view model display
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT);
    for (const leaf of leaves) {
      const view = leaf.view as ChatView;
      view.refreshModelDisplay?.();
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
