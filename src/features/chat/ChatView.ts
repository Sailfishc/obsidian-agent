import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { AgentService } from '../../core/agent/AgentService';
import type { ChatMessage, ContentBlock, StreamChunk, ToolCallInfo } from '../../core/types';
import { VIEW_TYPE_AGENT } from '../../core/types';
import { getVaultPath } from '../../utils/path';
import { generateId } from '../../utils/id';
import { renderAssistantMessage, renderUserMessage } from './rendering/messageRenderer';
import { StreamRenderer } from './rendering/streamRenderer';
import { InputArea } from './ui/InputArea';

export class ChatView extends ItemView {
  private plugin: ObsidianAgentPlugin;
  private agentService: AgentService | null = null;
  private messages: ChatMessage[] = [];

  private rootEl: HTMLElement;
  private headerEl: HTMLElement;
  private messagesEl: HTMLElement;
  private inputArea: InputArea;
  private streamRenderer: StreamRenderer | null = null;
  private isStreaming = false;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianAgentPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_AGENT;
  }

  getDisplayText(): string {
    return 'Obsidian Agent';
  }

  getIcon(): string {
    return 'bot';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('oa-container');

    this.rootEl = container.createDiv({ cls: 'oa-root' });

    // Header
    this.headerEl = this.rootEl.createDiv({ cls: 'oa-header' });
    const titleEl = this.headerEl.createDiv({ cls: 'oa-header-title' });
    titleEl.createSpan({ text: 'Obsidian Agent' });

    const actionsEl = this.headerEl.createDiv({ cls: 'oa-header-actions' });
    const newChatBtn = actionsEl.createEl('button', {
      cls: 'oa-btn oa-btn-icon clickable-icon',
      attr: { 'aria-label': 'New chat' },
    });
    newChatBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    newChatBtn.addEventListener('click', () => this.newChat());

    // Model indicator
    const modelEl = this.headerEl.createDiv({ cls: 'oa-header-model' });
    modelEl.createSpan({
      text: `${this.plugin.settings.provider}/${this.plugin.settings.modelId}`,
      cls: 'oa-model-label',
    });

    // Messages area
    this.messagesEl = this.rootEl.createDiv({ cls: 'oa-messages' });

    // Welcome message
    this.renderWelcome();

    // Input area
    this.inputArea = new InputArea(this.rootEl, {
      onSend: (text) => this.handleSend(text),
      onCancel: () => this.handleCancel(),
    });

    // Initialize agent service
    this.initAgentService();
  }

  async onClose(): Promise<void> {
    if (this.agentService) {
      this.agentService.cancel();
    }
  }

  private initAgentService(): void {
    const vaultPath = getVaultPath(this.app);
    if (!vaultPath) {
      new Notice('Could not determine vault path');
      return;
    }

    this.agentService = new AgentService(vaultPath, this.plugin.settings);
  }

  private renderWelcome(): void {
    if (this.messages.length > 0) return;

    const welcomeEl = this.messagesEl.createDiv({ cls: 'oa-welcome' });
    welcomeEl.createEl('h3', { text: 'Obsidian Agent' });
    welcomeEl.createEl('p', {
      text: 'Ask me to read, edit, or create files in your vault. I can also run bash commands and search through your notes.',
    });

    const tipsEl = welcomeEl.createDiv({ cls: 'oa-welcome-tips' });
    const tips = [
      'Read and summarize notes',
      'Edit or refactor code',
      'Search across your vault',
      'Run shell commands',
      'Create new files',
    ];
    for (const tip of tips) {
      tipsEl.createDiv({ cls: 'oa-welcome-tip', text: tip });
    }
  }

  private async handleSend(text: string): Promise<void> {
    if (this.isStreaming || !this.agentService) return;

    // Ensure agent service has latest settings
    this.agentService.updateSettings(this.plugin.settings);

    // Clear welcome
    const welcomeEl = this.messagesEl.querySelector('.oa-welcome');
    if (welcomeEl) welcomeEl.remove();

    // Add user message
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    this.messages.push(userMessage);
    renderUserMessage(this.messagesEl, userMessage);
    this.scrollToBottom();

    // Start streaming
    this.isStreaming = true;
    this.inputArea.setStreaming(true);

    const startTime = Date.now();
    this.streamRenderer = new StreamRenderer(this.messagesEl, () => {
      if (this.plugin.settings.enableAutoScroll) {
        this.scrollToBottom();
      }
    });

    try {
      for await (const chunk of this.agentService.query(text)) {
        if (!this.isStreaming) break;

        this.streamRenderer.processChunk(chunk);

        if (chunk.type === 'done' || chunk.type === 'error') {
          break;
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.streamRenderer.processChunk({ type: 'error', content: errorMsg });
    }

    // Finalize
    const result = this.streamRenderer.finalize();
    const durationSeconds = (Date.now() - startTime) / 1000;

    const contentBlocks: ContentBlock[] = [];
    if (result.thinking) {
      contentBlocks.push({ type: 'thinking', content: result.thinking });
    }
    for (const tc of result.toolCalls) {
      contentBlocks.push({ type: 'tool_use', toolId: tc.id });
    }
    if (result.text) {
      contentBlocks.push({ type: 'text', content: result.text });
    }

    const assistantMessage: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: result.text,
      timestamp: Date.now(),
      toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
      contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
      durationSeconds,
    };
    this.messages.push(assistantMessage);

    this.isStreaming = false;
    this.streamRenderer = null;
    this.inputArea.setStreaming(false);
    this.scrollToBottom();
  }

  private handleCancel(): void {
    if (this.agentService && this.isStreaming) {
      this.agentService.cancel();
      this.isStreaming = false;

      if (this.streamRenderer) {
        this.streamRenderer.finalize();
        this.streamRenderer = null;
      }

      this.inputArea.setStreaming(false);
    }
  }

  private newChat(): void {
    if (this.isStreaming) {
      this.handleCancel();
    }

    this.messages = [];
    this.messagesEl.empty();
    this.renderWelcome();

    if (this.agentService) {
      this.agentService.resetSession();
    }

    this.inputArea.focus();
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  refreshModelDisplay(): void {
    const modelLabel = this.headerEl?.querySelector('.oa-model-label');
    if (modelLabel) {
      modelLabel.textContent = `${this.plugin.settings.provider}/${this.plugin.settings.modelId}`;
    }
  }
}
