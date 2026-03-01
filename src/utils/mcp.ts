/**
 * MCP utility functions for mention extraction and command parsing.
 */

/**
 * Extract @mentions from text that match known MCP server names.
 * Only matches against the provided set of valid names.
 */
export function extractMcpMentions(text: string, validNames: Set<string>): Set<string> {
  const mentions = new Set<string>();
  const regex = /@([a-zA-Z0-9._-]+)(?!\/)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Strip trailing punctuation that may be part of the sentence, not the name
    const name = match[1].replace(/[.,;:!?]+$/, '');
    if (name && validNames.has(name)) {
      mentions.add(name);
    }
  }

  return mentions;
}

/**
 * Parse a command string into command and arguments.
 * If providedArgs is non-empty, use those instead of parsing.
 */
export function parseCommand(command: string, providedArgs?: string[]): { cmd: string; args: string[] } {
  if (providedArgs && providedArgs.length > 0) {
    return { cmd: command, args: providedArgs };
  }

  const parts = splitCommandString(command);
  if (parts.length === 0) {
    return { cmd: '', args: [] };
  }

  return { cmd: parts[0], args: parts.slice(1) };
}

/**
 * Split a command string respecting quotes.
 */
export function splitCommandString(cmdStr: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < cmdStr.length; i++) {
    const char = cmdStr[i];

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
      continue;
    }

    if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = '';
      continue;
    }

    if (/\s/.test(char) && !inQuote) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}
