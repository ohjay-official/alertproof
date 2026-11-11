/**
 * What the trader's phone downloads while online once, so it can check
 * receipts with no data: the mint's NUT-06 info and its active sat keysets
 * with their per-amount public keys (NUT-01, NUT-02).
 */
import { normalizeMintUrl } from '../verify/mint-url.ts';
import { isPubkeyHex } from '../verify/lock.ts';
import type { CachedKeyset, TrustedMint } from '../verify/types.ts';

const KEYSET_ID = /^(?:00[0-9a-f]{14}|01[0-9a-f]{64})$/;
const AMOUNT_KEY = /^[1-9][0-9]{0,15}$/;

async function getJson(fetchFn: typeof fetch, url: string): Promise<any> {
  const res = await fetchFn(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Downloads and checks everything the offline check needs from one mint. */
export async function fetchTrustedMint(rawUrl: string, fetchFn: typeof fetch = fetch): Promise<TrustedMint> {
  const url = normalizeMintUrl(rawUrl);
  if (!url) throw new Error('mint URL must be https');

  const info = await getJson(fetchFn, `${url}/v1/info`);
  const nuts = info && typeof info.nuts === 'object' && info.nuts !== null ? info.nuts : {};

  const list = await getJson(fetchFn, `${url}/v1/keysets`);
  const active = (Array.isArray(list?.keysets) ? list.keysets : []).filter(
    (k: any) => k && k.unit === 'sat' && k.active === true && typeof k.id === 'string' && KEYSET_ID.test(k.id),
  );
  if (active.length === 0) throw new Error('the mint has no active sat keyset');

  const keysets: CachedKeyset[] = [];
  for (const k of active) {
    const body = await getJson(fetchFn, `${url}/v1/keys/${k.id}`);
    const entry = (Array.isArray(body?.keysets) ? body.keysets : []).find((x: any) => x?.id === k.id);
    if (!entry || typeof entry.keys !== 'object' || entry.keys === null) throw new Error(`no keys for keyset ${k.id}`);
    const keys: Record<string, string> = {};
    for (const [amount, pub] of Object.entries(entry.keys as Record<string, unknown>)) {
      if (AMOUNT_KEY.test(amount) && isPubkeyHex(pub)) keys[amount] = pub;
    }
    if (Object.keys(keys).length === 0) throw new Error(`keyset ${k.id} has no usable keys`);
    const fee = k.input_fee_ppk ?? 0;
    if (!Number.isSafeInteger(fee) || fee < 0) throw new Error(`keyset ${k.id} reports an invalid input fee`);
    keysets.push({ id: k.id, unit: 'sat', keys, input_fee_ppk: fee });
  }
  return { url, info: { nuts }, keysets };
}
