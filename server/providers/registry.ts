// Provider registry. Adding cursor / codex / agy = one entry here plus a
// runtime/sessions/sync triple in providers/<id>/.

import { claudeRuntime } from './claude/runtime.js';
import type { IProviderRuntime, ProviderId } from './types.js';

const runtimes: Partial<Record<ProviderId, IProviderRuntime>> = {
  claude: claudeRuntime,
};

export function getRuntime(provider: ProviderId): IProviderRuntime | null {
  return runtimes[provider] ?? null;
}

export function hasRuntime(provider: ProviderId): boolean {
  return provider in runtimes;
}

export function isProviderId(value: string): value is ProviderId {
  return ['claude', 'cursor', 'codex', 'agy'].includes(value);
}
