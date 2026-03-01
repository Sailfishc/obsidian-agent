import { ItemView, MarkdownView, Notice, TFile, type WorkspaceLeaf } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { AgentService } from '../../core/agent/AgentService';
import { ConversationStore } from '../../core/storage/ConversationStore';
import type { ChatMessage, ContentBlock, ContextFile, Conversation, ObsidianAgentSettings, StreamChunk, ToolCallInfo } from '../../core/types';
import { VIEW_TYPE_AGENT } from '../../core/types';
import { getVaultPath } from '../../utils/path';
import { generateId } from '../../utils/id';
import { renderAssistantMessage, renderAssistantMessageInto, renderUserMessage, type AssistantMessageActions } from './rendering/messageRenderer';
import { StreamRenderer } from './rendering/streamRenderer';
import { InputArea } from './ui/InputArea';
import { ConversationList } from './ui/ConversationList';
import { VaultFileSuggestModal } from './ui/VaultFileSuggestModal';



export class ChatView extends ItemView {
  private plugin: ObsidianAgentPlugin;
  private agentService: AgentService | null = null;
  private messages: ChatMessage[] = [];

  private rootEl: HTMLElement;
  private messagesEl: HTMLElement;
  private inputArea: InputArea;
  private streamRenderer: StreamRenderer | null = null;
  private isStreaming = false;

  // ── Multi-file context state ──────────────────────────────────────────

  /** Whether to auto-include the active file as context. Resets on newChat(). */
  private includeActiveFile = true;
  /** Vault-relative path of the currently active file (tracked for auto-include). */
  private activeFilePath: string | null = null;
  /** User-added context file paths via @ search. */
  private manualContextPaths = new Set<string>();

  /** Becomes true after the first message is sent in the current session. */
  private sessionStarted = false;

  /** Most recently focused MarkdownView (for insert-at-cursor). */
  private lastMarkdownView: MarkdownView | null = null;

  // ── Persistence ───────────────────────────────────────────────────────
  private conversationStore: ConversationStore;
  private currentConversationId: string | null = null;
  private conversationList: ConversationList | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianAgentPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.conversationStore = new ConversationStore(this.app);
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

    // Messages area (clean — no header controls)
    this.messagesEl = this.rootEl.createDiv({ cls: 'oa-messages' });

    // Welcome message
    this.renderWelcome();

    // Input area (controls row + context chips + textarea + status footer + buttons)
    this.inputArea = new InputArea(this.rootEl, {
      onSend: (text) => this.handleSend(text),
      onCancel: () => this.handleCancel(),
      onTriggerContextSearch: () => this.openContextSearch(),
      onRemoveContextFile: (path) => this.removeContextPath(path),
      onOpenContextFile: (path) => this.openFileByPath(path),
    });

    // ── Mount controls into the input area's controls row ────────────────
    const controlsLeft = this.inputArea.getControlsLeftEl();
    const controlsRight = this.inputArea.getControlsRightEl();

    // Conversation dropdown (left side)
    const convTriggerContainer = controlsLeft.createDiv({ cls: 'oa-controls-conv' });
    this.conversationList = new ConversationList(convTriggerContainer, {
      onSelect: (id) => this.loadConversation(id),
      onDelete: (id) => this.deleteConversation(id),
      onNew: () => this.newChat(),
    }, { placement: 'up' });

    // History button (right side)
    const historyBtn = controlsRight.createEl('button', {
      cls: 'oa-btn oa-btn-icon clickable-icon',
      attr: { 'aria-label': 'Chat history' },
    });
    historyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
    historyBtn.addEventListener('click', (e) => this.conversationList?.toggleOpen(e));
    // Register as anchor so clicks don't instantly close the popover
    this.conversationList.registerAnchor(historyBtn);

    // New chat button (right side)
    const newChatBtn = controlsRight.createEl('button', {
      cls: 'oa-btn oa-btn-icon clickable-icon',
      attr: { 'aria-label': 'New chat' },
    });
    newChatBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    newChatBtn.addEventListener('click', () => this.newChat());

    // Capture active file context on first open
    this.sessionStarted = false;
    this.includeActiveFile = this.plugin.settings.context.includeActiveFileByDefault;
    this.captureActiveFileAsContext();

