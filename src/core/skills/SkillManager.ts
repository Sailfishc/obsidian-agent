import { type App, TFile, TFolder, normalizePath } from 'obsidian';
import { parseFrontmatter, stripFrontmatter } from '@/utils/frontmatter';
import type { SkillDefinition, SkillDiagnostic, SkillFrontmatter, SkillsSettings } from './types';
import { formatSkillsForPrompt } from './types';

// Re-export types and formatting for consumers
export { type SkillDefinition, type SkillDiagnostic, type SkillsSettings, formatSkillsForPrompt } from './types';

// ── Constants ────────────────────────────────────────────────────────────

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const SKILL_FILE_NAME = 'SKILL.md';

// ── Validation helpers ───────────────────────────────────────────────────

function validateName(name: string, parentDirName: string): string[] {
  const errors: string[] = [];

  if (name !== parentDirName) {
    errors.push(`name "${name}" does not match parent directory "${parentDirName}"`);
  }

  if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push('name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)');
  }

  if (name.startsWith('-') || name.endsWith('-')) {
    errors.push('name must not start or end with a hyphen');
  }

  if (name.includes('--')) {
    errors.push('name must not contain consecutive hyphens');
  }

  return errors;
}

function validateDescription(description: string | undefined): string[] {
  const errors: string[] = [];

  if (!description || description.trim() === '') {
    errors.push('description is required');
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
  }

  return errors;
}

// ── XML helper ───────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── SkillManager ─────────────────────────────────────────────────────────

export class SkillManager {
  private app: App;
  private getOptions: () => SkillsSettings;
  private skills: SkillDefinition[] = [];
  private diagnostics: SkillDiagnostic[] = [];

