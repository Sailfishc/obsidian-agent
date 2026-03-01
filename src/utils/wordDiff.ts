/**
 * Word-level diff utilities for inline edit preview.
 * Uses LCS-based algorithm to compute word-level differences.
 */

export interface DiffOp {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

/** Escapes HTML special characters to prevent injection in rendered content. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Trims leading and trailing blank lines from insertion text.
 * Matches the behavior expected by cursor insertion preview.
 */
export function normalizeInsertionText(text: string): string {
  return text.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, '');
}

/** Maximum number of word tokens before falling back to simple delete/insert diff. */
const MAX_DIFF_TOKENS = 2000;

/**
 * Computes word-level diff between two texts using LCS algorithm.
 * Splits on whitespace boundaries (preserving whitespace tokens).
 * Falls back to a simple delete+insert diff if the input is too large.
 */
export function computeWordDiff(oldText: string, newText: string): DiffOp[] {
  const oldWords = oldText.split(/(\s+)/);
  const newWords = newText.split(/(\s+)/);

  // Safeguard: avoid O(m*n) blow-up on very large inputs
  if (oldWords.length * newWords.length > MAX_DIFF_TOKENS * MAX_DIFF_TOKENS) {
    const ops: DiffOp[] = [];
    if (oldText) ops.push({ type: 'delete', text: oldText });
    if (newText) ops.push({ type: 'insert', text: newText });
    return ops;
  }
  const m = oldWords.length;
  const n = newWords.length;

  // Build LCS table
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldWords[i - 1] === newWords[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to produce diff ops
  const temp: DiffOp[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      temp.push({ type: 'equal', text: oldWords[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.push({ type: 'insert', text: newWords[j - 1] });
      j--;
    } else {
      temp.push({ type: 'delete', text: oldWords[i - 1] });
      i--;
    }
  }

  temp.reverse();

  // Merge consecutive ops of the same type
  const ops: DiffOp[] = [];
  for (const op of temp) {
    if (ops.length > 0 && ops[ops.length - 1].type === op.type) {
      ops[ops.length - 1].text += op.text;
    } else {
      ops.push({ ...op });
    }
  }

  return ops;
}

/**
 * Converts diff operations to HTML with highlighted deletions and insertions.
 */
export function diffOpsToHtml(ops: DiffOp[]): string {
  return ops
    .map((op) => {
      const escaped = escapeHtml(op.text);
      switch (op.type) {
        case 'delete':
          return `<span class="oa-diff-del">${escaped}</span>`;
        case 'insert':
          return `<span class="oa-diff-ins">${escaped}</span>`;
        default:
          return escaped;
      }
    })
    .join('');
}
