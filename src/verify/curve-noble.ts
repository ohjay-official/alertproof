/**
 * The curve operations behind the offline check, on @noble/curves (audited,
 * no dependencies of its own besides @noble/hashes).
 *
 *   hash_to_curve  NUT-00: Y = '02' || SHA256(SHA256(DOMAIN || x) || counter_le32), first valid point
 *   hash_e         NUT-12: SHA256 over the concatenated uncompressed hex of R1, R2, A, C'
 *   DLEQ (Carol)   NUT-12: B' = Y + r*G, C' = C + r*A, R1 = s*G - e*A, R2 = s*B' - e*C',
 *                  then e == hash_e(R1, R2, A, C')
 *
 * Everything here works on public values only, so constant time doesn't
 * matter. Every failure returns false rather than throwing.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { CurveOps } from './types.ts';

export const Point = secp256k1.Point;
export type CurvePoint = InstanceType<typeof Point>;
export const G: CurvePoint = Point.BASE;
/** secp256k1 group order */
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const DOMAIN = new TextEncoder().encode('Secp256k1_HashToCurve_Cashu_');
const HEX64 = /^[0-9a-f]{64}$/;

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error('bad hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A 32-byte hex scalar in [1, n-1], or null. */
export function scalarFromHex(hex: string): bigint | null {
  if (typeof hex !== 'string' || !HEX64.test(hex)) return null;
  const v = BigInt('0x' + hex);
  return v > 0n && v < N ? v : null;
}

export function scalarToHex(v: bigint): string {
  return v.toString(16).padStart(64, '0');
}

/** NUT-00 hash_to_curve over raw bytes. */
export function hashToCurveBytes(message: Uint8Array): CurvePoint {
  const msgHash = sha256(concat(DOMAIN, message));
  const counter = new Uint8Array(4);
  const view = new DataView(counter.buffer);
  for (let c = 0; c < 2 ** 16; c++) {
    view.setUint32(0, c, true);
    const x = bytesToHex(sha256(concat(msgHash, counter)));
    try {
      const Y = Point.fromHex('02' + x);
      Y.assertValidity();
      return Y;
    } catch {
      // not on the curve, try the next counter
    }
  }
  throw new Error('no curve point found');
}

/** NUT-12 hash_e. */
export function hashE(points: CurvePoint[]): string {
  const joined = points.map((p) => p.toHex(false)).join('');
  return bytesToHex(sha256(new TextEncoder().encode(joined)));
}

/** NUT-12 check of a mint's blind signature: does C' = a*B' for the a behind A? */
export function verifyBlindDleq(B_: CurvePoint, C_: CurvePoint, eHex: string, sHex: string, A: CurvePoint): boolean {
  try {
    const e = scalarFromHex(eHex);
    const s = scalarFromHex(sHex);
    if (e === null || s === null) return false;
    const R1 = G.multiply(s).subtract(A.multiply(e));
    const R2 = B_.multiply(s).subtract(C_.multiply(e));
    return hashE([R1, R2, A, C_]) === eHex;
  } catch {
    return false;
  }
}

export const nobleCurve: CurveOps = {
  hashToCurve(secret: string): string {
    return hashToCurveBytes(new TextEncoder().encode(secret)).toHex(true);
  },
  verifyProofDleq({ Y, C, e, s, r, A }): boolean {
    try {
      const rs = scalarFromHex(r);
      if (rs === null) return false;
      const Yp = Point.fromHex(Y);
      const Cp = Point.fromHex(C);
      const Ap = Point.fromHex(A);
      Yp.assertValidity();
      Cp.assertValidity();
      Ap.assertValidity();
      const B_ = Yp.add(G.multiply(rs));
      const C_ = Cp.add(Ap.multiply(rs));
      return verifyBlindDleq(B_, C_, e, s, Ap);
    } catch {
      return false;
    }
  },
};
