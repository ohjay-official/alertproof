/**
 * Is this proof locked so that only the trader can spend it, with no way back
 * for the payer? (NUT-10 well-known secret, NUT-11 P2PK.)
 *
 * The only lock accepted:
 *
 *   ["P2PK", {"nonce": "<non-empty>", "data": "<trader's key>", "tags": [["sigflag", "SIG_INPUTS"]]}]
 *
 * where "tags" may also be empty or left out. Everything else is refused:
 *
 *   - locktime, refund, n_sigs_refund: after the locktime the payer (or, with
 *     no refund key, anyone) can spend it. Refused even with a far future
 *     locktime, and even with an invalid locktime value.
 *   - pubkeys, n_sigs: other keys could sign, or the proof could need
 *     signatures the trader can't give. Some mints also reject n_sigs without
 *     pubkeys, which would leave the money stuck.
 *   - sigflag other than SIG_INPUTS, a repeated sigflag, any unknown tag:
 *     NUT-11 says duplicate tags make the proof unspendable, and unknown tags
 *     have no defined meaning, so the trader might not be able to collect.
 *
 * The key must match the trader's key exactly (lowercase, compressed).
 */

import { parseStrictJson, StrictJsonError, type StrictValue } from './strict-json.ts';
import type { FailCode } from './types.ts';

export type LockResult = { ok: true } | { ok: false; code: FailCode; detail: string };

const PUBKEY_RE = /^0[23][0-9a-f]{64}$/;
const MAX_TAGS = 8;
const PAYER_WAY_BACK = new Set(['locktime', 'refund', 'n_sigs_refund']);
const SHARED = new Set(['pubkeys', 'n_sigs']);
const ALLOWED_FIELDS = new Set(['nonce', 'data', 'tags']);

export function isPubkeyHex(value: unknown): value is string {
  return typeof value === 'string' && PUBKEY_RE.test(value);
}

const refuse = (code: FailCode, detail: string): LockResult => ({ ok: false, code, detail });

export function checkLock(secret: string, traderPubkey: string): LockResult {
  if (!isPubkeyHex(traderPubkey)) {
    // Our own setup is broken. Refuse rather than guess.
    return refuse('not_locked_to_you', 'trader key in the cache is not a compressed lowercase public key');
  }
  if (typeof secret !== 'string') return refuse('malformed', 'secret is not a string');

  // A plain secret (the usual 64 hex characters) has no lock at all.
  if (!secret.trimStart().startsWith('[')) {
    return refuse('not_locked_to_you', 'plain secret: anyone holding it can spend it');
  }

  let parsed: StrictValue;
  try {
    parsed = parseStrictJson(secret);
  } catch (err) {
    const why = err instanceof StrictJsonError ? err.message : 'unreadable';
    return refuse('not_locked_to_you', `lock not readable the same way by every mint: ${why}`);
  }

  if (!Array.isArray(parsed) || parsed.length !== 2) {
    return refuse('not_locked_to_you', 'not a NUT-10 secret: expected [kind, {...}]');
  }
  const [kind, body] = parsed;
  if (kind !== 'P2PK') {
    return refuse('not_locked_to_you', 'not a P2PK lock');
  }
  if (!(body instanceof Map)) {
    return refuse('not_locked_to_you', 'not a NUT-10 secret: second element is not an object');
  }
  for (const field of body.keys()) {
    if (!ALLOWED_FIELDS.has(field)) {
      return refuse('not_locked_to_you', `unexpected field "${field}" in the lock`);
    }
  }

  const nonce = body.get('nonce');
  if (typeof nonce !== 'string' || nonce.length === 0) {
    return refuse('not_locked_to_you', 'lock has no nonce');
  }

  const data = body.get('data');
  if (typeof data !== 'string') {
    return refuse('not_locked_to_you', 'lock has no key');
  }
  if (data !== traderPubkey) {
    return refuse('not_locked_to_you', 'locked to a different key');
  }

  if (!body.has('tags')) return { ok: true };

  const tags = body.get('tags');
  if (!Array.isArray(tags)) return refuse('unsupported_lock', 'tags is not a list');
  if (tags.length > MAX_TAGS) return refuse('unsupported_lock', 'too many tags');

  let sawSigflag = false;
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag.length < 2) {
      return refuse('unsupported_lock', 'a tag is not a [key, value, ...] list');
    }
    for (const part of tag) {
      if (typeof part !== 'string' || part.length === 0) {
        return refuse('unsupported_lock', 'a tag holds something other than non-empty strings');
      }
    }
    const key = tag[0] as string;
    if (PAYER_WAY_BACK.has(key)) {
      return refuse('can_be_taken_back', `lock has a "${key}" tag`);
    }
    if (SHARED.has(key)) {
      return refuse('shared_lock', `lock has a "${key}" tag`);
    }
    if (key === 'sigflag') {
      if (sawSigflag) return refuse('unsupported_lock', 'sigflag appears twice');
      sawSigflag = true;
      if (tag.length !== 2 || tag[1] !== 'SIG_INPUTS') {
        return refuse('unsupported_lock', 'only sigflag SIG_INPUTS is accepted');
      }
      continue;
    }
    return refuse('unsupported_lock', `unknown tag "${key}"`);
  }

  return { ok: true };
}
