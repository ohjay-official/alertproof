/**
 * The trader's key and its recovery code.
 *
 * Setup makes 16 random bytes (the seed). The lock key customers pay to is
 * derived from it, and the seed is shown once as a recovery code to write
 * down: 28 characters in groups of four, using letters and digits that
 * can't be mistaken for each other (Crockford base32: no I, L, O or U), with
 * a 2-character check at the end that catches a mistyped character.
 *
 *   ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345
 *
 * 128 bits, the same strength as a 12-word phrase.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { N, bytesToHex, concat } from '../verify/curve-noble.ts';
import { keyPairFromScalar, randomBytes, type KeyPair } from './ecash.ts';

export const SEED_BYTES = 16;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DOMAIN = new TextEncoder().encode('AlertProof trader key v1');

export function newSeed(): Uint8Array {
  return randomBytes(SEED_BYTES);
}

/** The trader's lock key pair from the seed. Same seed, same key, on any phone. */
export function traderKey(seed: Uint8Array): KeyPair {
  if (seed.length !== SEED_BYTES) throw new Error('seed must be 16 bytes');
  const h = BigInt('0x' + bytesToHex(sha256(concat(DOMAIN, seed))));
  return keyPairFromScalar((h % (N - 1n)) + 1n);
}

function toBase32(bytes: Uint8Array, chars: number): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.slice(0, chars);
}

function checkChars(seed: Uint8Array): string {
  return toBase32(sha256(seed).slice(0, 2), 2);
}

/** The seed as the code the trader writes down. */
export function recoveryCode(seed: Uint8Array): string {
  if (seed.length !== SEED_BYTES) throw new Error('seed must be 16 bytes');
  const all = toBase32(seed, 26) + checkChars(seed);
  return all.match(/.{4}/g)!.join('-');
}

/**
 * The seed from a typed code, or null if it isn't one. Forgiving about how
 * it's typed: case, spaces, dashes, and O/I/L for 0/1/1.
 */
export function parseRecoveryCode(text: string): Uint8Array | null {
  if (typeof text !== 'string') return null;
  const clean = text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (clean.length !== 28) return null;
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean.slice(0, 26)) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  // 26 characters carry 130 bits: 128 for the seed, then 2 that must be zero
  if (bytes.length !== SEED_BYTES || value !== 0) return null;
  const seed = Uint8Array.from(bytes);
  return checkChars(seed) === clean.slice(26) ? seed : null;
}
