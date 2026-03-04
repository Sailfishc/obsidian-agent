import type { ObsidianAgentSettings } from '../core/types';

/**
 * Parse environment variable text (KEY=VALUE format, one per line).
 * Supports optional `export ` prefix. Ignores blank lines and `# comment` lines.
 */
export function parseEnvText(envText: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!envText) return result;

  for (const rawLine of envText.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Strip optional `export ` prefix
    const stripped = line.startsWith('export ') ? line.slice(7).trimStart() : line;

    const eqIdx = stripped.indexOf('=');
    if (eqIdx <= 0) continue;

    const key = stripped.slice(0, eqIdx).trim();
    let value = stripped.slice(eqIdx + 1).trim();

    // Strip surrounding quotes if present (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Create a unique key for a provider + modelId combination.
 * Uses `provider/modelId` format as a simple human-readable key.
 */
export function makeModelKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

/**
 * Get the context window limit (in tokens) for a given model.
 * Falls back to 200,000 if no custom limit is set.
 */
export function getContextLimitTokens(
  settings: ObsidianAgentSettings,
  provider: string,
  modelId: string,
): number {
  const key = makeModelKey(provider, modelId);
  return settings.environment.modelContextLimits[key] ?? 200_000;
}

/**
 * Collect all "configured models" from settings.
 * A model is considered configured if the user has set it up with a provider + model ID.
 */
export function getConfiguredModels(settings: ObsidianAgentSettings): Array<{ provider: string; modelId: string; label: string }> {
  const models: Array<{ provider: string; modelId: string; label: string }> = [];
  const seen = new Set<string>();

  const add = (provider: string, modelId: string) => {
    if (!provider || !modelId) return;
    const key = makeModelKey(provider, modelId);
    if (seen.has(key)) return;
    seen.add(key);
    models.push({ provider, modelId, label: `${provider} / ${modelId}` });
  };

  // Global model
  if (settings.general.provider === 'custom-openai') {
    // For custom-openai, the real model ID is in customOpenAI.modelId
    if (settings.customOpenAI.modelId) {
      add('custom-openai', settings.customOpenAI.modelId);
    }
  } else {
    add(settings.general.provider, settings.general.modelId);
  }

  // Also include custom-openai if configured but not currently active
  if (settings.general.provider !== 'custom-openai' && settings.customOpenAI.baseUrl && settings.customOpenAI.modelId) {
    add('custom-openai', settings.customOpenAI.modelId);
  }

  // Inline edit override model
  if (
    settings.inlineEdit.enabled &&
    !settings.inlineEdit.useGlobalModel &&
    settings.inlineEdit.modelOverride?.modelId
  ) {
    add(
      settings.inlineEdit.modelOverride.provider,
      settings.inlineEdit.modelOverride.modelId,
    );
  }

  return models;
}
