import type { ProviderType } from './types.js';
import { PROVIDER_META } from './constants.js';

/**
 * Normalize an email or account identifier so Chrome extension reports
 * and local CLI logs merge reliably under the same account card.
 */
export function normalizeIdentityKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return 'unknown-account';
  return trimmed;
}

/**
 * Mask an email address for clean default display names (e.g. abc***@gmail.com).
 */
export function maskEmail(raw: string): string {
  const trimmed = raw.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) {
    return trimmed.length > 24 ? `${trimmed.slice(0, 21)}...` : trimmed;
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (local.length <= 2) {
    return `${local[0] ?? '*'}***@${domain}`;
  }
  const visible = local.length >= 4 ? local.slice(0, 3) : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export function buildDefaultDisplayName(
  provider: ProviderType,
  identityKey: string,
  profileHint?: string | null,
): string {
  if (identityKey.includes('@')) {
    return maskEmail(identityKey);
  }
  if (profileHint && profileHint.trim()) {
    return `${PROVIDER_META[provider].name} (${profileHint.trim()})`;
  }
  if (identityKey === 'antigravity-local') {
    return 'Antigravity CLI (本機)';
  }
  if (identityKey === 'gemini-cli-local') {
    return 'Gemini CLI (本機)';
  }
  return `${PROVIDER_META[provider].name} 帳號`;
}
