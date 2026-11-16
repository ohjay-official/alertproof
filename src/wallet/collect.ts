/**
 * The trader's side, once online: collect what was received and cash it out.
 *
 *   collect   swap the received proofs, signed with the trader's key, for
 *             fresh proofs that are locked to the trader again. This is where
 *             the mint itself confirms the money was real and unspent. The new
 *             proofs stay locked, so a stolen phone without the PIN can't spend them.
 *   cashOut   pay a Lightning invoice from the trader's own wallet (melt),
 *             with any change locked to the trader (NUT-08).
 *
 * Each step is split into a plan and a run, so the app can save the plan
 * (the blinded outputs) before anything goes over the network. If the phone
 * dies or the answer is lost, the saved outputs recover the money with NUT-09
 * restore (recoverOutputs).
 */
import {
  bitLength,
  blindOutput,
  compactLock,
  inputFee,
  signedInput,
  splitAmount,
  sumAmounts,
  unblind,
  unblindAll,
  wireOutputs,
  type BlindedOutput,
  type KeyPair,
} from './ecash.ts';
import type { MintApi, MeltState } from './mint-api.ts';
import { signOrRestore } from './pay.ts';
import type { CachedKeyset, Proof } from '../verify/types.ts';

export interface Collected {
  proofs: Proof[];
  /** the mint's fee for this swap */
  feeSats: number;
}

export interface CollectPlan {
  outputs: BlindedOutput[];
  feeSats: number;
}

/** The outputs to collect into: save these before calling collect. */
export function planCollect(received: readonly Proof[], key: KeyPair, keysets: readonly CachedKeyset[], into: CachedKeyset): CollectPlan {
  const feeSats = inputFee(received, keysets);
  const total = sumAmounts(received);
  if (total <= feeSats) throw new Error(`${total} sats is not more than the mint's ${feeSats} sat fee`);
  return { outputs: splitAmount(total - feeSats).map((a) => blindOutput(a, into.id, compactLock(key.pub))), feeSats };
}

export async function collect(
  api: MintApi,
  received: readonly Proof[],
  key: KeyPair,
  keysets: readonly CachedKeyset[],
  into: CachedKeyset,
  plan: CollectPlan = planCollect(received, key, keysets, into),
): Promise<Collected> {
  if (received.length === 0) return { proofs: [], feeSats: 0 };
  const inputs = received.map((p) => signedInput(p, key.priv));
  const sigs = await signOrRestore(api, plan.outputs, () => api.swap(inputs, wireOutputs(plan.outputs)));
  return { proofs: unblindAll(sigs, plan.outputs, into), feeSats: plan.feeSats };
}

/**
 * Proofs the mint already signed for these saved outputs, or null if it
 * signed none of them. Blank change outputs come back with the amounts the
 * mint gave them; outputs it never signed are skipped.
 */
export async function recoverOutputs(api: MintApi, outputs: readonly BlindedOutput[], keyset: CachedKeyset): Promise<Proof[] | null> {
  if (outputs.length === 0) return [];
  const r = await api.restore(wireOutputs(outputs));
  const byB = new Map(r.outputs.map((o, n) => [o.B_, r.signatures[n]] as const));
  const proofs: Proof[] = [];
  for (const out of outputs) {
    const sig = byB.get(out.B_);
    if (sig) proofs.push(unblind(sig, { ...out, amount: sig.amount }, keyset));
  }
  return proofs.length ? proofs : null;
}

export interface CashOut {
  state: MeltState;
  /** what the invoice was for */
  paidSats: number;
  /** Lightning routing fee the mint actually kept, plus its input fee */
  feeSats: number;
  preimage: string | null;
  /** change, locked to the trader; keep it */
  change: Proof[];
}

/** The mint says the Lightning payment failed and nothing was spent: the proofs can go straight back. */
export class MeltFailedError extends Error {
  constructor() {
    super('The Lightning payment failed. Nothing was spent; try again or use another invoice.');
    this.name = 'MeltFailedError';
  }
}