    // Track last focused MarkdownView for insert-at-cursor
    this.lastMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          this.lastMarkdownView = view;
        }
      }),
    );

    // Update status bar
    this.refreshStatusDisplay();

    // Listen for file-open events: auto-update context until session starts
    this.registerFileOpenListener();

    // Initialize agent service
    this.initAgentService();

    // Initialize persistence: ensure dir, load list, restore last conversation
    await this.initPersistence();
  }

  async onClose(): Promise<void> {
    if (this.agentService) {
      this.agentService.cancel();
    }
    if (this.conversationList) {
      this.conversationList.destroy();
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

  // ── Multi-file context management ─────────────────────────────────────

  /** Capture the currently active file and display it as context. */
  private captureActiveFileAsContext(): void {
    const active = this.app.workspace.getActiveFile();
    this.activeFilePath = active?.path ?? null;

    // Check excluded tags — if active file has an excluded tag, disable auto-include
    if (this.includeActiveFile && this.activeFilePath) {
      this.checkExcludedTags(this.activeFilePath);
    }

    this.syncContextChips();
  }

  /**
   * Check if a file's frontmatter contains any excluded tags.
   * If so, disable auto-include for this file.
   */
  private checkExcludedTags(path: string): void {
    const excludedTags = this.plugin.settings.context.excludedTags;
    if (excludedTags.length === 0) return;

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;

    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter) return;

    // Obsidian stores tags in frontmatter as 'tags' (array or string) or 'tag'
    const fmTags = cache.frontmatter.tags ?? cache.frontmatter.tag;
    if (!fmTags) return;

    const tagList: string[] = Array.isArray(fmTags)
      ? fmTags.map((t: any) => String(t).replace(/^#/, '').toLowerCase())
      : String(fmTags).split(',').map(t => t.trim().replace(/^#/, '').toLowerCase());

    const normalizedExcluded = excludedTags.map(t => t.toLowerCase());

    const hasExcluded = tagList.some(t => normalizedExcluded.includes(t));
    if (hasExcluded) {
      this.includeActiveFile = false;
    }
  }

  /** Compute the full list of context paths and push them to the UI. */
  private syncContextChips(): void {
    const paths: string[] = [];

    if (this.includeActiveFile && this.activeFilePath) {
      paths.push(this.activeFilePath);
    }
    for (const p of this.manualContextPaths) {
      paths.push(p);
    }

    // De-dupe while preserving order
    const unique = [...new Set(paths)];
    this.inputArea.setContextFiles(unique);
  }

  /** Remove a context path (active file or manually added). */
  private removeContextPath(path: string): void {
    if (this.activeFilePath === path && this.includeActiveFile) {
      // Removing the active file chip disables auto-include until newChat()
      this.includeActiveFile = false;
    } else {
      this.manualContextPaths.delete(path);
    }
    this.syncContextChips();
  }

  /** Open the vault file search modal (triggered by @). */
  private openContextSearch(): void {
    const maxContextFiles = this.plugin.settings.context.limits.maxContextFiles;
    if (this.manualContextPaths.size + (this.includeActiveFile && this.activeFilePath ? 1 : 0) >= maxContextFiles) {
      new Notice(`Maximum ${maxContextFiles} context files allowed`);
      return;
    }

    const modal = new VaultFileSuggestModal(this.app, {
      excludePaths: new Set([
        ...(this.includeActiveFile && this.activeFilePath ? [this.activeFilePath] : []),
        ...this.manualContextPaths,
      ]),
      onChoose: (file) => {
        this.manualContextPaths.add(file.path);
        this.syncContextChips();
      },
    });
    modal.open();
  }

  /** Open a vault file by its path. */
  private openFileByPath(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      if (leaf) {
        leaf.openFile(file);
      }
    }
  }

  /**
   * Auto-update the active file context when the user opens a different file,
   * but only before the first message is sent and only if auto-include is on.
   */
  private registerFileOpenListener(): void {
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (!this.sessionStarted && !this.isStreaming && this.includeActiveFile && file instanceof TFile) {
          this.activeFilePath = file.path;
          this.syncContextChips();
        }
      }),
    );
  }

  // ── Context file reading ──────────────────────────────────────────────

  /** Get de-duped list of all selected context paths. */
  private getSelectedContextPaths(): string[] {
    const paths: string[] = [];
    if (this.includeActiveFile && this.activeFilePath) paths.push(this.activeFilePath);
    paths.push(...this.manualContextPaths);
    return [...new Set(paths)];
  }

  /** Read selected context files from the vault, applying size limits. */
  private async buildContextFiles(): Promise<ContextFile[]> {
    const paths = this.getSelectedContextPaths();
    const contextFiles: ContextFile[] = [];
    let totalChars = 0;
    const { maxCharsPerFile, maxTotalChars } = this.plugin.settings.context.limits;

    for (const path of paths) {
      const abstractFile = this.app.vault.getAbstractFileByPath(path);
      if (!(abstractFile instanceof TFile)) continue;

      try {
        let content = await this.app.vault.cachedRead(abstractFile);

        // Per-file truncation
        if (content.length > maxCharsPerFile) {
          content = content.slice(0, maxCharsPerFile) + '\n\n[TRUNCATED]';
        }

        // Total budget check
        if (totalChars + content.length > maxTotalChars) {
          const remaining = maxTotalChars - totalChars;
          if (remaining > 0) {
            content = content.slice(0, remaining) + '\n\n[TRUNCATED]';
            contextFiles.push({ path, content });
          }
          break;
        }

        totalChars += content.length;
        contextFiles.push({ path, content });
      } catch (err) {
        console.warn(`[obsidian-agent] Failed to read context file: ${path}`, err);
      }
    }

    return contextFiles;
  }

  // ── Persistence ───────────────────────────────────────────────────────

  /** Initialize storage, load conversation list, restore last session. */
  private async initPersistence(): Promise<void> {
    try {
      await this.conversationStore.ensureBaseDir();
      await this.refreshConversationList();

      // Restore last conversation
      const lastId = this.plugin.settings.lastConversationId;
      if (lastId) {
        await this.loadConversation(lastId);
      }
    } catch (err) {
      console.error('[obsidian-agent] Failed to initialize persistence:', err);
    }
  }

  /** Refresh the conversation list UI from storage. */
  private async refreshConversationList(): Promise<void> {
    try {
      const items = await this.conversationStore.listConversations();
      this.conversationList?.setItems(items);
      this.conversationList?.setActive(this.currentConversationId);
    } catch (err) {
      console.error('[obsidian-agent] Failed to list conversations:', err);
    }
  }

  /**
   * Ensure a conversation exists for the current session.
   * Lazily creates one on first message send.
   */
  private async ensureConversation(firstMessageText?: string): Promise<string> {
    if (this.currentConversationId) {
      return this.currentConversationId;
    }

    const title = firstMessageText
      ? ConversationStore.generateTitle(firstMessageText)
      : 'New chat';

    const conv = await this.conversationStore.createConversation({ title });
    this.currentConversationId = conv.id;

    // Persist the last conversation ID
    this.plugin.settings.lastConversationId = conv.id;
    await this.plugin.saveSettings();

    // Update UI
    await this.refreshConversationList();

    return conv.id;
  }

  /** Load a conversation from storage and render it. */
  private async loadConversation(id: string): Promise<void> {
    if (this.isStreaming) {
      new Notice('Cannot switch conversations while streaming');
      return;
    }

    const conv = await this.conversationStore.loadConversation(id);
    if (!conv) {
      new Notice('Conversation not found');
      // Clean up stale reference
      if (this.plugin.settings.lastConversationId === id) {
        this.plugin.settings.lastConversationId = null;
        await this.plugin.saveSettings();
      }
      await this.refreshConversationList();
      return;
    }

    // Set state
    this.currentConversationId = conv.id;
    this.messages = conv.messages;
    this.sessionStarted = conv.messages.length > 0;

    // Reset agent session (v1: no context restoration)
    if (this.agentService) {
      this.agentService.resetSession();
    }

    // Re-render messages
    this.messagesEl.empty();
    if (conv.messages.length === 0) {
      this.renderWelcome();
    } else {
      const renderOpts = {
        showThinkingBlocks: this.plugin.settings.appearance.showThinkingBlocks,
        showToolBlocks: this.plugin.settings.appearance.showToolBlocks,
      };
      for (const msg of conv.messages) {
        if (msg.role === 'user') {
          renderUserMessage(this.messagesEl, msg);
        } else {
          renderAssistantMessage(this.messagesEl, msg, this, this.getAssistantActions(), renderOpts);
        }
      }
    }
    this.scrollToBottom();

    // Persist last conversation ID
    this.plugin.settings.lastConversationId = id;
    await this.plugin.saveSettings();

    // Update conversation list
    this.conversationList?.setActive(id);

    // Reset context for restored conversations
    this.includeActiveFile = this.plugin.settings.context.includeActiveFileByDefault;
    this.manualContextPaths.clear();
    // Always capture the current active file as context, even for existing conversations.
    // sessionStarted being true will prevent auto-updating on subsequent file opens.
    this.captureActiveFileAsContext();
  }

  /** Delete a conversation from storage. */
  private async deleteConversation(id: string): Promise<void> {
    // Block delete while streaming to avoid race conditions
    if (this.isStreaming) {
      new Notice('Cannot delete conversation while streaming');
      return;
    }

    await this.conversationStore.deleteConversation(id);

    // If we deleted the active conversation, start a new chat
    if (this.currentConversationId === id) {
      this.currentConversationId = null;
      this.plugin.settings.lastConversationId = null;
      await this.plugin.saveSettings();
      this.newChat();
    }

    await this.refreshConversationList();
  }

  /** Persist a message and update metadata. */
  private async persistMessage(message: ChatMessage): Promise<void> {
    if (!this.currentConversationId) return;

    try {
      await this.conversationStore.appendMessage(this.currentConversationId, message);

      // Generate title from first user message
      const isFirstUserMessage = message.role === 'user' &&
        this.messages.filter(m => m.role === 'user').length === 1;

      await this.conversationStore.updateMetaAfterMessage(this.currentConversationId, {
        title: isFirstUserMessage ? ConversationStore.generateTitle(message.content) : undefined,
        messageCount: this.messages.length,
        latestMessage: message,
      });

      // Refresh list to show updated title/timestamp
      await this.refreshConversationList();
    } catch (err) {
      console.error('[obsidian-agent] Failed to persist message:', err);
    }
  }

  // ── Status display ────────────────────────────────────────────────────

  /** Push the model + thinking status into the input footer. */
  private refreshStatusDisplay(): void {
    const modelLabel = this.getActiveModelLabel();
    const thinkingLabel = this.getThinkingLabel();
    this.inputArea.setStatus(modelLabel, thinkingLabel);
  }

  /** Map the raw thinkingLevel to a display label. */
  private getThinkingLabel(): string {
    const level = this.plugin.settings.general.thinkingLevel || 'medium';
    const map: Record<string, string> = {
      off: 'Off',
      minimal: 'Minimal',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
    };
    return map[level] ?? level;
  }

  // ── Send / cancel / new chat ──────────────────────────────────────────

  private async handleSend(text: string): Promise<void> {
    if (this.isStreaming || !this.agentService) return;

    // Ensure agent service has latest settings
    this.agentService.updateSettings(this.plugin.settings);

    // Ensure a conversation exists (lazy creation)
    await this.ensureConversation(text);

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

    // Persist user message immediately (crash safety)
    await this.persistMessage(userMessage);

    // Build context files (read from vault)
    const contextFiles = await this.buildContextFiles();

    // Start streaming
    this.isStreaming = true;
    this.sessionStarted = true;
    this.inputArea.setStreaming(true);

    const startTime = Date.now();
    const renderOpts = {
      showThinkingBlocks: this.plugin.settings.appearance.showThinkingBlocks,
      showToolBlocks: this.plugin.settings.appearance.showToolBlocks,
    };
    const renderer = new StreamRenderer(this.messagesEl, () => {
      if (this.plugin.settings.appearance.enableAutoScroll) {
        this.scrollToBottom();
      }
    }, renderOpts);
    this.streamRenderer = renderer;

    try {
      for await (const chunk of this.agentService.query(text, {
        activeFilePath: this.includeActiveFile ? this.activeFilePath : null,
        contextFiles,
      })) {
        if (!this.isStreaming) break;

        renderer.processChunk(chunk);

        if (chunk.type === 'done' || chunk.type === 'error') {
          break;
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      renderer.processChunk({ type: 'error', content: errorMsg });
    }

    // Finalize: use local ref (safe even if handleCancel nulled this.streamRenderer)
    const streamingEl = renderer.getElement();
    const result = renderer.finalize();
    const durationSeconds = (Date.now() - startTime) / 1000;

    // Use ordered contentBlocks from streamer to preserve interleaved order
    const contentBlocks = result.contentBlocks;

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

    // Persist assistant message
    await this.persistMessage(assistantMessage);

    // Rehydrate: replace raw streaming DOM with markdown-rendered content
    if (streamingEl) {
      streamingEl.empty();
      streamingEl.className = 'oa-message oa-message-assistant';
      renderAssistantMessageInto(streamingEl, assistantMessage, this, this.getAssistantActions(), renderOpts);
    }

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

  newChat(): void {
    if (this.isStreaming) {
      this.handleCancel();
    }

    this.messages = [];
    this.currentConversationId = null;
    this.messagesEl.empty();
    this.renderWelcome();

    if (this.agentService) {
      this.agentService.resetSession();
    }

    // Reset session state and context
    this.sessionStarted = false;
    this.includeActiveFile = this.plugin.settings.context.includeActiveFileByDefault;
    this.manualContextPaths.clear();
    this.captureActiveFileAsContext();

    // Update UI
    this.conversationList?.setActive(null);

    // Persist the blank state so reload doesn't restore the old conversation
    this.plugin.settings.lastConversationId = null;
    this.plugin.saveSettings();

    this.inputArea.focus();
  }

  // ── Assistant message action handlers ──────────────────────────────────

  /** Build the action callbacks object passed to assistant message renderers. */
  private getAssistantActions(): AssistantMessageActions {
    return {
      onCopy: (text: string) => this.copyToClipboard(text),
      onInsert: (text: string) => this.insertAtCursor(text),
    };
  }

  /** Copy text to the system clipboard. */
  private async copyToClipboard(text: string): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      new Notice('Copied to clipboard');
    } catch {
      // Fallback for environments where Clipboard API is blocked
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        new Notice('Copied to clipboard');
      } catch {
        new Notice('Failed to copy');
      }
    }
  }

  /** Insert text at the cursor position of the last focused Markdown editor. */
  private insertAtCursor(text: string): void {
    if (!text) return;

    const editor =
      this.lastMarkdownView?.editor ??
      this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;

    if (!editor) {
      new Notice('No active editor — open a note first');
      return;
    }

    const cursor = editor.getCursor();
    editor.replaceRange(text, cursor, cursor);
    new Notice('Inserted at cursor');
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  /** Returns a user-friendly label for the currently active model. */
  private getActiveModelLabel(): string {
    const { provider, modelId } = this.plugin.settings.general;
    if (provider === 'custom-openai') {
      const modelName = this.plugin.settings.customOpenAI.modelId || '(not configured)';
      return `custom-openai/${modelName}`;
    }
    return `${provider}/${modelId}`;
  }

  refreshModelDisplay(): void {
    // Update footer status (model + thinking) — model label lives in input footer now
    this.refreshStatusDisplay();
  }

  /** Called by main.ts when settings change. Updates UI and runtime behavior. */
  onSettingsChanged(settings: ObsidianAgentSettings): void {
    this.refreshStatusDisplay();

    // Re-render existing messages if appearance settings changed
    if (this.messages.length > 0 && !this.isStreaming) {
      const renderOpts = {
        showThinkingBlocks: settings.appearance.showThinkingBlocks,
        showToolBlocks: settings.appearance.showToolBlocks,
      };
      this.messagesEl.empty();
      for (const msg of this.messages) {
        if (msg.role === 'user') {
          renderUserMessage(this.messagesEl, msg);
        } else {
          renderAssistantMessage(this.messagesEl, msg, this, this.getAssistantActions(), renderOpts);
        }
      }
      this.scrollToBottom();
    }
  }
}
