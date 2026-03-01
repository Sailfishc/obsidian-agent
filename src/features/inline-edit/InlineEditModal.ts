/**
 * InlineEditModal — Obsidian Modal for inline text editing with AI.
 *
 * Supports two modes:
 * - Selection mode: Replace selected text with AI-generated replacement
 * - Cursor mode: Insert AI-generated content at cursor position
 *
 * Shows word-level diff preview before applying edits.
 */

import { type App, type Editor, type EditorPosition, type MarkdownView, Modal, Notice } from 'obsidian';
import type ObsidianAgentPlugin from '../../main';
import { InlineEditService, parseInlineEditResponse, type InlineEditResult } from '../../core/inline-edit/InlineEditService';
import {
  type CursorContext,
  buildInlineEditUserPrompt,
} from '../../utils/inlineEditContext';
import {
  computeWordDiff,
  diffOpsToHtml,
  escapeHtml,
  normalizeInsertionText,
} from '../../utils/wordDiff';
import { getVaultPath } from '../../utils/path';

interface InlineEditSelectionArgs {
  mode: 'selection';
  selectedText: string;
  from: EditorPosition;
  to: EditorPosition;
  startLine: number; // 1-indexed
  lineCount: number;
}

interface InlineEditCursorArgs {
  mode: 'cursor';
  pos: EditorPosition;
  cursorContext: CursorContext;
}

type InlineEditArgs = InlineEditSelectionArgs | InlineEditCursorArgs;

type ModalState = 'input' | 'streaming' | 'preview' | 'clarification';

export class InlineEditModal extends Modal {
  private plugin: ObsidianAgentPlugin;
  private editor: Editor;
  private view: MarkdownView;
  private notePath: string;
  private editArgs: InlineEditArgs;
  private inlineEditService: InlineEditService | null = null;

  // UI elements
  private instructionInput: HTMLTextAreaElement;
  private generateBtn: HTMLButtonElement;
  private statusEl: HTMLElement;
  private previewEl: HTMLElement;
  private actionBar: HTMLElement;
  private clarificationEl: HTMLElement;

  // State
  private state: ModalState = 'input';
  private collectedText = '';
  private isConversing = false;

