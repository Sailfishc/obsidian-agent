// ── Skill types (no Obsidian dependency, safe for testing) ───────────────

export interface SkillDefinition {
  name: string;
  description: string;
  /** Vault-relative path to the SKILL.md file */
  filePath: string;
  /** Vault-relative directory containing the SKILL.md */
  baseDir: string;
  source: 'vault';
  disableModelInvocation: boolean;
}

export interface SkillDiagnostic {
  type: 'warning' | 'collision';
  message: string;
  /** Vault-relative path */
  path: string;
  skillName?: string;
}

export interface SkillsSettings {
  enabled: boolean;
  enableSkillCommands: boolean;
  roots: string[];
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'disable-model-invocation'?: boolean;
  [key: string]: unknown;
}

// ── XML helpers ──────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Prompt formatting ────────────────────────────────────────────────────

/**
 * Format skills for inclusion in a system prompt.
 * Uses XML format per Agent Skills standard.
 * Skills with disableModelInvocation=true should be pre-filtered out.
 */
export function formatSkillsForPrompt(skills: SkillDefinition[]): string {
  if (skills.length === 0) return '';

  const lines = [
    '',
    '',
    'The following skills provide specialized instructions for specific tasks.',
    'Use the read tool to load a skill\'s file when the task matches its description.',
    'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md) and use the resulting vault-relative path in tool commands.',
    '',
    '<available_skills>',
  ];

  for (const skill of skills) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push('  </skill>');
  }

  lines.push('</available_skills>');

  return lines.join('\n');
}
