export interface InputAreaCallbacks {
  onSend: (text: string) => void;
  onCancel: () => void;
  onTriggerContextSearch?: () => void;
  onRemoveContextFile?: (path: string) => void;
  onOpenContextFile?: (path: string) => void;
}

export class InputArea {
  private container: HTMLElement;
  private controlsRowEl: HTMLElement;
  private controlsLeftEl: HTMLElement;
  private controlsRightEl: HTMLElement;
  private contextRowEl: HTMLElement;
  private textArea: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private cancelButton: HTMLButtonElement;
  private statusEl: HTMLElement;
  private callbacks: InputAreaCallbacks;
  private streaming = false;
  private contextPaths: string[] = [];

  constructor(parent: HTMLElement, callbacks: InputAreaCallbacks) {
    this.callbacks = callbacks;
    this.container = parent.createDiv({ cls: 'oa-input-area' });

    // Controls row (conversation selector, history, new chat, model info)
    this.controlsRowEl = this.container.createDiv({ cls: 'oa-controls-row' });
    this.controlsLeftEl = this.controlsRowEl.createDiv({ cls: 'oa-controls-left' });
    this.controlsRightEl = this.controlsRowEl.createDiv({ cls: 'oa-controls-right' });

    // Context pill row (above textarea)
    this.contextRowEl = this.container.createDiv({ cls: 'oa-context-row' });

    const inputRow = this.container.createDiv({ cls: 'oa-input-row' });

    this.textArea = inputRow.createEl('textarea', {
      cls: 'oa-input-textarea',
      attr: { placeholder: 'Ask anything… Type @ to attach files' },
    });

    // Footer: status (left) + buttons (right)
    const footerRow = this.container.createDiv({ cls: 'oa-input-footer' });

    this.statusEl = footerRow.createDiv({ cls: 'oa-chat-status' });

    const buttonGroup = footerRow.createDiv({ cls: 'oa-input-buttons' });

    this.cancelButton = buttonGroup.createEl('button', {
      cls: 'oa-btn oa-btn-cancel',
      text: 'Cancel',
    });
    this.cancelButton.style.display = 'none';

    this.sendButton = buttonGroup.createEl('button', {
      cls: 'oa-btn oa-btn-send',
      text: 'Send',
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.textArea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
        return;
      }
    });

    // Detect '@' to trigger context file search
    this.textArea.addEventListener('input', () => {
      // Auto-resize textarea
      this.textArea.style.height = 'auto';
      this.textArea.style.height = Math.min(this.textArea.scrollHeight, 200) + 'px';

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

    this.sendButton.addEventListener('click', () => {
      this.handleSend();
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

  /** Container for left-side controls (conversation trigger). */
  getControlsLeftEl(): HTMLElement {
    return this.controlsLeftEl;
  }

  /** Container for right-side controls (history, new chat buttons). */
  getControlsRightEl(): HTMLElement {
    return this.controlsRightEl;
  }

  // ── Context file chips ────────────────────────────────────────────────

  /** Render context file chips. Pass empty array to clear. */
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

    // File icon
    const iconEl = pill.createSpan({ cls: 'oa-context-pill-icon' });
    iconEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';

    // File name
    pill.createSpan({ cls: 'oa-context-pill-name', text: fileName });

    // Remove button
    const removeBtn = pill.createEl('button', {
      cls: 'oa-context-pill-remove',
      text: '×',
    });
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onRemoveContextFile?.(path);
    });

    // Click pill to open the file
    pill.addEventListener('click', () => {
      this.callbacks.onOpenContextFile?.(path);
    });
  }

  // ── Status display ────────────────────────────────────────────────────

  /** Update the model/thinking status text in the footer. */
  setStatus(modelLabel: string, thinkingLevel: string): void {
    this.statusEl.empty();
    this.statusEl.createSpan({ cls: 'oa-status-model', text: modelLabel });
    this.statusEl.createSpan({ cls: 'oa-status-thinking-label', text: 'Thinking:' });
    this.statusEl.createSpan({ cls: 'oa-status-thinking-value', text: thinkingLevel });
  }

  // ── Streaming state ───────────────────────────────────────────────────

  setStreaming(streaming: boolean): void {
    this.streaming = streaming;
    this.sendButton.style.display = streaming ? 'none' : '';
    this.cancelButton.style.display = streaming ? '' : 'none';
    this.textArea.disabled = streaming;
    if (!streaming) {
      this.textArea.focus();
    }
  }

  focus(): void {
    this.textArea.focus();
  }

  getElement(): HTMLElement {
    return this.container;
  }
}
