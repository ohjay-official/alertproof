/**
 * The offline receipt check. No network, no dependencies: elliptic curve
 * operations come in through `CurveOps`.
 *
 * Order matters for what the trader is told. Signatures come before the lock
 * reasons and the amount, so "underpaid" or "could take it back" is only ever
 * said about a receipt the mint really signed. If a forged receipt could say
 * "short by 500 sats", the trader might ask for 500 more and release the
 * goods for a payment that was mostly fake.
 *
 *   1. receipt shape, unit, mint is one the trader chose, mint supports NUT-11 and NUT-12
 *   2. every proof: shape, DLEQ present, keyset cached and not expired, amount key, worth more than its fee
 *   3. every proof: Y = hash_to_curve(secret), no proof twice, DLEQ verifies
 *   4. every proof: locked to the trader with no way back (lock.ts)
 *   5. what lands after the mint's collect fee covers the requested amount
 *
 * Replay (the same receipt shown twice) is handled by `acceptReceipt`, which
 * records a genuine receipt, full or part payment, exactly once.
 */

import { checkLock, isPubkeyHex } from './lock.ts';
import { normalizeMintUrl } from './mint-url.ts';
import { MAX_SECRET_LENGTH } from './strict-json.ts';
import type {
  Accepted,
  CachedKeyset,
  CheckOptions,
  CurveOps,
  FailCode,
  Proof,
  Received,
  Refused,
  TraderContext,
  TrustedMint,
  Verdict,
} from './types.ts';
import type { SeenStore } from './seen.ts';

export const MAX_PROOFS = 64;

const HEX64 = /^[0-9a-f]{64}$/;
// NUT-02 keyset ids: version 00 (8 bytes) or version 01 (33 bytes)
const KEYSET_ID = /^(?:00[0-9a-f]{14}|01[0-9a-f]{64})$/;

const refuse = (code: FailCode, detail: string): Refused => ({ ok: false, code, detail });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function nutSupported(mint: TrustedMint, nut: string): boolean {
  const nuts = isRecord(mint.info) ? own(mint.info, 'nuts') : undefined;
  if (!isRecord(nuts)) return false;
  const entry = own(nuts, nut);
  return isRecord(entry) && own(entry, 'supported') === true;
}

/** Copy only the fields we check, so nothing unchecked travels on. */
function readProof(raw: unknown, n: number): Proof | Refused {
  if (!isRecord(raw)) return refuse('malformed', `proof ${n}: not an object`);
  const id = own(raw, 'id');
  let amount = own(raw, 'amount');
  // cashu-ts v4 decodes amounts as bigint; accept them while they fit exactly
  if (typeof amount === 'bigint') {
    amount = amount > 0n && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : -1;
  }
  const secret = own(raw, 'secret');
  const C = own(raw, 'C');
  const dleq = own(raw, 'dleq');

  if (typeof id !== 'string' || !KEYSET_ID.test(id)) {
    return refuse('malformed', `proof ${n}: keyset id is not lowercase hex of a known length`);
  }
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    return refuse('malformed', `proof ${n}: amount is not a positive whole number`);
  }
  if (typeof secret !== 'string' || secret.length === 0 || secret.length > MAX_SECRET_LENGTH) {
    return refuse('malformed', `proof ${n}: secret missing or too long`);
  }
  if (!isPubkeyHex(C)) {
    return refuse('malformed', `proof ${n}: C is not a compressed lowercase point`);
  }
  if (dleq === undefined || dleq === null) {
    return refuse('missing_dleq', `proof ${n}: no DLEQ proof`);
  }
  if (!isRecord(dleq)) return refuse('missing_dleq', `proof ${n}: DLEQ is not an object`);
  const e = own(dleq, 'e');
  const s = own(dleq, 's');
  const r = own(dleq, 'r');
  if (typeof e !== 'string' || typeof s !== 'string' || typeof r !== 'string') {
    return refuse('missing_dleq', `proof ${n}: DLEQ needs e, s and r`);
  }
  if (!HEX64.test(e) || !HEX64.test(s) || !HEX64.test(r)) {
    return refuse('malformed', `proof ${n}: DLEQ values are not 32-byte lowercase hex`);
  }
  return { id, amount, secret, C, dleq: { e, s, r } };
}

function isRefused(value: Proof | Refused): value is Refused {
  return (value as Refused).ok === false;
}

