import type { StreamChunk, ToolCallInfo } from '../../../core/types';

export class StreamRenderer {
  private container: HTMLElement;
  private messageEl: HTMLElement;
  private currentTextEl: HTMLElement | null = null;
  private currentThinkingEl: HTMLElement | null = null;
  private toolElements: Map<string, HTMLElement> = new Map();
  private collectedText = '';
  private collectedThinking = '';
  private toolCalls: ToolCallInfo[] = [];
  private onAutoScroll?: () => void;

  constructor(container: HTMLElement, onAutoScroll?: () => void) {
    this.container = container;
    this.onAutoScroll = onAutoScroll;
    this.messageEl = container.createDiv({ cls: 'oa-message oa-message-assistant oa-message-streaming' });
  }

  processChunk(chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'text':
        this.appendText(chunk.content);
        break;
      case 'thinking':
        this.appendThinking(chunk.content);
        break;
      case 'tool_use':
        this.addToolUse(chunk.id, chunk.name, chunk.input);
        break;
      case 'tool_result':
        this.addToolResult(chunk.id, chunk.content, chunk.isError);
        break;
      case 'error':
        this.addError(chunk.content);
        break;
    }
    this.onAutoScroll?.();
  }

  private appendText(text: string): void {
    // Close thinking if open
    if (this.currentThinkingEl) {
      this.currentThinkingEl = null;
    }

    if (!this.currentTextEl) {
      this.currentTextEl = this.messageEl.createDiv({ cls: 'oa-message-text oa-streaming-text' });
    }
    this.collectedText += text;
    this.currentTextEl.textContent = this.collectedText;
  }

  private appendThinking(text: string): void {
    if (!this.currentThinkingEl) {
      const thinkingWrapper = this.messageEl.createDiv({ cls: 'oa-thinking oa-thinking-active' });
      thinkingWrapper.createDiv({ cls: 'oa-thinking-header' }).createSpan({ text: 'Thinking...' });
      this.currentThinkingEl = thinkingWrapper.createDiv({ cls: 'oa-thinking-content' });
      this.currentThinkingEl.style.display = 'block';
    }
    this.collectedThinking += text;
    this.currentThinkingEl.textContent = this.collectedThinking;
  }

  private addToolUse(id: string, name: string, input: Record<string, unknown>): void {
    // Close text/thinking if open
    this.currentTextEl = null;
    this.currentThinkingEl = null;

    const toolEl = this.messageEl.createDiv({ cls: 'oa-tool-call oa-tool-running' });
    const headerEl = toolEl.createDiv({ cls: 'oa-tool-header' });
    headerEl.createSpan({ cls: 'oa-tool-name', text: formatToolName(name) });

    const summaryText = getToolInputSummary(name, input);
    if (summaryText) {
      headerEl.createSpan({ cls: 'oa-tool-summary', text: summaryText });
    }

    const spinnerEl = headerEl.createSpan({ cls: 'oa-tool-spinner' });
    spinnerEl.textContent = '\u23F3';

    this.toolElements.set(id, toolEl);
    this.toolCalls.push({ id, name, input });
  }

  private addToolResult(id: string, content: string, isError?: boolean): void {
    const toolEl = this.toolElements.get(id);
    if (toolEl) {
      toolEl.removeClass('oa-tool-running');
      if (isError) {
        toolEl.addClass('oa-tool-error');
      }

      // Remove spinner
      const spinner = toolEl.querySelector('.oa-tool-spinner');
      spinner?.remove();

      // Add result preview
      if (content) {
        const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;
        const resultEl = toolEl.createDiv({ cls: 'oa-tool-result-preview' });
        resultEl.createEl('pre', { text: preview });
      }
    }

    // Update tool call info
    const tc = this.toolCalls.find(t => t.id === id);
    if (tc) {
      tc.result = content;
      tc.isError = isError;
    }
  }

  private addError(content: string): void {
    const errorEl = this.messageEl.createDiv({ cls: 'oa-error' });
    errorEl.createEl('p', { text: content });
  }

  finalize(): { text: string; thinking: string; toolCalls: ToolCallInfo[] } {
    this.messageEl.removeClass('oa-message-streaming');
    return {
      text: this.collectedText,
      thinking: this.collectedThinking,
      toolCalls: this.toolCalls,
    };
  }

  getElement(): HTMLElement {
    return this.messageEl;
  }
}

function formatToolName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function getToolInputSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'read': return (input.file_path || input.filePath || '') as string;
    case 'write': return (input.file_path || input.filePath || '') as string;
    case 'edit': return (input.file_path || input.filePath || '') as string;
    case 'bash': return ((input.command || '') as string).slice(0, 60);
    case 'grep': return `"${input.pattern || ''}"`;
    case 'find': return `"${input.pattern || input.glob || ''}"`;
    case 'ls': return (input.path || '.') as string;
    default: return '';
  }
}
