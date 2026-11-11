# Security

AlertProof decides whether a trader releases goods, so the offline check is treated like money logic. This file records the threat model and every review and security pass, with what each found.

## What a green result promises

The receipt was signed by the trader's chosen mint (NUT-12 DLEQ against the cached key for each amount), is locked so only the trader's key can spend it with no way back for the payer (NUT-10/NUT-11), was not accepted before on this phone, and covers the amount asked for. Details: [src/verify/README.md](../src/verify/README.md). Threat model: [docs/SPEC.md](SPEC.md#threat-model-first-draft).

What it can't promise offline: that the mint stays honest and solvent (custodial ecash; the trader picks the mint and AlertProof sweeps to their own Lightning address when online), and, across two phones sharing one key, that a receipt wasn't accepted on the other phone.

## Passes so far

| # | Date | Kind | Method | Result |
|---|---|---|---|---|
| 1 | Nov 11 | Functional correctness | Unit tests for every refusal code and the happy path, written before the app | 64 rule-layer tests pass (76 with the curve vectors and wallet modules) |
| 2 | Nov 11 | Adversarial | Parser differential cases (duplicate keys, escapes, non-ASCII, numbers, trailing commas, deep nesting), forged, edited, relabelled and replayed receipts, a curve that throws | all refused |
| 3 | Nov 11 | Fuzzing | Seeded: 3,000 single random changes to genuine receipts, 3,000 random edits to a valid lock | no change ever turns green except harmless spellings of the trusted mint URL; nothing throws |
| 4 | Nov 11 | Mutation testing | Broke each of 20 rules on purpose and ran the tests | 19 of 20 caught at first; the off-by-one underpayment got a new test, now 20 of 20 |
| 5 | Nov 11 | Real-mint end to end | Go/No-Go on testnut.cashu.space (cdk-mintd 0.18.1): offline green with the network off, replay, relabelled mint, edited amount, attacker-mint signatures, wrong lock, real refund-path token; online, the mint refuses the customer's spends and accepts the trader's; after review #7, part payments and the fee too | 20 of 20 |
| 6 | Nov 11 | Curve math | Official Cashu vectors: NUT-00 hash_to_curve, NUT-12 hash_e, BlindSignature and Proof DLEQ; tampered and invalid inputs | pass; invalid inputs return false, never throw |
| 7 | Nov 11 | Independent review | A fresh reviewer (a separate Claude agent that didn't write the code) read the rule layer, curve layer and Go/No-Go looking for false greens, lost money and hangs, and probed each finding with scratch inputs | no false green for ecash the mint didn't sign or the payer could take back; 2 high, 2 medium and several low findings around replays, part payments and mint limits, below |

Still to come: static analysis, a second independent review after the app exists, and the privacy pass (no personal data, no cookies, no third-party scripts).

## Review #7 findings and what was done

| Severity | Finding | Done |
|---|---|---|
| High | A receipt already received, shown again for a bigger price, said "underpaid" instead of "already received", inviting "ask for 333 more" for goods worth 1,333 | Fixed: `acceptReceipt` claims every genuine receipt, full or part, so a second showing is always "already received". Test `review #1`, Go/No-Go step |
| High | A genuine part payment was never recorded: the trader couldn't collect it and the customer could show it again | Fixed: part payments are kept (`kept: true`) and the trader is told to ask for the rest. Test `review #2`, Go/No-Go step |
| Medium | A green secret up to 1,024 characters could be refused by a mint at collect time (nutshell caps at 512) | Fixed: 512-character cap, nonce must be 8 to 32 bytes of hex. Test `review #3` |
| Medium | Replay protection lasts only as long as the phone's storage; a phone restored from the recovery code can't tell an old receipt from a new one offline | Accepted for now, stated in src/verify/README.md: the app will request persistent storage and put the replay list in the backup. Per-sale lock keys (NUT-28 style blinding) are the stronger fix, listed as next steps |
| Low | Fees weren't counted before green: dust proofs could leave the trader with less than the price | Fixed: the amount is what lands after the NUT-02 fee, the pay page adds the fee, dust proofs are refused. Test `review #5`, and the Go/No-Go now collects the full price |
| Low | Proofs from a keyset past its `final_expiry` were green | Fixed: expiry cached and checked. Test `review #6` |
| Low | A lock to the trader's x-coordinate with the other 02/03 prefix is refused though NUT-11 would let the trader spend it | Kept on purpose: AlertProof's pay page copies the key exactly, and one way to read a lock is safer. Documented in lock.ts |
| Low | SPEC said n_sigs above 1 is refused; the code refuses any n_sigs | SPEC aligned with the code (some mints reject n_sigs without pubkeys) |
| Low | cashu-ts v4 hands back `Amount` objects and short keyset ids | Already handled by src/wallet/receipt.ts, which the Go/No-Go now uses |
| Low | Nothing tested a lock made by cashu-ts's own `p2pk` option | The pay page will build the lock itself (the code the Go/No-Go runs, 16-byte nonce, no tags), so the tested path is the shipped path |
| Info | Lock reasons were shown before the signature check, giving a forger a story ("let me fix the refund"); "go online and scan again" read like an excuse | Fixed: signatures first; `unknown_keys` now says "Can't confirm this receipt with your saved mint keys." Test `review #8` |
| Info | "Already received" sat under "Not paid", which is wrong if the trader missed the first green screen | Fixed: its own headline, "Already used. This receipt was scanned before." |