export function checkReceipt(
  token: unknown,
  ctx: TraderContext,
  opts: CheckOptions,
  curve: CurveOps,
): Verdict {
  const requested = opts.requestedSats;
  if (requested !== undefined && (!Number.isSafeInteger(requested) || requested <= 0)) {
    throw new RangeError('requestedSats must be a positive whole number of sats');
  }

  // 1. receipt and mint
  if (!isRecord(token)) return refuse('malformed', 'receipt is not an object');
  const mintUrl = normalizeMintUrl(own(token, 'mint'));
  if (mintUrl === null) return refuse('untrusted_mint', 'mint URL is missing, not https, or not valid');
  if (own(token, 'unit') !== 'sat') return refuse('wrong_unit', 'unit is not sat');

  const mint = ctx.mints.find((m) => normalizeMintUrl(m.url) === mintUrl);
  if (!mint) return refuse('untrusted_mint', "mint is not on the trader's list");
  if (!nutSupported(mint, '11')) return refuse('mint_not_ready', 'cached mint info does not list NUT-11');
  if (!nutSupported(mint, '12')) return refuse('mint_not_ready', 'cached mint info does not list NUT-12');

  const rawProofs = own(token, 'proofs');
  if (!Array.isArray(rawProofs) || rawProofs.length === 0) {
    return refuse('malformed', 'receipt has no proofs');
  }
  if (rawProofs.length > MAX_PROOFS) return refuse('malformed', `more than ${MAX_PROOFS} proofs`);

  const keysets = new Map<string, CachedKeyset>();
  for (const ks of mint.keysets) keysets.set(ks.id, ks);
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);

  // 2. shape, keys
  const proofs: Proof[] = [];
  const amountKeys: string[] = [];
  let feePpk = 0;
  for (let n = 0; n < rawProofs.length; n++) {
    const p = readProof(rawProofs[n], n);
    if (isRefused(p)) return p;
    const ks = keysets.get(p.id);
    if (!ks) return refuse('unknown_keys', `proof ${n}: keyset ${p.id} is not in the cache`);
    if (ks.unit !== 'sat') return refuse('wrong_unit', `proof ${n}: keyset unit is ${String(ks.unit)}`);
    if (ks.final_expiry !== undefined && !(Number.isSafeInteger(ks.final_expiry) && now < ks.final_expiry)) {
      return refuse('unknown_keys', `proof ${n}: keyset ${p.id} has expired, the mint would refuse it`);
    }
    const A = isRecord(ks.keys) ? own(ks.keys, String(p.amount)) : undefined;
    if (!isPubkeyHex(A)) return refuse('unknown_keys', `proof ${n}: no cached key for amount ${p.amount}`);
    const ppk = ks.input_fee_ppk ?? 0;
    if (!Number.isSafeInteger(ppk) || ppk < 0) {
      return refuse('unknown_keys', `proof ${n}: cached input fee is not valid`);
    }
    // A proof worth no more than its own collect fee adds nothing for the trader.
    if (p.amount * 1000 <= ppk) return refuse('malformed', `proof ${n}: worth less than its collect fee`);
    feePpk += ppk;
    proofs.push(p);
    amountKeys.push(A);
  }

  // 3. signatures. Before the lock reasons, so a forged receipt is only ever
  //    "not signed by your mint", never a story a scammer can explain away.
  const ys: string[] = [];
  const seen = new Set<string>();
  for (let n = 0; n < proofs.length; n++) {
    let Y: string;
    try {
      Y = curve.hashToCurve(proofs[n]!.secret);
    } catch {
      return refuse('malformed', `proof ${n}: secret does not map to a curve point`);
    }
    if (!isPubkeyHex(Y)) return refuse('malformed', `proof ${n}: hash_to_curve gave an invalid point`);
    if (seen.has(Y)) return refuse('malformed', `proof ${n}: the same proof appears twice`);
    seen.add(Y);
    ys.push(Y);
  }
  for (let n = 0; n < proofs.length; n++) {
    const p = proofs[n]!;
    let valid = false;
    try {
      valid =
        curve.verifyProofDleq({
          Y: ys[n]!,
          C: p.C,
          e: p.dleq!.e,
          s: p.dleq!.s,
          r: p.dleq!.r,
          A: amountKeys[n]!,
        }) === true;
    } catch {
      valid = false;
    }
    if (!valid) return refuse('bad_signature', `proof ${n}: DLEQ does not verify against the mint key`);
  }

  // 4. lock
  for (let n = 0; n < proofs.length; n++) {
    const lock = checkLock(proofs[n]!.secret, ctx.traderPubkey);
    if (!lock.ok) return refuse(lock.code, `proof ${n}: ${lock.detail}`);
  }

  // 5. amount, after the mint's collect fee
  let total = 0;
  for (const p of proofs) {
    total += p.amount;
    if (!Number.isSafeInteger(total)) return refuse('malformed', 'total is too large');
  }
  const feeSats = Math.ceil(feePpk / 1000);
  const received: Received = { mint: mintUrl, totalSats: total, feeSats, ys, proofs };
  const lands = total - feeSats;
  if (requested !== undefined && lands < requested) {
    return {
      ok: false,
      code: 'underpaid',
      detail: `${lands} of ${requested} sats land after a ${feeSats} sat fee`,
      received,
    };
  }

  const accepted: Accepted = {
    ok: true,
    ...received,
    overpaidSats: requested === undefined ? 0 : lands - requested,
  };
  return accepted;
}

/**
 * Check, then record. A genuine receipt is the trader's money whether or not
 * it covers the price, so a part payment is recorded too (and marked
 * `kept`). Either way the store records the replay keys and the proofs to
 * collect together, or nothing at all, and a receipt that was already
 * received is "already received", never "short by".
 */
export async function acceptReceipt(
  token: unknown,
  ctx: TraderContext,
  opts: CheckOptions,
  curve: CurveOps,
  store: SeenStore,
): Promise<Verdict> {
  const verdict = checkReceipt(token, ctx, opts, curve);
  const payment = verdict.ok ? verdict : verdict.code === 'underpaid' ? verdict.received : undefined;
  if (!payment) return verdict;
  const fresh = await store.claim(payment.ys, payment);
  if (!fresh) return refuse('already_received', 'one or more proofs were already received on this phone');
  return verdict.ok ? verdict : { ...verdict, kept: true };
}
