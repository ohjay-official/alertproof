/**
 * Types for the AlertProof offline receipt check.
 *
 * Everything the trader's phone needs is cached while it is online once
 * (mint info, keysets, the trader's public key). The check itself makes no
 * network request.
 */

/** Why a receipt was refused. Each code maps to one short line for the trader. */
export type FailCode =
  | 'malformed' // the receipt itself is broken: bad shape, bad hex, duplicate or too many proofs
  | 'wrong_unit' // not denominated in sats
  | 'untrusted_mint' // issued by a mint the trader didn't choose
  | 'mint_not_ready' // the cached mint info doesn't list NUT-11 (locks) and NUT-12 (offline proofs)
  | 'unknown_keys' // keyset or amount key not in the trader's cache
  | 'missing_dleq' // no offline proof of the mint's signature
  | 'not_locked_to_you' // no lock, an unreadable lock, or locked to another key
  | 'can_be_taken_back' // locktime, refund or n_sigs_refund: the payer keeps a way back
  | 'shared_lock' // pubkeys or n_sigs: someone else could also spend it
  | 'unsupported_lock' // a sigflag or tag we don't accept
  | 'bad_signature' // the mint's signature proof (DLEQ) fails
  | 'underpaid' // less than the amount asked for
  | 'already_received'; // this receipt (or part of it) was already accepted on this phone

/** A Cashu proof as decoded from a token (NUT-00, with the NUT-12 dleq field). */
export interface Proof {
  id: string;
  amount: number;
  secret: string;
  C: string;
  dleq?: { e: string; s: string; r: string };
}

/** A decoded token. Treated as untrusted: every field is checked. */
export interface DecodedToken {
  mint: string;
  unit?: string;
  proofs: Proof[];
}

/** One keyset as cached from the mint's /v1/keys and /v1/keysets (NUT-01, NUT-02). */
export interface CachedKeyset {
  id: string;
  unit: string;
  /** amount (as a decimal string) -> compressed public key hex */
  keys: Record<string, string>;
  /** NUT-02 input fee in parts per thousand of a sat, per proof. 0 if absent. */
  input_fee_ppk?: number;
}

/** A mint the trader chose, with everything needed to check offline. */
export interface TrustedMint {
  /** Mint URL. Normalized before comparison. */
  url: string;
  /** NUT-06 info as cached. Only `nuts` is read. */
  info: { nuts?: Record<string, unknown> };
  keysets: CachedKeyset[];
}

export interface TraderContext {
  /** The trader's own lock key: 33-byte compressed secp256k1 public key, lowercase hex. */
  traderPubkey: string;
  mints: TrustedMint[];
}

export interface CheckOptions {
  /** Amount the trader asked for, in sats. Leave out for sticker payments with no amount set. */
  requestedSats?: number;
}

/**
 * The elliptic curve operations the check needs. Injected so the rule layer
 * has no dependencies; production wires these to @noble/curves.
 */
export interface CurveOps {
  /** NUT-00 hash_to_curve over the UTF-8 bytes of the secret. Returns the compressed point, lowercase hex. */
  hashToCurve(secret: string): string;
  /**
   * NUT-12 check by a receiver ("Carol"): rebuild B' = Y + r*G and C' = C + r*A,
   * then check e == hash(R1, R2, A, C'). Must return false (not throw) on any invalid input.
   */
  verifyProofDleq(p: { Y: string; C: string; e: string; s: string; r: string; A: string }): boolean;
}

export interface Accepted {
  ok: true;
  /** Normalized mint URL. */
  mint: string;
  totalSats: number;
  /** totalSats minus the requested amount; 0 when nothing was requested. */
  overpaidSats: number;
  /** What the mint will charge when the trader collects (NUT-02 input fees), in sats. */
  feeSats: number;
  /** hash_to_curve(secret) for each proof: the replay keys. */
  ys: string[];
  proofs: Proof[];
}

export interface Refused {
  ok: false;
  code: FailCode;
  /** Developer detail. Never shown as the trader's main message, never contains personal data. */
  detail: string;
  /** Set only for `underpaid`, after every signature checked out: what the receipt does carry. */
  totalSats?: number;
}

export type Verdict = Accepted | Refused;
