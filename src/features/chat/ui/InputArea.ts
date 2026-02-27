export interface InputAreaCallbacks {
  onSend: (text: string) => void;
  onCancel: () => void;
}

export class InputArea {
  private container: HTMLElement;
  private textArea: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private cancelButton: HTMLButtonElement;
  private callbacks: InputAreaCallbacks;
  private streaming = false;

  constructor(parent: HTMLElement, callbacks: InputAreaCallbacks) {
    this.callbacks = callbacks;
    this.container = parent.createDiv({ cls: 'oa-input-area' });

    const inputRow = this.container.createDiv({ cls: 'oa-input-row' });

    this.textArea = inputRow.createEl('textarea', {
      cls: 'oa-input-textarea',
      attr: { placeholder: 'Ask anything...' },
    });

    const buttonRow = this.container.createDiv({ cls: 'oa-input-buttons' });

    this.cancelButton = buttonRow.createEl('button', {
      cls: 'oa-btn oa-btn-cancel',
      text: 'Cancel',
    });
    this.cancelButton.style.display = 'none';

    this.sendButton = buttonRow.createEl('button', {
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
      }
    });

    this.sendButton.addEventListener('click', () => {
      this.handleSend();
    });

    this.cancelButton.addEventListener('click', () => {
      this.callbacks.onCancel();
    });

    // Auto-resize textarea
    this.textArea.addEventListener('input', () => {
      this.textArea.style.height = 'auto';
      this.textArea.style.height = Math.min(this.textArea.scrollHeight, 200) + 'px';
    });
  }

  private handleSend(): void {
    const text = this.textArea.value.trim();
    if (!text || this.streaming) return;

    this.callbacks.onSend(text);
    this.textArea.value = '';
    this.textArea.style.height = 'auto';
  }

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
