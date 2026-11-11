/**
 * Turns the text scanned from a receipt QR into the plain object the offline
 * check reads. Uses cashu-ts to decode cashuB (NUT-00 V4), then copies only
 * the fields the check needs, with amounts as bigint (cashu-ts v4 hands back
 * Amount objects).
 *
 * Works offline: decoding needs the full keyset ids (from the trader's cache)
 * to expand the short ids that cashuB carries.
 */
import { getDecodedToken } from '@cashu/cashu-ts';

export const MAX_RECEIPT_CHARS = 20_000;
const CASHU_B = /^cashuB[A-Za-z0-9_-]+={0,2}$/;

export type DecodedReceipt =
  | { ok: true; token: { mint: unknown; unit: unknown; proofs: unknown[] } }
  | { ok: false; detail: string };

function toAmount(value: unknown): unknown {
  if (typeof value === 'number' || typeof value === 'bigint') return value;
  if (typeof value === 'object' && value !== null) {
    try {
      return BigInt(String(value));
    } catch {
      return undefined;
    }
  }
  return value;
}

export function decodeReceipt(text: unknown, keysetIds: readonly string[]): DecodedReceipt {
  if (typeof text !== 'string') return { ok: false, detail: 'not text' };
  let s = text.trim();
  if (s.toLowerCase().startsWith('cashu:')) s = s.slice('cashu:'.length);
  if (s.length > MAX_RECEIPT_CHARS) return { ok: false, detail: 'too long' };
  if (!CASHU_B.test(s)) return { ok: false, detail: 'not a cashuB token' };

  let decoded: any;
  try {
    decoded = getDecodedToken(s, keysetIds);
  } catch (err) {
    return { ok: false, detail: `could not decode: ${err instanceof Error ? err.message : String(err)}` };
  }
  const proofs = Array.isArray(decoded?.proofs) ? decoded.proofs : [];
  return {
    ok: true,
    token: {
      mint: decoded?.mint,
      unit: decoded?.unit,
      proofs: proofs.map((p: any) => ({
        id: p?.id,
        amount: toAmount(p?.amount),
        secret: p?.secret,
        C: p?.C,
        dleq: p?.dleq ? { e: p.dleq.e, s: p.dleq.s, r: p.dleq.r } : undefined,
      })),
    },
  };
}
