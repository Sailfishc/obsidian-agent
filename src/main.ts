import { Notice, Plugin } from 'obsidian';
import type { ObsidianAgentSettings } from './core/types';
import { DEFAULT_SETTINGS, VIEW_TYPE_AGENT } from './core/types';
import { ChatView } from './features/chat/ChatView';
import { AgentSettingsTab } from './features/settings/SettingsTab';

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
