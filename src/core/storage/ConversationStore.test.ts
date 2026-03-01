import { describe, it, expect } from 'vitest';
import { ConversationStore } from './ConversationStore';

describe('ConversationStore.generateTitle', () => {
  it('returns short text as-is', () => {
    expect(ConversationStore.generateTitle('Hello world')).toBe('Hello world');
  });

  it('truncates long text to 50 chars', () => {
    const long = 'A'.repeat(60);
    const title = ConversationStore.generateTitle(long);
    expect(title.length).toBeLessThanOrEqual(50);
    expect(title).toBe('A'.repeat(47) + '...');
  });

  it('uses only the first line', () => {
    const multiLine = 'First line\nSecond line\nThird line';
    expect(ConversationStore.generateTitle(multiLine)).toBe('First line');
  });

  it('trims whitespace', () => {
    expect(ConversationStore.generateTitle('  Hello  ')).toBe('Hello');
  });

  it('falls back to "New chat" for empty string', () => {
    expect(ConversationStore.generateTitle('')).toBe('New chat');
  });

  it('falls back to "New chat" for whitespace-only input', () => {
    expect(ConversationStore.generateTitle('   ')).toBe('New chat');
  });

  it('handles \\r\\n line endings', () => {
    expect(ConversationStore.generateTitle('Hello\r\nWorld')).toBe('Hello');
  });
});
