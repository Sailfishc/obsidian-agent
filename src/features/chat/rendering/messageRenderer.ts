import { MarkdownRenderer, type Component } from 'obsidian';
import type { ChatMessage, ToolCallInfo } from '../../../core/types';

export function renderUserMessage(
  container: HTMLElement,
  message: ChatMessage,
): void {
  const messageEl = container.createDiv({ cls: 'oa-message oa-message-user' });
  const contentEl = messageEl.createDiv({ cls: 'oa-message-content' });
  contentEl.createEl('p', { text: message.content });
}

export function renderAssistantMessage(
  container: HTMLElement,
  message: ChatMessage,
  component: Component,
): void {
  const messageEl = container.createDiv({ cls: 'oa-message oa-message-assistant' });

  if (message.contentBlocks) {
    for (const block of message.contentBlocks) {
      switch (block.type) {
        case 'text':
          renderMarkdownBlock(messageEl, block.content, component);
          break;
        case 'thinking':
          renderThinkingBlock(messageEl, block.content);
          break;
        case 'tool_use': {
          const tool = message.toolCalls?.find(t => t.id === block.toolId);
          if (tool) {
            renderToolCall(messageEl, tool);
          }
          break;
        }
      }
    }
  } else if (message.content) {
    renderMarkdownBlock(messageEl, message.content, component);
  }

  if (message.toolCalls && !message.contentBlocks) {
    for (const tool of message.toolCalls) {
      renderToolCall(messageEl, tool);
    }
  }
}

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
  headerEl.createSpan({ text: 'Thinking...' });

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
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function getToolSummary(tool: ToolCallInfo): string {
  const input = tool.input;
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
