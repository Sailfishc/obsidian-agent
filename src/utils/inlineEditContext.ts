/**
 * Inline Edit Context Utilities
 *
 * Builds editor context tags for inline edit prompts.
 */

export type InlineEditMode = 'selection' | 'cursor';

export interface CursorContext {
  beforeCursor: string;
  afterCursor: string;
  isInbetween: boolean;
  line: number;   // 0-indexed
  column: number; // 0-indexed
}

/**
 * Finds the nearest non-empty line in a direction from the given start line.
 */
function findNearestNonEmptyLine(
  getLine: (line: number) => string,
  lineCount: number,
  startLine: number,
  direction: 'before' | 'after',
): string {
  const step = direction === 'before' ? -1 : 1;
  for (let i = startLine + step; i >= 0 && i < lineCount; i += step) {
    const content = getLine(i);
    if (content.trim().length > 0) {
      return content;
    }
  }
  return '';
}

/**
 * Builds cursor context from editor state.
 * All line/column params are 0-indexed.
 */
export function buildCursorContext(
  getLine: (line: number) => string,
  lineCount: number,
  line: number,
  column: number,
): CursorContext {
  const lineContent = getLine(line);
  const beforeCursor = lineContent.substring(0, column);
  const afterCursor = lineContent.substring(column);

  const lineIsEmpty = lineContent.trim().length === 0;
  const nothingBefore = beforeCursor.trim().length === 0;
  const nothingAfter = afterCursor.trim().length === 0;
  const isInbetween = lineIsEmpty || (nothingBefore && nothingAfter);

  let contextBefore = beforeCursor;
  let contextAfter = afterCursor;

  if (isInbetween) {
    contextBefore = findNearestNonEmptyLine(getLine, lineCount, line, 'before');
    contextAfter = findNearestNonEmptyLine(getLine, lineCount, line, 'after');
  }

  return { beforeCursor: contextBefore, afterCursor: contextAfter, isInbetween, line, column };
}

/**
 * Formats the editor selection context as an XML tag for the prompt.
 */
export function formatEditorSelectionTag(args: {
  notePath: string;
  selectedText: string;
  startLine?: number; // 1-indexed for display
  lineCount?: number;
}): string {
  const lineAttr = args.startLine && args.lineCount
    ? ` lines="${args.startLine}-${args.startLine + args.lineCount - 1}"`
    : '';
  return [
    `<editor_selection path="${args.notePath}"${lineAttr}>`,
    args.selectedText,
    '</editor_selection>',
  ].join('\n');
}

/**
 * Formats the editor cursor context as an XML tag for the prompt.
 */
export function formatEditorCursorTag(args: {
  notePath: string;
  cursorContext: CursorContext;
}): string {
  const ctx = args.cursorContext;
  let cursorContent: string;

  if (ctx.isInbetween) {
    const parts: string[] = [];
    if (ctx.beforeCursor) parts.push(ctx.beforeCursor);
    parts.push('| #inbetween');
    if (ctx.afterCursor) parts.push(ctx.afterCursor);
    cursorContent = parts.join('\n');
  } else {
    cursorContent = `${ctx.beforeCursor}|${ctx.afterCursor} #inline`;
  }

  return [
    `<editor_cursor path="${args.notePath}">`,
    cursorContent,
    '</editor_cursor>',
  ].join('\n');
}

/**
 * Builds the full inline edit prompt with instruction + context tags.
 */
export function buildInlineEditUserPrompt(args: {
  instruction: string;
  mode: InlineEditMode;
  notePath: string;
  selectedText?: string;
  startLine?: number;
  lineCount?: number;
  cursorContext?: CursorContext;
}): string {
  let contextTag: string;

  if (args.mode === 'cursor' && args.cursorContext) {
    contextTag = formatEditorCursorTag({
      notePath: args.notePath,
      cursorContext: args.cursorContext,
    });
  } else {
    contextTag = formatEditorSelectionTag({
      notePath: args.notePath,
      selectedText: args.selectedText || '',
      startLine: args.startLine,
      lineCount: args.lineCount,
    });
  }

  return `${args.instruction}\n\n${contextTag}`;
}
