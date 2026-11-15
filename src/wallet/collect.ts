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
 * Both save nothing themselves: the caller stores what comes back. If the
 * mint's answer is lost, the same outputs are recovered with NUT-09.
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

export async function collect(
  api: MintApi,
  received: readonly Proof[],
  key: KeyPair,
  keysets: readonly CachedKeyset[],
  into: CachedKeyset,
): Promise<Collected> {
  if (received.length === 0) return { proofs: [], feeSats: 0 };
  const feeSats = inputFee(received, keysets);
  const total = sumAmounts(received);
  if (total <= feeSats) throw new Error(`${total} sats is not more than the mint's ${feeSats} sat fee`);
  const outputs = splitAmount(total - feeSats).map((a) => blindOutput(a, into.id, compactLock(key.pub)));
  const inputs = received.map((p) => signedInput(p, key.priv));
  const sigs = await signOrRestore(api, outputs, () => api.swap(inputs, wireOutputs(outputs)));
  return { proofs: unblindAll(sigs, outputs, into), feeSats };
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

/**
 * Pay `invoice` from `proofs`. All proofs are spent; whatever the invoice and
 * fees don't use comes back as change. A PENDING result means the payment is
 * still in flight: keep the proofs marked pending and check again later.
 */
export async function cashOut(
  api: MintApi,
  proofs: readonly Proof[],
  key: KeyPair,
  keysets: readonly CachedKeyset[],
  changeInto: CachedKeyset,
  invoice: string,
): Promise<CashOut> {
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
  const inputs = proofs.map((p) => signedInput(p, key.priv));
  const result = await api.melt(quote.quote, inputs, wireOutputs(blanks));
  if (result.change.length > blanks.length) throw new Error('mint returned more change than outputs');
  const change = result.change.map((sig, n) => unblind(sig, { ...blanks[n]!, amount: sig.amount }, changeInto));
  return {
    state: result.state,
    paidSats: quote.amount,
    feeSats: total - quote.amount - sumAmounts(change),
    preimage: result.preimage,
    change,
  };
}
