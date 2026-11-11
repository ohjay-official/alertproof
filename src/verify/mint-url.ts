/**
 * Mint URLs are compared after normalizing: https only, lowercase host, no
 * credentials, query or fragment, no trailing slash. Anything else is null,
 * and a null mint is never trusted.
 */
export function normalizeMintUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (raw.includes('?') || raw.includes('#')) return null;
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}
