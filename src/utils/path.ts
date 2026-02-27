import type { App } from 'obsidian';

export function getVaultPath(app: App): string | null {
  const adapter = app.vault.adapter as any;
  if (adapter && typeof adapter.basePath === 'string') {
    return adapter.basePath;
  }
  return null;
}
