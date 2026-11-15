/**
 * Wallet-side ecash math on @noble/curves: blinding outputs, unblinding the
 * mint's signatures after checking its DLEQ, the compact lock the pay page
 * uses, and the trader's P2PK signatures.
 *
 * Moved out of the Go/No-Go (Nov 15) so the app runs the same code that the
 * real-mint test runs.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  G,
  N,
  Point,
  bytesToHex,
  hashToCurveBytes,
  hexToBytes,
  scalarFromHex,
  scalarToHex,
  verifyBlindDleq,
} from '../verify/curve-noble.ts';
import { isPubkeyHex } from '../verify/lock.ts';
import type { CachedKeyset, Proof } from '../verify/types.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export const randomHex = (n: number): string => bytesToHex(randomBytes(n));

export function randomScalar(): bigint {
  for (;;) {
    const v = BigInt('0x' + randomHex(32));
    if (v > 0n && v < N) return v;
  }
}

/** Powers of two, smallest first, as wallets split amounts. */
export function splitAmount(total: number): number[] {
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError('amount must be a whole number of sats');
  const out: number[] = [];
  for (let bit = 1; bit <= total; bit *= 2) if (total & bit) out.push(bit);
  return out;
}

/** Number of bits needed to write `n`: the most proofs any amount up to `n` splits into. */
export function bitLength(n: number): number {
  let bits = 0;
  while (n > 0) {
    bits++;
    n = Math.floor(n / 2);
  }
  return bits;
}

/** NUT-02 fee for spending these proofs: the sum of their keysets' ppk, rounded up to whole sats. */
export function inputFee(proofs: readonly { id: string }[], keysets: readonly CachedKeyset[]): number {
  let ppk = 0;
  for (const p of proofs) {
    const ks = keysets.find((k) => k.id === p.id);
    if (!ks) throw new Error(`no cached keyset ${p.id}`);
    ppk += ks.input_fee_ppk ?? 0;
  }
  return Math.ceil(ppk / 1000);
}

/** The smallest amount to mint so that `price` still lands after the mint's fee for spending it. */
export function amountWithFee(price: number, ppk: number): number {
  if (!Number.isSafeInteger(price) || price <= 0) throw new RangeError('price must be a positive whole number of sats');
  for (let x = price; ; x++) {
    const fee = Math.ceil((splitAmount(x).length * ppk) / 1000);
    if (x - fee >= price) return x;
  }
}

/**
 * The compact lock the pay page uses: a 16-byte nonce and no tags (no
 * sigflag means SIG_INPUTS), which keeps receipts, and so the QR, small.
 * Accepted by src/verify/lock.ts.
 */
export function compactLock(pubkey: string): string {
  if (!isPubkeyHex(pubkey)) throw new Error('lock key must be a compressed lowercase public key');
  return JSON.stringify(['P2PK', { nonce: randomHex(16), data: pubkey }]);
}

/** A blinded output plus what's needed to unblind it later. Plain JSON, so it can be saved. */
export interface BlindedOutput {
  amount: number;
  id: string;
  B_: string;
  secret: string;
  /** blinding factor, 32-byte hex */
  r: string;
}

/** What the mint returns for one output (NUT-00 BlindSignature, NUT-12 dleq). */
export interface BlindSignature {
  id: string;
  amount: number;
  C_: string;
  dleq?: { e: string; s: string };
}

export function blindOutput(amount: number, keysetId: string, secret: string): BlindedOutput {
  const r = randomScalar();
  const B_ = hashToCurveBytes(utf8(secret)).add(G.multiply(r));
  return { amount, id: keysetId, B_: B_.toHex(true), secret, r: scalarToHex(r) };
}

/** What goes over the wire for each output. */
export const wireOutputs = (outs: readonly BlindedOutput[]) => outs.map(({ amount, id, B_ }) => ({ amount, id, B_ }));

/**
 * Turns the mint's signature into a proof, after checking the mint's DLEQ
 * (NUT-12: wallets must). Throws if the signature doesn't match the output or
 * the DLEQ fails, so a bad mint answer never becomes a receipt.
 */
export function unblind(sig: BlindSignature, out: BlindedOutput, keyset: CachedKeyset): Proof {
  if (sig.id !== out.id) throw new Error(`mint signed with keyset ${sig.id}, asked for ${out.id}`);
  const A = keyset.keys[String(sig.amount)];
  if (!isPubkeyHex(A)) throw new Error(`no key for amount ${sig.amount}`);
  if (!sig.dleq) throw new Error('mint returned no DLEQ proof');
  const r = scalarFromHex(out.r);
  if (r === null) throw new Error('saved blinding factor is not valid');
  const Ap = Point.fromHex(A);
  const C_ = Point.fromHex(sig.C_);
  if (!verifyBlindDleq(Point.fromHex(out.B_), C_, sig.dleq.e, sig.dleq.s, Ap)) {
    throw new Error("the mint's DLEQ proof did not verify");
  }
  const C = C_.subtract(Ap.multiply(r));
  return {
    id: out.id,
    amount: sig.amount,
    secret: out.secret,
    C: C.toHex(true),
    dleq: { e: sig.dleq.e, s: sig.dleq.s, r: out.r },
  };
}

/** Unblind a batch, output by output, checking the mint answered every one with the amount asked. */
export function unblindAll(sigs: readonly BlindSignature[], outs: readonly BlindedOutput[], keyset: CachedKeyset): Proof[] {
  if (sigs.length !== outs.length) throw new Error(`mint returned ${sigs.length} signatures for ${outs.length} outputs`);
  return sigs.map((sig, n) => {
    if (sig.amount !== outs[n]!.amount) throw new Error(`output ${n}: mint signed ${sig.amount}, asked for ${outs[n]!.amount}`);
    return unblind(sig, outs[n]!, keyset);
  });
}

/** The trader's key pair. `priv` never leaves the phone and is only held while collecting. */
export interface KeyPair {
  priv: Uint8Array;
  /** compressed public key, lowercase hex: the lock key customers pay to */
  pub: string;
}

export function keyPairFromScalar(d: bigint): KeyPair {
  if (d <= 0n || d >= N) throw new RangeError('private key out of range');
  return { priv: hexToBytes(scalarToHex(d)), pub: G.multiply(d).toHex(true) };
}

/** NUT-11 witness for a P2PK proof with SIG_INPUTS: a Schnorr signature over SHA256(secret). */
export function p2pkWitness(secret: string, priv: Uint8Array): string {
  return JSON.stringify({ signatures: [bytesToHex(schnorr.sign(sha256(utf8(secret)), priv))] });
}

/** A proof as a swap or melt input, signed by the trader. */
export function signedInput(p: Proof, priv: Uint8Array) {
  return { id: p.id, amount: p.amount, secret: p.secret, C: p.C, witness: p2pkWitness(p.secret, priv) };
}

export const sumAmounts = (items: readonly { amount: number }[]): number => items.reduce((n, p) => n + p.amount, 0);