export interface MeltPlan {
  quote: string;
  amountSats: number;
  feeReserveSats: number;
  inputFeeSats: number;
  proofs: Proof[];
  blanks: BlindedOutput[];
}

/** Get a melt quote and the blank change outputs: save this before running it. */
export async function planCashOut(
  api: MintApi,
  proofs: readonly Proof[],
  key: KeyPair,
  keysets: readonly CachedKeyset[],
  changeInto: CachedKeyset,
  invoice: string,
): Promise<MeltPlan> {
  const quote = await api.createMeltQuote(invoice.trim());
  const inFee = inputFee(proofs, keysets);
  const total = sumAmounts(proofs);
  const need = quote.amount + quote.fee_reserve + inFee;
  if (total < need) {
    throw new Error(`Not enough to pay this invoice: it needs ${need} sats with fees, you have ${total}.`);
  }
  // Blank outputs for change (NUT-08): enough of them to hold any change up to the most possible.
  const maxChange = total - inFee - quote.amount;
  const blanks = Array.from({ length: maxChange > 0 ? bitLength(maxChange) : 0 }, () => blindOutput(1, changeInto.id, compactLock(key.pub)));
  return { quote: quote.quote, amountSats: quote.amount, feeReserveSats: quote.fee_reserve, inputFeeSats: inFee, proofs: [...proofs], blanks };
}

/**
 * Run a saved melt plan. Throws if the payment failed (nothing spent). A
 * PENDING result means the payment is still in flight: keep the plan and
 * settle it later with settleCashOut.
 */
export async function runCashOut(api: MintApi, plan: MeltPlan, key: KeyPair, changeInto: CachedKeyset): Promise<CashOut> {
  const inputs = plan.proofs.map((p) => signedInput(p, key.priv));
  const result = await api.melt(plan.quote, inputs, wireOutputs(plan.blanks));
  if (result.state === 'UNPAID') throw new MeltFailedError();
  if (result.change.length > plan.blanks.length) throw new Error('mint returned more change than outputs');
  const change = result.change.map((sig, n) => unblind(sig, { ...plan.blanks[n]!, amount: sig.amount }, changeInto));
  return {
    state: result.state,
    paidSats: plan.amountSats,
    feeSats: sumAmounts(plan.proofs) - plan.amountSats - sumAmounts(change),
    preimage: result.preimage,
    change,
  };
}

/**
 * Where a saved melt stands now: paid (with its change recovered), failed
 * (the proofs are still unspent and go back to the wallet), or still pending.
 */
export async function settleCashOut(
  api: MintApi,
  plan: MeltPlan,
  changeInto: CachedKeyset,
  hashToCurve: (secret: string) => string,
): Promise<{ state: 'PAID'; change: Proof[] } | { state: 'FAILED'; proofs: Proof[] } | { state: 'PENDING' }> {
  const q = await api.getMeltQuote(plan.quote);
  if (q.state === 'PAID') return { state: 'PAID', change: (await recoverOutputs(api, plan.blanks, changeInto)) ?? [] };
  if (q.state === 'PENDING') return { state: 'PENDING' };
  const states = await api.checkState(plan.proofs.map((p) => hashToCurve(p.secret)));
  if (states.every((s) => s === 'UNSPENT')) return { state: 'FAILED', proofs: plan.proofs };
  return { state: 'PENDING' };
}

/** Plan and run in one go (scripts and tests). */
export async function cashOut(
  api: MintApi,
  proofs: readonly Proof[],
  key: KeyPair,
  keysets: readonly CachedKeyset[],
  changeInto: CachedKeyset,
  invoice: string,
): Promise<CashOut> {
  return runCashOut(api, await planCashOut(api, proofs, key, keysets, changeInto, invoice), key, changeInto);
}
