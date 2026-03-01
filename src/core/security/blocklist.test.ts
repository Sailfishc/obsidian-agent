import { describe, it, expect } from 'vitest';
import { isBlockedCommand } from './blocklist';

describe('isBlockedCommand', () => {
  const blocklist = ['rm -rf', 'sudo', 'chmod', 'mkfs'];

  it('should block exact matches', () => {
    expect(isBlockedCommand('rm -rf /', blocklist)).toBe(true);
    expect(isBlockedCommand('sudo apt install', blocklist)).toBe(true);
  });

  it('should block case-insensitive matches', () => {
    expect(isBlockedCommand('SUDO apt install', blocklist)).toBe(true);
    expect(isBlockedCommand('RM -RF /', blocklist)).toBe(true);
  });

  it('should block commands containing blocked substrings', () => {
    expect(isBlockedCommand('echo hello && rm -rf /', blocklist)).toBe(true);
    expect(isBlockedCommand('bash -c "sudo reboot"', blocklist)).toBe(true);
  });

  it('should allow safe commands', () => {
    expect(isBlockedCommand('ls -la', blocklist)).toBe(false);
    expect(isBlockedCommand('cat file.txt', blocklist)).toBe(false);
    expect(isBlockedCommand('grep pattern file', blocklist)).toBe(false);
  });

  it('should handle empty blocklist', () => {
    expect(isBlockedCommand('rm -rf /', [])).toBe(false);
    expect(isBlockedCommand('sudo reboot', [])).toBe(false);
  });

  it('should handle whitespace in commands', () => {
    expect(isBlockedCommand('  rm -rf /  ', blocklist)).toBe(true);
    expect(isBlockedCommand('  ls -la  ', blocklist)).toBe(false);
  });

  it('should handle whitespace in blocklist entries', () => {
    const blocklistWithSpaces = ['  rm -rf  ', '  sudo  '];
    expect(isBlockedCommand('rm -rf /', blocklistWithSpaces)).toBe(true);
    expect(isBlockedCommand('sudo reboot', blocklistWithSpaces)).toBe(true);
  });
});
