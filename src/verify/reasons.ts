import type { FailCode } from './types.ts';

/** Headline on every red screen, whatever the reason. */
export const NOT_PAID_EN = "Not paid. Don't release the goods.";

/** One short line under the headline. Plain words for a busy trader. */
export const REASON_EN: Record<FailCode, string> = {
  malformed: "This isn't a valid receipt.",
  wrong_unit: "This receipt isn't in sats.",
  untrusted_mint: 'Not from your mint.',
  mint_not_ready: "Your mint can't lock payments to you. Choose another mint.",
  unknown_keys: "Can't check this receipt offline. Go online once, then scan again.",
  missing_dleq: "This receipt can't be checked offline.",
  not_locked_to_you: "This money isn't locked to you.",
  can_be_taken_back: 'The payer could take this money back.',
  shared_lock: 'Someone else could also spend this money.',
  unsupported_lock: "This receipt has conditions AlertProof doesn't accept.",
  bad_signature: 'Not signed by your mint.',
  underpaid: 'Less than the amount you asked for.',
  already_received: 'Already received.',
};
