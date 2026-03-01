import { describe, it, expect } from 'vitest';
import { buildVaultSystemPrompt } from './systemPrompt';

describe('buildVaultSystemPrompt', () => {
  const vaultPath = '/Users/test/my-vault';

  it('should include vault path', () => {
    const prompt = buildVaultSystemPrompt({ vaultPath });
    expect(prompt).toContain(vaultPath);
  });

  it('should include all available tools', () => {
    const prompt = buildVaultSystemPrompt({ vaultPath });
    const expectedTools = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];
    for (const tool of expectedTools) {
      expect(prompt).toContain(`- ${tool}:`);
    }
  });

  it('should include Obsidian-specific guidelines', () => {
    const prompt = buildVaultSystemPrompt({ vaultPath });
    expect(prompt).toContain('Obsidian vault');
    expect(prompt).toContain('.md');
  });

  it('should include current_note instruction', () => {
    const prompt = buildVaultSystemPrompt({ vaultPath });
    expect(prompt).toContain('<current_note>');
  });

  it('should include date and time', () => {
    const prompt = buildVaultSystemPrompt({ vaultPath });
    expect(prompt).toContain('Current date and time:');
  });

  it('should append custom prompt when provided', () => {
    const customPrompt = 'Always respond in Chinese.';
    const prompt = buildVaultSystemPrompt({ vaultPath, customPrompt });
    expect(prompt).toContain('Custom instructions:');
    expect(prompt).toContain(customPrompt);
  });

  it('should not include custom instructions section when not provided', () => {
    const prompt = buildVaultSystemPrompt({ vaultPath });
    expect(prompt).not.toContain('Custom instructions:');
  });
});
