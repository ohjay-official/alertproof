/**
 * A stand-in mint for testing the rule layer without curve math.
 *
 * The fake "signature" binds the same things the real DLEQ binds: the mint
 * key for the proof's amount (A), the point for the secret (Y) and the
 * signature (C). So an edited amount, an edited secret, a different mint key
 * or a copied signature all fail here as they do with real DLEQ proofs.
 * Real curve math is tested separately against the NUT-00 and NUT-12 vectors.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { CachedKeyset, CurveOps, Proof, TrustedMint } from '../types.ts';

export const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
export const hex32 = (): string => randomBytes(32).toString('hex');
/** Not a real curve point, but has the right shape for the rule layer. */
export const fakeKey = (label: string): string => '02' + sha('key:' + label);

export const fakeCurve: CurveOps = {
  hashToCurve: (secret) => '02' + sha('h2c:' + secret),
  verifyProofDleq: ({ Y, C, e, s, r, A }) => e === sha(['dleq', A, Y, C, s, r].join('|')),
};

export const AMOUNTS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

export function makeKeyset(label: string, opts: { unit?: string; fee?: number; id?: string } = {}): CachedKeyset {
  const keys: Record<string, string> = {};
  for (const a of AMOUNTS) keys[String(a)] = fakeKey(`${label}:${a}`);
  const ks: CachedKeyset = {
    id: opts.id ?? '00' + sha('id:' + label).slice(0, 14),
    unit: opts.unit ?? 'sat',
    keys,
  };
  if (opts.fee !== undefined) ks.input_fee_ppk = opts.fee;
  return ks;
}

export const TRADER = fakeKey('trader');
export const OTHER_TRADER = fakeKey('someone else');
export const MINT_URL = 'https://nofees.testnut.cashu.space';

export function makeTrustedMint(url = MINT_URL, keysets = [makeKeyset('mint-a')]): TrustedMint {
  return {
    url,
    info: { nuts: { '10': { supported: true }, '11': { supported: true }, '12': { supported: true } } },
    keysets,
  };
}

export function lockSecret(pubkey: string, tags: string[][] | null = [['sigflag', 'SIG_INPUTS']]): string {
  const body: Record<string, unknown> = { nonce: hex32(), data: pubkey };
  if (tags !== null) body.tags = tags;
  return JSON.stringify(['P2PK', body]);
}

/** Sign one proof the way a mint would, with the fake curve. */
export function signProof(ks: CachedKeyset, amount: number, secret: string): Proof {
  const A = ks.keys[String(amount)];
  if (!A) throw new Error(`no key for ${amount}`);
  const Y = fakeCurve.hashToCurve(secret);
  const C = '02' + sha(['sig', A, Y].join('|'));
  const s = hex32();
  const r = hex32();
  const e = sha(['dleq', A, Y, C, s, r].join('|'));
  return { id: ks.id, amount, secret, C, dleq: { e, s, r } };
}

/** Split into powers of two, as wallets do. */
export function split(total: number): number[] {
  const out: number[] = [];
  for (let bit = 1; bit <= total; bit *= 2) if (total & bit) out.push(bit);
  return out;
}

export function makeToken(
  total: number,
  opts: { ks?: CachedKeyset; lockTo?: string; mint?: string; unit?: string; secret?: (n: number) => string } = {},
) {
  const ks = opts.ks ?? makeKeyset('mint-a');
  const proofs = split(total).map((a, n) =>
    signProof(ks, a, opts.secret ? opts.secret(n) : lockSecret(opts.lockTo ?? TRADER)),
  );
  return { mint: opts.mint ?? MINT_URL, unit: opts.unit ?? 'sat', proofs };
}
