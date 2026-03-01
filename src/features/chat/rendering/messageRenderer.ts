import { MarkdownRenderer, type Component } from 'obsidian';
import type { ChatMessage, ToolCallInfo } from '../../../core/types';

/** Callbacks passed from ChatView so renderers can trigger side effects. */
export interface AssistantMessageActions {
  onCopy: (text: string) => void | Promise<void>;
  onInsert: (text: string) => void;
}

/** Options controlling which content blocks are rendered. */
export interface ChatRenderOptions {
  showThinkingBlocks: boolean;
  showToolBlocks: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Format a timestamp (epoch ms) into `YYYY/MM/DD HH:mm:ss`. Returns null for invalid values. */
function formatTimestamp(ts: unknown): string | null {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Extract only user-visible text from an assistant message (for copy/insert). */
function getAssistantActionText(message: ChatMessage): string {
  // Prefer message.content (includes fullText from StreamRenderer).
  // Fall back to joining text contentBlocks when content is empty.
  if (message.content?.trim()) {
    return message.content.trim();
  }
  if (message.contentBlocks) {
    return message.contentBlocks
      .filter((b): b is { type: 'text'; content: string } => b.type === 'text')
      .map(b => b.content)
      .join('\n\n')
      .trim();
  }
  return '';
}

// ── SVG icons ────────────────────────────────────────────────────────────

const ICON_COPY = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const ICON_INSERT = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="m8 11 4 4 4-4"></path><line x1="4" y1="21" x2="20" y2="21"></line></svg>';

// ── Public render functions ──────────────────────────────────────────────

export function renderUserMessage(
  container: HTMLElement,
  message: ChatMessage,
): void {
  const messageEl = container.createDiv({ cls: 'oa-message oa-message-user' });
  const contentEl = messageEl.createDiv({ cls: 'oa-message-content' });
  contentEl.createEl('p', { text: message.content });

  // Timestamp
  const ts = formatTimestamp(message.timestamp);
  if (ts) {
    messageEl.createDiv({ cls: 'oa-message-timestamp', text: ts });
  }
}

export function renderAssistantMessage(
  container: HTMLElement,
  message: ChatMessage,
  component: Component,
  actions?: AssistantMessageActions,
  opts?: ChatRenderOptions,
): void {
  const messageEl = container.createDiv({ cls: 'oa-message oa-message-assistant' });
  renderAssistantMessageInto(messageEl, message, component, actions, opts);
}

/**
 * Render assistant message content into an existing element.
 * Used both by `renderAssistantMessage` (new element) and by
 * ChatView to rehydrate a streaming element with markdown.
 */
export function renderAssistantMessageInto(
  messageEl: HTMLElement,
  message: ChatMessage,
  component: Component,
  actions?: AssistantMessageActions,
  opts?: ChatRenderOptions,
): void {
  const showThinking = opts?.showThinkingBlocks !== false;
  const showTools = opts?.showToolBlocks !== false;

  if (message.contentBlocks) {
    for (const block of message.contentBlocks) {
      switch (block.type) {
        case 'text':
          renderMarkdownBlock(messageEl, block.content, component);
          break;
        case 'thinking':
          if (showThinking) {
            renderThinkingBlock(messageEl, block.content);
          }
          break;
        case 'tool_use': {
          if (showTools) {
            const tool = message.toolCalls?.find(t => t.id === block.toolId);
            if (tool) {
              renderToolCall(messageEl, tool);
            }
          }
          break;
        }
      }
    }
  } else if (message.content) {
    renderMarkdownBlock(messageEl, message.content, component);
  }

  if (message.toolCalls && !message.contentBlocks) {
    if (showTools) {
      for (const tool of message.toolCalls) {
        renderToolCall(messageEl, tool);
      }
    }
  }

  // Footer: timestamp + action buttons
  renderAssistantFooter(messageEl, message, actions);
}

// ── Assistant footer (timestamp + actions) ───────────────────────────────

function renderAssistantFooter(
  messageEl: HTMLElement,
  message: ChatMessage,
  actions?: AssistantMessageActions,
): void {
  // Idempotency: remove any existing footer before adding a new one
  messageEl.querySelector('.oa-message-footer')?.remove();

  const footerEl = messageEl.createDiv({ cls: 'oa-message-footer' });

  // Timestamp (left)
  const ts = formatTimestamp(message.timestamp);
  if (ts) {
    footerEl.createDiv({ cls: 'oa-message-timestamp', text: ts });
  } else {
    footerEl.createDiv({ cls: 'oa-message-timestamp' }); // spacer
  }

  // Action buttons (right) — only render when handlers are provided
  if (actions) {
    const actionsEl = footerEl.createDiv({ cls: 'oa-message-actions' });
    const text = getAssistantActionText(message);
    const hasText = text.length > 0;

    // Copy button
    const copyBtn = actionsEl.createEl('button', {
      cls: 'oa-action-btn oa-action-copy clickable-icon',
      attr: { 'aria-label': 'Copy', type: 'button' },
    });
    copyBtn.innerHTML = ICON_COPY;
    if (!hasText) copyBtn.disabled = true;
    copyBtn.addEventListener('click', () => {
      if (hasText) actions.onCopy(text);
    });

    // Insert at cursor button
    const insertBtn = actionsEl.createEl('button', {
      cls: 'oa-action-btn oa-action-insert clickable-icon',
      attr: { 'aria-label': 'Insert at cursor', type: 'button' },
    });
    insertBtn.innerHTML = ICON_INSERT;
    if (!hasText) insertBtn.disabled = true;
    insertBtn.addEventListener('click', () => {
      if (hasText) actions.onInsert(text);
    });
  }
}

// ── Internal block renderers ─────────────────────────────────────────────

function renderMarkdownBlock(
  container: HTMLElement,
  content: string,
  component: Component,
): void {
  const textEl = container.createDiv({ cls: 'oa-message-text' });
  MarkdownRenderer.render(
    (component as any).app || (window as any).app,
    content,
    textEl,
    '',
    component,
  );
}

function renderThinkingBlock(container: HTMLElement, content: string): void {
  const thinkingEl = container.createDiv({ cls: 'oa-thinking' });
  const headerEl = thinkingEl.createDiv({ cls: 'oa-thinking-header' });
  headerEl.createSpan({ cls: 'oa-thinking-label', text: 'Thought' });

  const toggleEl = headerEl.createEl('button', {
    cls: 'oa-thinking-toggle clickable-icon',
    text: 'Show',
  });

  const contentEl = thinkingEl.createDiv({ cls: 'oa-thinking-content' });
  contentEl.style.display = 'none';
  contentEl.createEl('pre', { text: content });

  toggleEl.addEventListener('click', () => {
    const isHidden = contentEl.style.display === 'none';
    contentEl.style.display = isHidden ? 'block' : 'none';
    toggleEl.textContent = isHidden ? 'Hide' : 'Show';
  });
}

export function renderToolCall(container: HTMLElement, tool: ToolCallInfo): void {
  const toolEl = container.createDiv({ cls: 'oa-tool-call' });

  const headerEl = toolEl.createDiv({ cls: 'oa-tool-header' });
  headerEl.createSpan({ cls: 'oa-tool-icon', text: getToolIcon(tool.name) });
  headerEl.createSpan({ cls: 'oa-tool-name', text: formatToolName(tool.name) });

  const summaryText = getToolSummary(tool);
  if (summaryText) {
    headerEl.createSpan({ cls: 'oa-tool-summary', text: summaryText });
  }

  const toggleEl = headerEl.createEl('button', {
    cls: 'oa-tool-toggle clickable-icon',
    text: '\u25B6',
  });

  const detailsEl = toolEl.createDiv({ cls: 'oa-tool-details' });
  detailsEl.style.display = 'none';

  // Input
  const inputEl = detailsEl.createDiv({ cls: 'oa-tool-input' });
  inputEl.createEl('strong', { text: 'Input:' });
  const inputPre = inputEl.createEl('pre');
  inputPre.createEl('code', { text: JSON.stringify(tool.input, null, 2) });

  // Result
  if (tool.result !== undefined) {
    const resultEl = detailsEl.createDiv({
      cls: `oa-tool-result ${tool.isError ? 'oa-tool-error' : ''}`,
    });
    resultEl.createEl('strong', { text: tool.isError ? 'Error:' : 'Result:' });
    const resultPre = resultEl.createEl('pre');
    resultPre.createEl('code', { text: tool.result });
  }

  toggleEl.addEventListener('click', () => {
    const isHidden = detailsEl.style.display === 'none';
    detailsEl.style.display = isHidden ? 'block' : 'none';
    toggleEl.textContent = isHidden ? '\u25BC' : '\u25B6';
  });
}

function getToolIcon(name: string): string {
  if (name.startsWith('mcp__')) return '🔌';
  switch (name) {
    case 'read': return '\uD83D\uDCC4';
    case 'write': return '\u270D\uFE0F';
    case 'edit': return '\u2702\uFE0F';
    case 'bash': return '\uD83D\uDCBB';
    case 'grep': return '\uD83D\uDD0D';
    case 'find': return '\uD83D\uDCC2';
    case 'ls': return '\uD83D\uDCC1';
    default: return '\uD83D\uDD27';
  }
}

function formatToolName(name: string): string {
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    if (parts.length >= 3) {
      return `MCP ${parts[1]} / ${parts.slice(2).join('__')}`;
    }
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function getToolSummary(tool: ToolCallInfo): string {
  const input = tool.input;
  if (tool.name.startsWith('mcp__')) {
    // For MCP tools, show first string value of input as summary
    const firstValue = Object.values(input).find(v => typeof v === 'string');
    return firstValue ? String(firstValue).slice(0, 80) : '';
  }
  switch (tool.name) {
    case 'read':
      return input.file_path as string || input.filePath as string || '';
    case 'write':
      return input.file_path as string || input.filePath as string || '';
    case 'edit':
      return input.file_path as string || input.filePath as string || '';
    case 'bash':
      return (input.command as string || '').slice(0, 60);
    case 'grep':
      return `"${input.pattern || ''}"`;
    case 'find':
      return `"${input.pattern || input.glob || ''}"`;
    case 'ls':
      return input.path as string || '.';
    default:
      return '';
  }
}
