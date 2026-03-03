import { type App, normalizePath } from 'obsidian';
import type { SkillsSettings } from './types';

const SKILL_FILE_NAME = 'SKILL.md';

export interface SkillData {
  name: string;
  description: string;
  prompt: string;
  disableModelInvocation: boolean;
}

/**
 * Vault CRUD for SKILL.md files.
 * Skills are stored at `<root>/<name>/SKILL.md` where root is the first
 * configured skills directory.
 *
 * Uses vault.adapter (filesystem-level) exclusively — same as Claudian.
 * This avoids issues with Obsidian's vault cache not tracking dot-prefixed
 * folders like `.claude/`.
 */
export class SkillStorage {
  private app: App;
  private getSettings: () => SkillsSettings;

  constructor(app: App, getSettings: () => SkillsSettings) {
    this.app = app;
    this.getSettings = getSettings;
  }

  /** Returns the first configured root (normalized), creating it if needed. */
  private async getStorageRoot(): Promise<string> {
    const roots = this.getSettings().roots;
    const root = roots.length > 0 ? roots[0] : '.claude/skills';
    const normalized = normalizePath(root);
    await this.ensureFolder(normalized);
    return normalized;
  }

  /** Build the folder path for a skill. */
  private async skillFolderPath(name: string): Promise<string> {
    const root = await this.getStorageRoot();
    return normalizePath(`${root}/${name}`);
  }

  /** Build the SKILL.md path for a skill. */
  private async skillFilePath(name: string): Promise<string> {
    const folder = await this.skillFolderPath(name);
    return normalizePath(`${folder}/${SKILL_FILE_NAME}`);
  }

  /**
   * Ensure a folder exists on disk, creating parent folders as needed.
   * Uses adapter.mkdir() directly — works for dot-prefixed paths.
   */
  private async ensureFolder(path: string): Promise<void> {
    if (await this.app.vault.adapter.exists(path)) return;

    // Create parent folders recursively
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!await this.app.vault.adapter.exists(current)) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  /** Serialize a SkillData into SKILL.md content (frontmatter + body). */
  private serialize(data: SkillData): string {
    const lines: string[] = ['---'];
    lines.push(`name: ${data.name}`);
    lines.push(`description: "${data.description.replace(/"/g, '\\"')}"`);
    if (data.disableModelInvocation) {
      lines.push('disable-model-invocation: true');
    }
    lines.push('---');
    lines.push('');
    lines.push(data.prompt);
    return lines.join('\n');
  }

  /**
   * Create or update a skill.
   * If `oldName` is provided and different from `data.name`, the old folder is removed.
   */
  async save(data: SkillData, oldName?: string): Promise<void> {
    // If renaming, delete the old skill folder first
    if (oldName && oldName !== data.name) {
      await this.delete(oldName);
    }

    const folderPath = await this.skillFolderPath(data.name);
    const filePath = await this.skillFilePath(data.name);
    const content = this.serialize(data);

    // Ensure the skill folder exists
    await this.ensureFolder(folderPath);

    // Write the SKILL.md file (adapter.write creates or overwrites)
    await this.app.vault.adapter.write(filePath, content);

    console.log(`[skills] Saved skill file: ${filePath}`);

    // Verify write
    const exists = await this.app.vault.adapter.exists(filePath);
    console.log(`[skills] Verified file on disk: ${exists}`);
  }

  /** Delete a skill folder and its SKILL.md. */
  async delete(name: string): Promise<void> {
    const folderPath = await this.skillFolderPath(name);

    if (await this.app.vault.adapter.exists(folderPath)) {
      // Remove the SKILL.md file first
      const filePath = normalizePath(`${folderPath}/${SKILL_FILE_NAME}`);
      if (await this.app.vault.adapter.exists(filePath)) {
        await this.app.vault.adapter.remove(filePath);
      }

      // Try to remove the folder (only succeeds if empty)
      try {
        await this.app.vault.adapter.rmdir(folderPath, false);
      } catch {
        // Folder not empty — that's fine, user may have other files there
      }
    }
  }

  /** Check if a skill with the given name already exists on disk. */
  async exists(name: string): Promise<boolean> {
    const filePath = await this.skillFilePath(name);
    return this.app.vault.adapter.exists(filePath);
  }
}