  constructor(app: App, getOptions: () => SkillsSettings) {
    this.app = app;
    this.getOptions = getOptions;
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Scan configured roots for SKILL.md files.
   * Safe: never throws; malformed skills are skipped with diagnostics.
   */
  async reload(): Promise<{ skills: SkillDefinition[]; diagnostics: SkillDiagnostic[] }> {
    const options = this.getOptions();
    const skillMap = new Map<string, SkillDefinition>();
    const allDiagnostics: SkillDiagnostic[] = [];

    if (!options.enabled) {
      this.skills = [];
      this.diagnostics = [];
      return { skills: [], diagnostics: [] };
    }

    for (const root of options.roots) {
      const normalizedRoot = normalizePath(root);
      const folder = this.app.vault.getAbstractFileByPath(normalizedRoot);

      if (!folder || !(folder instanceof TFolder)) {
        // Root doesn't exist yet — that's fine, skip silently
        continue;
      }

      try {
        const result = await this.scanFolder(folder, normalizedRoot);
        allDiagnostics.push(...result.diagnostics);

        for (const skill of result.skills) {
          const existing = skillMap.get(skill.name);
          if (existing) {
            allDiagnostics.push({
              type: 'collision',
              message: `name "${skill.name}" collision: "${existing.filePath}" wins over "${skill.filePath}"`,
              path: skill.filePath,
              skillName: skill.name,
            });
          } else {
            skillMap.set(skill.name, skill);
          }
        }
      } catch (err) {
        console.warn(`[skills] Error scanning root "${root}":`, err);
      }
    }

    this.skills = Array.from(skillMap.values());
    this.diagnostics = allDiagnostics;

    if (this.skills.length > 0) {
      console.log(`[skills] Loaded ${this.skills.length} skill(s): ${this.skills.map((s: SkillDefinition) => s.name).join(', ')}`);
    }
    if (allDiagnostics.length > 0) {
      console.warn(`[skills] ${allDiagnostics.length} diagnostic(s):`, allDiagnostics);
    }

    return { skills: this.skills, diagnostics: allDiagnostics };
  }

  getSkills(): SkillDefinition[] {
    return this.skills;
  }

  getDiagnostics(): SkillDiagnostic[] {
    return this.diagnostics;
  }

  /** Skills visible to the model (disableModelInvocation=false). */
  getPromptVisibleSkills(): SkillDefinition[] {
    return this.skills.filter((s: SkillDefinition) => !s.disableModelInvocation);
  }

  /**
   * Returns the system-prompt fragment (XML) for available skills,
   * or empty string when disabled / no skills.
   */
  formatSkillsForPrompt(): string {
    const options = this.getOptions();
    if (!options.enabled) return '';

    return formatSkillsForPrompt(this.getPromptVisibleSkills());
  }

  /**
   * If input starts with `/skill:name`, expand it to a `<skill>` block.
   * Returns null when input is not a skill command.
   * Returns `{ expandedText: null, error }` when it IS a skill command but expansion failed.
   */
  async tryExpandSkillCommand(
    input: string,
  ): Promise<
    | { expandedText: string; skill: SkillDefinition }
    | { expandedText: null; error: string }
    | null
  > {
    const options = this.getOptions();
    if (!options.enabled || !options.enableSkillCommands) return null;

    const match = input.match(/^\/skill:([a-z0-9-]+)\s*([\s\S]*)$/);
    if (!match) return null;

    const skillName = match[1];
    const userArgs = match[2].trim();

    const skill = this.skills.find((s: SkillDefinition) => s.name === skillName);
    if (!skill) {
      return {
        expandedText: null,
        error: `Skill "${skillName}" not found. Available skills: ${this.skills.map((s: SkillDefinition) => s.name).join(', ') || '(none)'}`,
      };
    }

    try {
      const file = this.app.vault.getAbstractFileByPath(skill.filePath);
      if (!file || !(file instanceof TFile)) {
        return {
          expandedText: null,
          error: `Skill file not found: ${skill.filePath}`,
        };
      }

      const rawContent = await this.app.vault.cachedRead(file);
      const body = stripFrontmatter(rawContent);

      let expanded = `<skill name="${escapeXml(skill.name)}" location="${escapeXml(skill.filePath)}">`;
      expanded += `\nReferences are relative to ${escapeXml(skill.baseDir)}.`;
      expanded += `\n\n${body}`;
      expanded += '\n</skill>';

      if (userArgs) {
        expanded += `\n\n${userArgs}`;
      }

      return { expandedText: expanded, skill };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error reading skill file';
      return { expandedText: null, error: msg };
    }
  }

  // ── Private: discovery ─────────────────────────────────────────────────

  /**
   * Recursively scan a folder for SKILL.md files.
   */
  private async scanFolder(
    folder: TFolder,
    _rootPath: string,
  ): Promise<{ skills: SkillDefinition[]; diagnostics: SkillDiagnostic[] }> {
    const skills: SkillDefinition[] = [];
    const diagnostics: SkillDiagnostic[] = [];

    // Sort children by path for deterministic ordering (collision = first wins)
    const sortedChildren = [...folder.children].sort((a, b) => a.path.localeCompare(b.path));

    for (const child of sortedChildren) {
      if (child.name.startsWith('.')) continue;

      if (child instanceof TFolder) {
        // Check if this folder contains a SKILL.md
        const skillFile = child.children.find(
          (c): c is TFile => c instanceof TFile && c.name === SKILL_FILE_NAME,
        );

        if (skillFile) {
          const result = await this.parseSkillFile(skillFile, child.name);
          diagnostics.push(...result.diagnostics);
          if (result.skill) {
            skills.push(result.skill);
          }
        }

        // Also recurse into subfolders (nested skills)
        const subResult = await this.scanFolder(child, _rootPath);
        skills.push(...subResult.skills);
        diagnostics.push(...subResult.diagnostics);
      }
    }

    return { skills, diagnostics };
  }

  /**
   * Parse a single SKILL.md file into a SkillDefinition.
   */
  private async parseSkillFile(
    file: TFile,
    parentDirName: string,
  ): Promise<{ skill: SkillDefinition | null; diagnostics: SkillDiagnostic[] }> {
    const diagnostics: SkillDiagnostic[] = [];
    const filePath = file.path;

    try {
      const rawContent = await this.app.vault.cachedRead(file);
      let frontmatter: SkillFrontmatter;

      try {
        const parsed = parseFrontmatter<SkillFrontmatter>(rawContent);
        frontmatter = parsed.frontmatter;
      } catch {
        diagnostics.push({
          type: 'warning',
          message: 'Invalid YAML frontmatter',
          path: filePath,
        });
        return { skill: null, diagnostics };
      }

      // Normalize types: parseYaml can return non-strings
      const rawName = typeof frontmatter.name === 'string' ? frontmatter.name : undefined;
      const description = typeof frontmatter.description === 'string' ? frontmatter.description : undefined;

      if (frontmatter.description !== undefined && typeof frontmatter.description !== 'string') {
        diagnostics.push({ type: 'warning', message: 'description must be a string', path: filePath });
      }

      // Use name from frontmatter, or fall back to parent directory name
      const name = rawName || parentDirName;

      // Validate description
      const descErrors = validateDescription(description);
      for (const error of descErrors) {
        diagnostics.push({ type: 'warning', message: error, path: filePath });
      }

      // Validate name
      const nameErrors = validateName(name, parentDirName);
      for (const error of nameErrors) {
        diagnostics.push({ type: 'warning', message: error, path: filePath });
      }

      // Skip skill if description is missing (required field)
      if (!description || description.trim() === '') {
        return { skill: null, diagnostics };
      }

      // Compute vault-relative base directory
      const baseDir = file.parent?.path ?? '';

      return {
        skill: {
          name,
          description,
          filePath,
          baseDir,
          source: 'vault',
          disableModelInvocation: frontmatter['disable-model-invocation'] === true,
        },
        diagnostics,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse skill file';
      diagnostics.push({ type: 'warning', message, path: filePath });
      return { skill: null, diagnostics };
    }
  }
}
