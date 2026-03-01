import { parseYaml } from 'obsidian';

/**
 * Normalize line endings to LF.
 */
function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Extract YAML frontmatter block from markdown content.
 * Returns the raw YAML string and the body (content after frontmatter).
 */
export function extractFrontmatterBlock(content: string): { yaml: string | null; body: string } {
  const normalized = normalizeNewlines(content);

  if (!normalized.startsWith('---')) {
    return { yaml: null, body: normalized };
  }

  const endIndex = normalized.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { yaml: null, body: normalized };
  }

  return {
    yaml: normalized.slice(4, endIndex),
    body: normalized.slice(endIndex + 4).trim(),
  };
}

/**
 * Parse YAML frontmatter from markdown content using Obsidian's built-in parser.
 * Returns the parsed object and the body text.
 */
export function parseFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
  content: string,
): { frontmatter: T; body: string } {
  const { yaml, body } = extractFrontmatterBlock(content);
  if (!yaml) {
    return { frontmatter: {} as T, body };
  }
  try {
    const parsed = parseYaml(yaml);
    return { frontmatter: (parsed ?? {}) as T, body };
  } catch (e) {
    // Re-throw with detail so callers can produce useful diagnostics
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid YAML frontmatter: ${detail}`);
  }
}

/**
 * Strip frontmatter from markdown content, returning only the body.
 */
export function stripFrontmatter(content: string): string {
  const { body } = extractFrontmatterBlock(content);
  return body;
}
