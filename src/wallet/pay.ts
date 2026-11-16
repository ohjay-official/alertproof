/**
 * The customer's side: pay a Lightning invoice, get ecash locked to the
 * trader's key, hand over the receipt. The customer needs no Cashu wallet,
 * only a Lightning wallet they already use (or the test mint's fake sats).
 *
 *   1. startPayment   pick the trader's keyset, add the mint's collect fee,
 *                     blind the outputs (locked to the trader), ask for an invoice
 *   2. (customer pays the invoice; the page saves the PendingPayment first,
 *      so closing the page loses nothing)
 *   3. paymentState   UNPAID, PAID, ISSUED or EXPIRED
 *   4. finishPayment  mint, check every DLEQ, return the proofs. If the
 *                     answer was lost, recover the same signatures (NUT-09).
 */
import { amountWithFee, blindOutput, compactLock, splitAmount, unblindAll, wireOutputs, type BlindSignature, type BlindedOutput } from './ecash.ts';
import { MintError, type MintApi } from './mint-api.ts';
import { normalizeMintUrl } from '../verify/mint-url.ts';
import { isPubkeyHex } from '../verify/lock.ts';
import type { CachedKeyset, DecodedToken, Proof } from '../verify/types.ts';

/** Everything needed to finish a payment later. Plain JSON, saved before the invoice is shown. */
export interface PendingPayment {
  v: 1;
  mint: string;
  keysetId: string;
  traderPubkey: string;
  /** what the trader asked for, in sats */
  priceSats: number;
  /** what the customer pays: the price plus the mint's fee for the trader to collect it */
  amountSats: number;
  quote: string;
  invoice: string;
  expiry: number | null;
  outputs: BlindedOutput[];
  createdAt: number;
}

/**
 * The keyset to pay with: the one the trader cached (their link carries the
 * start of its id) if the mint still has it active, otherwise the active sat
 * keyset with the lowest fee.
 */
export function pickKeyset(keysets: readonly CachedKeyset[], hint?: string, nowSeconds = Math.floor(Date.now() / 1000)): CachedKeyset {
  // Never a keyset the trader's check would refuse for expiring too soon (3 days, as in src/verify/check.ts).
  const sat = keysets.filter((k) => k.unit === 'sat' && (k.final_expiry === undefined || nowSeconds + 3 * 86_400 < k.final_expiry));
  if (sat.length === 0) throw new Error('the mint has no active sat keyset');
  if (hint) {
    const match = sat.find((k) => k.id.startsWith(hint));
    if (match) return match;
  }
  return [...sat].sort((a, b) => (a.input_fee_ppk ?? 0) - (b.input_fee_ppk ?? 0))[0]!;
}

export async function startPayment(
  api: MintApi,
  keyset: CachedKeyset,
  traderPubkey: string,
  priceSats: number,
  now: () => number = Date.now,
): Promise<PendingPayment> {
  if (!isPubkeyHex(traderPubkey)) throw new Error("the trader's key in this link is not valid");
  const mint = normalizeMintUrl(api.url);
  if (!mint) throw new Error('mint URL must be https');
  const amountSats = amountWithFee(priceSats, keyset.input_fee_ppk ?? 0);
  const amounts = splitAmount(amountSats);
  for (const a of amounts) {
    if (!keyset.keys[String(a)]) throw new Error(`the mint has no key for ${a} sats`);
  }
  // Blind first: nothing about the outputs depends on the quote.
  const outputs = amounts.map((a) => blindOutput(a, keyset.id, compactLock(traderPubkey)));
  const q = await api.createMintQuote(amountSats);
  return {
    v: 1,
    mint,
    keysetId: keyset.id,
    traderPubkey,
    priceSats,
    amountSats,
    quote: q.quote,
    invoice: q.request,
    expiry: q.expiry,
    outputs,
    createdAt: now(),
  };
}

export async function paymentState(
  api: MintApi,
  p: PendingPayment,
  nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
): Promise<'UNPAID' | 'PAID' | 'ISSUED' | 'EXPIRED'> {
  const q = await api.getMintQuote(p.quote);
  if (q.state === 'UNPAID' && p.expiry !== null && nowSeconds() > p.expiry) return 'EXPIRED';
  return q.state;
}

/**
 * Signatures for `outputs`, from a mint call, or, if that call fails or its
 * answer is lost, from the mint's record of what it already signed (NUT-09).
 * Restore only ever returns signatures for these exact blinded outputs, so
 * it can't hand back someone else's money.
 */
export async function signOrRestore(
  api: MintApi,
  outputs: readonly BlindedOutput[],
  call: () => Promise<BlindSignature[]>,
): Promise<BlindSignature[]> {
  let first: unknown;
  try {
    return await call();
  } catch (err) {
    first = err;
  }
  // Only worth asking if the mint may have signed: a timeout, a lost answer,
  // or "already issued / already signed". A plain refusal is rethrown.
  if (first instanceof MintError && first.status >= 400 && first.status < 500 && !isAlreadySigned(first)) throw first;
  let restored: Awaited<ReturnType<MintApi['restore']>>;
  try {
    restored = await api.restore(wireOutputs(outputs));
  } catch {
    throw first;
  }
  const byB = new Map<string, BlindSignature>();
  restored.outputs.forEach((o, n) => {
    const sig = restored.signatures[n];
    if (sig) byB.set(o.B_, { ...sig, amount: sig.amount || o.amount });
  });
  const sigs = outputs.map((o) => byB.get(o.B_));
  if (sigs.some((s) => s === undefined)) throw first;
  return sigs as BlindSignature[];
}

function isAlreadySigned(err: MintError): boolean {
  // NUT-00 error codes: 10002 output already signed, 20002 quote already issued
  return err.code === 10002 || err.code === 20002 || /already (been )?(signed|issued)/i.test(err.message);
}

/** Mint the paid quote and return the receipt: proofs locked to the trader, each with its DLEQ proof. */
export async function finishPayment(api: MintApi, p: PendingPayment, keyset: CachedKeyset): Promise<DecodedToken & { proofs: Proof[] }> {
  if (keyset.id !== p.keysetId) throw new Error('keyset changed since the payment started');
  const sigs = await signOrRestore(api, p.outputs, () => api.mint(p.quote, wireOutputs(p.outputs)));
  const proofs = unblindAll(sigs, p.outputs, keyset);
  return { mint: p.mint, unit: 'sat', proofs };
}
