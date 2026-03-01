import { SlashCommandDropdown, type SlashCommandItem } from './SlashCommandDropdown';

export interface InputAreaCallbacks {
  onSend: (text: string) => void;
  onCancel: () => void;
  onTriggerContextSearch?: () => void;
  onRemoveContextFile?: (path: string) => void;
  onOpenContextFile?: (path: string) => void;
  onModelClick?: () => void;
  onThinkingClick?: () => void;
}

export interface PopupMenuItem {
  value: string;
  label: string;
  active?: boolean;
}

export class InputArea {
  private container: HTMLElement;
  private controlsRowEl: HTMLElement;
  private controlsLeftEl: HTMLElement;
  private controlsRightEl: HTMLElement;
  private contextRowEl: HTMLElement;
  private textArea: HTMLTextAreaElement;
  private cancelButton: HTMLButtonElement;
  private statusEl: HTMLElement;
  private callbacks: InputAreaCallbacks;
  private streaming = false;
  private contextPaths: string[] = [];

  /** Currently open popup (if any). */
  private activePopup: HTMLElement | null = null;
  private dismissHandler: ((e: MouseEvent) => void) | null = null;

  /** Slash command dropdown for /skill: commands. */
  private slashDropdown: SlashCommandDropdown;

  constructor(parent: HTMLElement, callbacks: InputAreaCallbacks) {
    this.callbacks = callbacks;
    this.container = parent.createDiv({ cls: 'oa-input-area' });

    // Controls row (conversation selector, history, new chat, model info)
    this.controlsRowEl = this.container.createDiv({ cls: 'oa-controls-row' });
    this.controlsLeftEl = this.controlsRowEl.createDiv({ cls: 'oa-controls-left' });
    this.controlsRightEl = this.controlsRowEl.createDiv({ cls: 'oa-controls-right' });

    // Unified input box: context pills + textarea + footer inside one bordered container
    const inputBox = this.container.createDiv({ cls: 'oa-input-box' });

    // Context pill row (inside input box, above textarea)
    this.contextRowEl = inputBox.createDiv({ cls: 'oa-context-row' });

    this.textArea = inputBox.createEl('textarea', {
      cls: 'oa-input-textarea',
      attr: { placeholder: 'Ask anything… Type @ to attach files, / for skills' },
    });

    // Footer: status (left) + buttons (right), inside input box
    const footerRow = inputBox.createDiv({ cls: 'oa-input-footer' });

    this.statusEl = footerRow.createDiv({ cls: 'oa-chat-status' });

    const buttonGroup = footerRow.createDiv({ cls: 'oa-input-buttons' });

    // Context search button (folder icon)
    const contextBtn = buttonGroup.createEl('button', {
      cls: 'oa-btn oa-btn-icon oa-btn-context clickable-icon',
      attr: { 'aria-label': 'Attach files', type: 'button' },
    });
    contextBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
    contextBtn.addEventListener('click', () => {
      this.callbacks.onTriggerContextSearch?.();
    });

    this.cancelButton = buttonGroup.createEl('button', {
      cls: 'oa-btn oa-btn-cancel',
      text: 'Cancel',
    });
    this.cancelButton.style.display = 'none';

    // Initialize slash command dropdown (positioned inside input box, above textarea)
    this.slashDropdown = new SlashCommandDropdown(inputBox, this.textArea, {
      onSelect: () => {
        // After selecting a command, focus stays on input
      },
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.textArea.addEventListener('keydown', (e: KeyboardEvent) => {
      // Let slash dropdown handle navigation keys first
      if (this.slashDropdown.handleKeydown(e)) {
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
        return;
      }
    });

    // Detect '@' to trigger context file search + '/' for slash commands
    this.textArea.addEventListener('input', () => {
      // Auto-resize textarea
      this.textArea.style.height = 'auto';
      this.textArea.style.height = Math.min(this.textArea.scrollHeight, 200) + 'px';

      // Update slash command dropdown
      this.slashDropdown.handleInputChange();

      // Check if user just typed '@' at a word boundary (start of input or after whitespace)
      const val = this.textArea.value;
      const pos = this.textArea.selectionStart;
      if (
        pos > 0 &&
        val[pos - 1] === '@' &&
        !this.streaming &&
        (pos === 1 || /\s/.test(val[pos - 2]))
      ) {
        // Remove the '@' character from the textarea
        this.textArea.value = val.slice(0, pos - 1) + val.slice(pos);
        this.textArea.selectionStart = pos - 1;
        this.textArea.selectionEnd = pos - 1;
        this.callbacks.onTriggerContextSearch?.();
      }
    });

    this.cancelButton.addEventListener('click', () => {
      this.callbacks.onCancel();
    });
  }

  private handleSend(): void {
    const text = this.textArea.value.trim();
    if (!text || this.streaming) return;

    this.callbacks.onSend(text);
    this.textArea.value = '';
    this.textArea.style.height = 'auto';
  }

  // ── Controls row accessors ────────────────────────────────────────────

  getControlsLeftEl(): HTMLElement {
    return this.controlsLeftEl;
  }

  getControlsRightEl(): HTMLElement {
    return this.controlsRightEl;
  }

  // ── Context file chips ────────────────────────────────────────────────

  setContextFiles(paths: string[]): void {
    this.contextPaths = paths;
    this.contextRowEl.empty();

    for (const path of paths) {
      this.renderContextChip(path);
    }
  }

  private renderContextChip(path: string): void {
    const fileName = path.split('/').pop() || path;

    const pill = this.contextRowEl.createDiv({ cls: 'oa-context-pill' });
    pill.setAttribute('title', path);

    const iconEl = pill.createSpan({ cls: 'oa-context-pill-icon' });
    iconEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';

    pill.createSpan({ cls: 'oa-context-pill-name', text: fileName });

    const removeBtn = pill.createEl('button', {
      cls: 'oa-context-pill-remove',
      text: '×',
    });
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onRemoveContextFile?.(path);
    });

    pill.addEventListener('click', () => {
      this.callbacks.onOpenContextFile?.(path);
    });
  }

