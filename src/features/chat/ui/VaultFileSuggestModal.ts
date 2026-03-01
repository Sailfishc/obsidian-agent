import { App, FuzzySuggestModal, TFile } from 'obsidian';

export interface VaultFileSuggestOptions {
  /** Paths to exclude from the suggestion list (already selected). */
  excludePaths?: Set<string>;
  /** Called when the user picks a file. */
  onChoose: (file: TFile) => void;
}

/**
 * Fuzzy file picker that searches all markdown files in the vault.
 * Used by the `@` trigger in the chat input.
 */
export class VaultFileSuggestModal extends FuzzySuggestModal<TFile> {
  private opts: VaultFileSuggestOptions;

  constructor(app: App, opts: VaultFileSuggestOptions) {
    super(app);
    this.opts = opts;
    this.setPlaceholder('Search vault files…');
  }

  getItems(): TFile[] {
    const exclude = this.opts.excludePaths ?? new Set<string>();
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => !exclude.has(f.path))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.opts.onChoose(file);
  }
}
