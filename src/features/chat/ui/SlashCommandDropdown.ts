/**
 * Slash command dropdown for skill invocation.
 * Shows available /skill: commands when the user types / at the start of input.
 */

export interface SlashCommandItem {
  /** Full command name, e.g. "skill:calendar" */
  name: string;
  /** User-facing description */
  description: string;
  /** What type of command */
  type: 'skill' | 'builtin';
}

export interface SlashCommandDropdownCallbacks {
  onSelect: (command: SlashCommandItem) => void;
}

export class SlashCommandDropdown {
  private containerEl: HTMLElement;
  private dropdownEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement;
  private callbacks: SlashCommandDropdownCallbacks;
  private commands: SlashCommandItem[] = [];
  private filteredCommands: SlashCommandItem[] = [];
  private selectedIndex = 0;
  private visible = false;

  constructor(
    containerEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    callbacks: SlashCommandDropdownCallbacks,
  ) {
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
  }

  /** Update the available commands list. */
  setCommands(commands: SlashCommandItem[]): void {
    this.commands = commands;
  }

  /**
   * Called on input change. Checks if we should show/hide the dropdown.
   * Returns true if the dropdown is now visible (so caller can suppress other handling).
   */
  handleInputChange(): boolean {
    const text = this.inputEl.value;
    const cursorPos = this.inputEl.selectionStart ?? 0;
    const textBeforeCursor = text.substring(0, cursorPos);

    // Only show dropdown if / is at position 0
    if (!text.startsWith('/')) {
      this.hide();
      return false;
    }

    const searchText = textBeforeCursor.substring(1);

    // Hide if there's whitespace (command already typed, user is writing args)
    if (/\s/.test(searchText)) {
      this.hide();
      return false;
    }

    // Filter commands
    const searchLower = searchText.toLowerCase();
    this.filteredCommands = this.commands
      .filter(cmd =>
        cmd.name.toLowerCase().includes(searchLower) ||
        cmd.description.toLowerCase().includes(searchLower),
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    if (this.filteredCommands.length === 0 && searchText.length > 0) {
      this.hide();
      return false;
    }

    this.selectedIndex = 0;
    this.render();
    return true;
  }

  /**
   * Handle keyboard navigation. Returns true if the key was consumed.
   */
  handleKeydown(e: KeyboardEvent): boolean {
    if (!this.visible) return false;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.navigate(1);
        return true;
      case 'ArrowUp':
        e.preventDefault();
        this.navigate(-1);
        return true;
      case 'Tab':
      case 'Enter':
        if (this.filteredCommands.length > 0) {
          e.preventDefault();
          this.selectItem();
          return true;
        }
        return false;
      case 'Escape':
        e.preventDefault();
        this.hide();
        return true;
    }
    return false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  hide(): void {
    this.visible = false;
    if (this.dropdownEl) {
      this.dropdownEl.style.display = 'none';
    }
  }

  destroy(): void {
    if (this.dropdownEl) {
      this.dropdownEl.remove();
      this.dropdownEl = null;
    }
  }

  private render(): void {
    if (!this.dropdownEl) {
      this.dropdownEl = this.containerEl.createDiv({ cls: 'oa-slash-dropdown' });
    }

    this.dropdownEl.empty();
    this.dropdownEl.style.display = '';
    this.visible = true;

    if (this.filteredCommands.length === 0) {
      const emptyEl = this.dropdownEl.createDiv({ cls: 'oa-slash-empty' });
      emptyEl.setText('No matching commands');
      return;
    }

    for (let i = 0; i < this.filteredCommands.length; i++) {
      const cmd = this.filteredCommands[i];
      const itemEl = this.dropdownEl.createDiv({
        cls: `oa-slash-item${i === this.selectedIndex ? ' is-selected' : ''}`,
      });

      const nameEl = itemEl.createSpan({ cls: 'oa-slash-name' });
      nameEl.setText(`/${cmd.name}`);

      if (cmd.description) {
        const descEl = itemEl.createSpan({ cls: 'oa-slash-desc' });
        descEl.setText(cmd.description);
      }

      itemEl.addEventListener('click', () => {
        this.selectedIndex = i;
        this.selectItem();
      });

      itemEl.addEventListener('mouseenter', () => {
        this.selectedIndex = i;
        this.updateSelection();
      });
    }
  }

  private navigate(direction: number): void {
    const maxIndex = this.filteredCommands.length - 1;
    this.selectedIndex = Math.max(0, Math.min(maxIndex, this.selectedIndex + direction));
    this.updateSelection();
  }

  private updateSelection(): void {
    if (!this.dropdownEl) return;
    const items = this.dropdownEl.querySelectorAll('.oa-slash-item');
    items.forEach((item, index) => {
      if (index === this.selectedIndex) {
        item.addClass('is-selected');
        (item as HTMLElement).scrollIntoView({ block: 'nearest' });
      } else {
        item.removeClass('is-selected');
      }
    });
  }

  private selectItem(): void {
    if (this.filteredCommands.length === 0) return;

    const selected = this.filteredCommands[this.selectedIndex];
    if (!selected) return;

    // Replace input with the full command + trailing space
    this.inputEl.value = `/${selected.name} `;
    const newPos = this.inputEl.value.length;
    this.inputEl.selectionStart = newPos;
    this.inputEl.selectionEnd = newPos;

    this.hide();
    this.callbacks.onSelect(selected);
    this.inputEl.focus();
  }
}