  // ── Status display (clickable model + thinking) ───────────────────────

  /** Update the model/thinking status in the footer. Clickable to open pickers. */
  setStatus(modelLabel: string, thinkingLevel: string): void {
    this.statusEl.empty();

    // Clickable model label
    const modelEl = this.statusEl.createSpan({ cls: 'oa-status-model oa-status-clickable', text: modelLabel });
    modelEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onModelClick?.();
    });

    // Clickable thinking label
    const thinkingGroup = this.statusEl.createSpan({ cls: 'oa-status-thinking oa-status-clickable' });
    thinkingGroup.createSpan({ cls: 'oa-status-thinking-label', text: 'Thinking:' });
    thinkingGroup.createSpan({ cls: 'oa-status-thinking-value', text: ` ${thinkingLevel}` });
    thinkingGroup.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onThinkingClick?.();
    });
  }

  /**
   * Show a popup menu anchored to the model status element.
   * Returns a promise that resolves with the selected value or null if dismissed.
   */
  showPopupMenu(items: PopupMenuItem[], anchorSelector: string): Promise<string | null> {
    this.dismissPopup();

    const anchor = this.statusEl.querySelector(anchorSelector) as HTMLElement;
    if (!anchor) return Promise.resolve(null);

    return new Promise<string | null>((resolve) => {
      const popup = document.createElement('div');
      popup.className = 'oa-popup-menu';

      for (const item of items) {
        const menuItem = popup.createDiv({
          cls: `oa-popup-menu-item${item.active ? ' is-active' : ''}`,
          text: item.label,
        });
        menuItem.addEventListener('click', (e) => {
          e.stopPropagation();
          this.dismissPopup();
          resolve(item.value);
        });
      }

      // Position above the anchor
      document.body.appendChild(popup);
      this.activePopup = popup;

      const anchorRect = anchor.getBoundingClientRect();
      const popupRect = popup.getBoundingClientRect();

      popup.style.position = 'fixed';
      popup.style.left = `${anchorRect.left}px`;
      popup.style.top = `${anchorRect.top - popupRect.height - 4}px`;
      popup.style.zIndex = '1000';

      // Dismiss on click outside
      this.dismissHandler = (e: MouseEvent) => {
        if (!popup.contains(e.target as Node)) {
          this.dismissPopup();
          resolve(null);
        }
      };
      // Use setTimeout to avoid the current click event triggering immediate dismiss
      setTimeout(() => {
        document.addEventListener('click', this.dismissHandler!, true);
      }, 0);
    });
  }

  private dismissPopup(): void {
    if (this.activePopup) {
      this.activePopup.remove();
      this.activePopup = null;
    }
    if (this.dismissHandler) {
      document.removeEventListener('click', this.dismissHandler, true);
      this.dismissHandler = null;
    }
  }

  // ── Streaming state ───────────────────────────────────────────────────

  setStreaming(streaming: boolean): void {
    this.streaming = streaming;
    this.cancelButton.style.display = streaming ? '' : 'none';
    this.textArea.disabled = streaming;
    if (!streaming) {
      this.textArea.focus();
    }
  }

  /** Update the available slash commands (called when skills are reloaded). */
  setSlashCommands(commands: SlashCommandItem[]): void {
    this.slashDropdown.setCommands(commands);
  }

  focus(): void {
    this.textArea.focus();
  }

  getElement(): HTMLElement {
    return this.container;
  }

  destroy(): void {
    this.dismissPopup();
    this.slashDropdown.destroy();
  }
}
