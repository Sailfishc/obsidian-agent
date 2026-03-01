/**
 * ConversationList - Dropdown for browsing and switching conversations.
 *
 * Renders as a button showing the current conversation title. Clicking it
 * opens a popover list of all conversations, with the ability to select
 * or delete entries. Supports upward placement for bottom-anchored layouts.
 */

import type { ConversationMeta } from '../../../core/types';

export interface ConversationListCallbacks {
  onSelect: (conversationId: string) => void;
  onDelete: (conversationId: string) => void;
  onNew: () => void;
}

export type PopoverPlacement = 'down' | 'up';

export interface ConversationListOptions {
  /** Direction the popover opens. Default: 'down'. */
  placement?: PopoverPlacement;
}

export class ConversationList {
  private triggerBtn: HTMLElement;
  private popoverEl: HTMLElement | null = null;
  private items: ConversationMeta[] = [];
  private activeId: string | null = null;
  private callbacks: ConversationListCallbacks;
  private parentEl: HTMLElement;
  private placement: PopoverPlacement;
  private isOpen = false;
  private anchorEls = new Set<HTMLElement>();
  private closeHandler: (e: MouseEvent) => void;
  private escHandler: (e: KeyboardEvent) => void;

  constructor(
    parentEl: HTMLElement,
    callbacks: ConversationListCallbacks,
    opts?: ConversationListOptions,
  ) {
    this.parentEl = parentEl;
    this.callbacks = callbacks;
    this.placement = opts?.placement ?? 'down';

    // Trigger button — shows current title or "New chat"
    this.triggerBtn = parentEl.createDiv({ cls: 'oa-conv-trigger' });
    this.triggerBtn.createSpan({ cls: 'oa-conv-trigger-label', text: 'New chat' });
    const chevron = this.triggerBtn.createSpan({ cls: 'oa-conv-trigger-chevron' });
    chevron.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

    this.triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleOpen();
    });

    // Register trigger as an anchor element
    this.anchorEls.add(this.triggerBtn);

    // Global click handler to close popover — respects all anchor elements
    this.closeHandler = (e: MouseEvent) => {
      if (!this.isOpen || !this.popoverEl) return;
      const target = e.target as Node;
      if (this.popoverEl.contains(target)) return;
      const isAnchorClick = [...this.anchorEls].some(a => a.contains(target));
      if (!isAnchorClick) {
        this.close();
      }
    };
    document.addEventListener('click', this.closeHandler);

    // Escape key to close
    this.escHandler = (e: KeyboardEvent) => {
      if (this.isOpen && e.key === 'Escape') {
        this.close();
      }
    };
    document.addEventListener('keydown', this.escHandler);
  }

  /**
   * Register an additional anchor element (e.g. an external history button).
   * Clicks on anchor elements won't close the popover.
   */
  registerAnchor(el: HTMLElement): void {
    this.anchorEls.add(el);
  }

  /** Update the list of conversations. */
  setItems(items: ConversationMeta[]): void {
    this.items = items;
    if (this.isOpen) {
      this.renderPopover();
    }
  }

  /** Mark a conversation as active (highlighted in list). */
  setActive(conversationId: string | null): void {
    this.activeId = conversationId;
    this.updateTriggerLabel();
    if (this.isOpen) {
      this.renderPopover();
    }
  }

  private updateTriggerLabel(): void {
    const label = this.triggerBtn.querySelector('.oa-conv-trigger-label');
    if (!label) return;

    if (this.activeId) {
      const active = this.items.find(i => i.id === this.activeId);
      label.textContent = active?.title || 'New chat';
    } else {
      label.textContent = 'New chat';
    }
  }

  /**
   * Toggle the popover open/closed.
   * Accepts an optional event to stop propagation (prevents instant close
   * when called from an external button).
   */
  toggleOpen(e?: Event): void {
    e?.stopPropagation();
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private open(): void {
    this.isOpen = true;
    this.triggerBtn.addClass('oa-conv-trigger-open');
    this.renderPopover();
  }

  private close(): void {
    this.isOpen = false;
    this.triggerBtn.removeClass('oa-conv-trigger-open');
    if (this.popoverEl) {
      this.popoverEl.remove();
      this.popoverEl = null;
    }
  }

  private renderPopover(): void {
    if (this.popoverEl) {
      this.popoverEl.remove();
    }

    const placementCls = this.placement === 'up' ? 'oa-conv-popover-up' : '';
    this.popoverEl = this.parentEl.createDiv({ cls: `oa-conv-popover ${placementCls}`.trim() });

    // New chat button at top
    const newChatRow = this.popoverEl.createDiv({ cls: 'oa-conv-item oa-conv-new-chat' });
    newChatRow.createSpan({ cls: 'oa-conv-new-icon' }).innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    newChatRow.createSpan({ text: 'New chat' });
    newChatRow.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onNew();
      this.close();
    });

    if (this.items.length === 0) {
      const emptyEl = this.popoverEl.createDiv({ cls: 'oa-conv-empty' });
      emptyEl.createSpan({ text: 'No conversations yet' });
      return;
    }

    // Conversation items
    const listEl = this.popoverEl.createDiv({ cls: 'oa-conv-list' });

    for (const item of this.items) {
      const row = listEl.createDiv({
        cls: `oa-conv-item ${item.id === this.activeId ? 'oa-conv-item-active' : ''}`,
      });

      const contentEl = row.createDiv({ cls: 'oa-conv-item-content' });
      contentEl.createDiv({ cls: 'oa-conv-item-title', text: item.title });

      const infoEl = contentEl.createDiv({ cls: 'oa-conv-item-info' });
      infoEl.createSpan({ text: this.formatDate(item.updatedAt) });
      if (item.messageCount > 0) {
        infoEl.createSpan({ text: ` · ${item.messageCount} msgs` });
      }

      // Click to select
      contentEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onSelect(item.id);
        this.close();
      });

      // Delete button
      const deleteBtn = row.createEl('button', {
        cls: 'oa-conv-item-delete clickable-icon',
        attr: { 'aria-label': 'Delete conversation' },
      });
      deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onDelete(item.id);
      });
    }
  }

  /** Format a timestamp for display. */
  private formatDate(ts: number): string {
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Today: show time
    if (diff < 24 * 60 * 60 * 1000 && date.getDate() === now.getDate()) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth()) {
      return 'Yesterday';
    }

    // This year: show month/day
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    // Older: show full date
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  destroy(): void {
    document.removeEventListener('click', this.closeHandler);
    document.removeEventListener('keydown', this.escHandler);
    this.close();
    this.triggerBtn.remove();
  }
}
