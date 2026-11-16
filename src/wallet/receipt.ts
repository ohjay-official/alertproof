/**
 * Turns the text scanned from a receipt QR into the plain object the offline
 * check reads, and back. Uses Sealpay's own cashuB reader and writer
 * (cashub.ts), so the trader's phone doesn't download the full Cashu library.
 *
 * Works offline: decoding needs the full keyset ids (from the trader's cache)
 * to expand the short ids that cashuB carries.
 */
import { decodeCashuB, encodeCashuB } from './cashub.ts';
import type { Proof } from '../verify/types.ts';

export const MAX_RECEIPT_CHARS = 20_000;
const CASHU_B = /^cashuB[A-Za-z0-9_-]+={0,2}$/;

export type DecodedReceipt =
  | { ok: true; token: { mint: unknown; unit: unknown; proofs: unknown[] } }
  | { ok: false; detail: string };

export function decodeReceipt(text: unknown, keysetIds: readonly string[]): DecodedReceipt {
  if (typeof text !== 'string') return { ok: false, detail: 'not text' };
  let s = text.trim();
  if (s.toLowerCase().startsWith('cashu:')) s = s.slice('cashu:'.length);
  if (s.length > MAX_RECEIPT_CHARS) return { ok: false, detail: 'too long' };
  if (!CASHU_B.test(s)) return { ok: false, detail: 'not a cashuB token' };
  try {
    const t = decodeCashuB(s, keysetIds);
    return { ok: true, token: { mint: t.mint, unit: t.unit, proofs: t.proofs } };
  } catch (err) {
    return { ok: false, detail: `could not decode: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** The receipt as text for the QR: cashuB with every DLEQ proof kept, so the trader can check it offline. */
export function encodeReceipt(token: { mint: string; unit?: string; proofs: Proof[] }): string {
  return encodeCashuB({ mint: token.mint, unit: token.unit ?? 'sat', proofs: token.proofs });
}
