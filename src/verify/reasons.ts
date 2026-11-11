import type { FailCode } from './types.ts';

/** Headline on a red screen. */
export const NOT_PAID_EN = "Not paid. Don't release the goods.";
/** Headline when the receipt was received before: the money came in once, not twice. */
export const ALREADY_USED_EN = 'Already used. This receipt was scanned before.';

export function headlineEn(code: FailCode): string {
  return code === 'already_received' ? ALREADY_USED_EN : NOT_PAID_EN;
}

/** One short line under the headline. Plain words for a busy trader. */
export const REASON_EN: Record<FailCode, string> = {
  malformed: "This isn't a valid receipt.",
  wrong_unit: "This receipt isn't in sats.",
  untrusted_mint: 'Not from your mint.',
  mint_not_ready: "Your mint can't lock payments to you. Choose another mint.",
  unknown_keys: "Can't confirm this receipt with your saved mint keys.",
  missing_dleq: "This receipt can't be checked offline.",
  not_locked_to_you: "This money isn't locked to you.",
  can_be_taken_back: 'The payer could take this money back.',
  shared_lock: 'Someone else could also spend this money.',
  unsupported_lock: "This receipt has conditions AlertProof doesn't accept.",
  bad_signature: 'Not signed by your mint.',
  underpaid: 'Part paid. This part is kept; ask for the rest.',
  already_received: "Don't release goods for it again.",
};