  constructor(
    app: App,
    plugin: ObsidianAgentPlugin,
    editor: Editor,
    view: MarkdownView,
    notePath: string,
    editArgs: InlineEditArgs,
  ) {
    super(app);
    this.plugin = plugin;
    this.editor = editor;
    this.view = view;
    this.notePath = notePath;
    this.editArgs = editArgs;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('oa-inline-edit-modal');

    // Title
    const titleEl = contentEl.createDiv('oa-inline-edit-header');
    titleEl.createEl('h3', {
      text: this.editArgs.mode === 'cursor' ? 'Insert at Cursor' : 'Edit Selection',
    });

    // Show selected text preview (for selection mode)
    if (this.editArgs.mode === 'selection') {
      const selPreview = contentEl.createDiv('oa-inline-edit-selection-preview');
      const label = selPreview.createDiv('oa-inline-edit-label');
      label.setText('Selected text:');
      const codeEl = selPreview.createEl('pre', 'oa-inline-edit-selected-text');
      codeEl.setText(this.editArgs.selectedText);
    }

    // Clarification area (hidden by default)
    this.clarificationEl = contentEl.createDiv('oa-inline-edit-clarification');
    this.clarificationEl.style.display = 'none';

    // Instruction input
    const inputArea = contentEl.createDiv('oa-inline-edit-input-area');
    this.instructionInput = inputArea.createEl('textarea', 'oa-inline-edit-instruction');
    this.instructionInput.placeholder = this.editArgs.mode === 'cursor'
      ? 'Describe what to insert...'
      : 'Describe how to edit the selection...';
    this.instructionInput.rows = 2;

    // Buttons row
    const buttonsRow = inputArea.createDiv('oa-inline-edit-buttons');
    this.generateBtn = buttonsRow.createEl('button', 'oa-inline-edit-generate-btn');
    this.generateBtn.setText('Generate');
    this.generateBtn.addEventListener('click', () => this.handleGenerate());

    // Status area (hidden by default)
    this.statusEl = contentEl.createDiv('oa-inline-edit-status');
    this.statusEl.style.display = 'none';

    // Preview area (hidden by default)
    this.previewEl = contentEl.createDiv('oa-inline-edit-preview');
    this.previewEl.style.display = 'none';

    // Action bar (hidden by default)
    this.actionBar = contentEl.createDiv('oa-inline-edit-action-bar');
    this.actionBar.style.display = 'none';

    const rejectBtn = this.actionBar.createEl('button', 'oa-inline-edit-reject-btn');
    rejectBtn.setText('✕ Reject');
    rejectBtn.addEventListener('click', () => this.handleReject());

    const acceptBtn = this.actionBar.createEl('button', 'oa-inline-edit-accept-btn');
    acceptBtn.setText('✓ Accept');
    acceptBtn.addEventListener('click', () => this.handleAccept());

    // Keyboard shortcuts
    this.instructionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.handleGenerate();
      }
    });

    // Focus instruction input
    setTimeout(() => this.instructionInput.focus(), 50);
  }

  onClose(): void {
    if (this.inlineEditService) {
      this.inlineEditService.cancel();
      this.inlineEditService = null;
    }
  }

  private async handleGenerate(): Promise<void> {
    const instruction = this.instructionInput.value.trim();
    if (!instruction) return;
    if (this.state === 'streaming') return;

    const vaultPath = getVaultPath(this.app);
    if (!vaultPath) {
      new Notice('Could not determine vault path');
      return;
    }

    // Initialize service on first use
    if (!this.inlineEditService) {
      this.inlineEditService = new InlineEditService(vaultPath, this.plugin.settings);
    }

    // Build the prompt
    let prompt: string;
    if (this.isConversing) {
      // Follow-up message — just send the instruction as-is
      prompt = instruction;
    } else if (this.editArgs.mode === 'cursor') {
      prompt = buildInlineEditUserPrompt({
        instruction,
        mode: 'cursor',
        notePath: this.notePath,
        cursorContext: this.editArgs.cursorContext,
      });
    } else {
      const lineCount = this.editArgs.selectedText.split(/\r?\n/).length;
      prompt = buildInlineEditUserPrompt({
        instruction,
        mode: 'selection',
        notePath: this.notePath,
        selectedText: this.editArgs.selectedText,
        startLine: this.editArgs.startLine,
        lineCount,
      });
    }

    // Switch to streaming state
    this.setState('streaming');
    this.collectedText = '';

    try {
      for await (const chunk of this.inlineEditService.streamEdit(prompt)) {
        switch (chunk.type) {
          case 'text':
            this.collectedText += chunk.content;
            this.updateStreamingPreview();
            break;
          case 'error':
            this.showError(chunk.content);
            return;
          case 'done':
            break;
        }
      }

      // Parse the response
      const result = parseInlineEditResponse(this.collectedText);
      this.handleResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.showError(msg);
    }
  }

  private handleResult(result: InlineEditResult): void {
    switch (result.kind) {
      case 'replacement': {
        if (this.editArgs.mode !== 'selection') {
          this.showError('Received replacement but not in selection mode');
          return;
        }
        this.showDiffPreview(this.editArgs.selectedText, result.text || '');
        break;
      }
      case 'insertion': {
        this.showInsertionPreview(result.text || '');
        break;
      }
      case 'clarification': {
        this.showClarification(result.text || '');
        break;
      }
      case 'answer': {
        this.showAnswer(result.text || '');
        break;
      }
      case 'error': {
        this.showError(result.text || 'Unknown error');
        break;
      }
    }
  }

  private setState(state: ModalState): void {
    this.state = state;

    // Always hide clarification unless explicitly in clarification state
    if (state !== 'clarification') {
      this.clarificationEl.style.display = 'none';
    }

    switch (state) {
      case 'input':
        this.instructionInput.disabled = false;
        this.generateBtn.disabled = false;
        this.generateBtn.setText('Generate');
        this.statusEl.style.display = 'none';
        this.previewEl.style.display = 'none';
        this.actionBar.style.display = 'none';
        break;
      case 'streaming':
        this.instructionInput.disabled = true;
        this.generateBtn.disabled = true;
        this.generateBtn.setText('Generating...');
        this.statusEl.style.display = 'block';
        this.statusEl.setText('Generating...');
        this.statusEl.className = 'oa-inline-edit-status oa-inline-edit-status-streaming';
        this.previewEl.style.display = 'block';
        this.previewEl.empty();
        this.actionBar.style.display = 'none';
        break;
      case 'preview':
        this.instructionInput.disabled = true;
        this.generateBtn.disabled = true;
        this.statusEl.style.display = 'none';
        this.previewEl.style.display = 'block';
        this.actionBar.style.display = 'flex';
        break;
      case 'clarification':
        this.instructionInput.disabled = false;
        this.generateBtn.disabled = false;
        this.generateBtn.setText('Reply');
        this.statusEl.style.display = 'none';
        this.previewEl.style.display = 'none';
        this.actionBar.style.display = 'none';
        break;
    }
  }

  private updateStreamingPreview(): void {
    if (!this.previewEl) return;
    const preEl = this.previewEl.querySelector('.oa-inline-edit-streaming-text') as HTMLPreElement
      || this.previewEl.createEl('pre', 'oa-inline-edit-streaming-text');
    preEl.setText(this.collectedText);
  }

  private showDiffPreview(oldText: string, newText: string): void {
    this.setState('preview');
    this.previewEl.empty();

    const label = this.previewEl.createDiv('oa-inline-edit-label');
    label.setText('Proposed changes:');

    const diffContainer = this.previewEl.createDiv('oa-inline-edit-diff');
    const ops = computeWordDiff(oldText, newText);
    const html = diffOpsToHtml(ops);
    diffContainer.innerHTML = html;
  }

  private showInsertionPreview(insertedText: string): void {
    this.setState('preview');
    this.previewEl.empty();

    const label = this.previewEl.createDiv('oa-inline-edit-label');
    label.setText('Text to insert:');

    const insertContainer = this.previewEl.createDiv('oa-inline-edit-diff');
    const normalized = normalizeInsertionText(insertedText);
    const escaped = escapeHtml(normalized);
    insertContainer.innerHTML = `<span class="oa-diff-ins">${escaped}</span>`;
  }

  private showClarification(message: string): void {
    this.setState('clarification');
    this.isConversing = true;

    this.clarificationEl.style.display = 'block';
    this.clarificationEl.empty();
    const label = this.clarificationEl.createDiv('oa-inline-edit-label');
    label.setText('Agent asks:');
    const msgEl = this.clarificationEl.createDiv('oa-inline-edit-clarification-text');
    msgEl.setText(message);

    this.instructionInput.value = '';
    this.instructionInput.placeholder = 'Reply to continue...';
    this.instructionInput.focus();
  }

  private showAnswer(message: string): void {
    // Show answer as read-only — no "continue conversation" flow
    this.setState('preview');
    this.previewEl.empty();

    const label = this.previewEl.createDiv('oa-inline-edit-label');
    label.setText('Answer:');
    const msgEl = this.previewEl.createDiv('oa-inline-edit-clarification-text');
    msgEl.setText(message);

    // Hide accept/reject — answers don't modify text
    this.actionBar.style.display = 'none';
  }

  private showError(message: string): void {
    this.setState('input');
    this.isConversing = false; // Reset so next attempt includes editor context
    this.statusEl.style.display = 'block';
    this.statusEl.setText(`Error: ${message}`);
    this.statusEl.className = 'oa-inline-edit-status oa-inline-edit-status-error';
    this.instructionInput.focus();
  }

  private handleAccept(): void {
    const result = parseInlineEditResponse(this.collectedText);

    if (result.kind === 'replacement' && this.editArgs.mode === 'selection') {
      this.editor.replaceRange(
        result.text || '',
        this.editArgs.from,
        this.editArgs.to,
      );
      new Notice('Edit applied');
    } else if (result.kind === 'insertion') {
      const pos = this.editArgs.mode === 'cursor'
        ? this.editArgs.pos
        : this.editArgs.from;
      const normalized = normalizeInsertionText(result.text || '');
      this.editor.replaceRange(normalized, pos, pos);
      new Notice('Text inserted');
    }

    this.close();
  }

  private handleReject(): void {
    new Notice('Edit rejected');
    this.close();
  }
}
