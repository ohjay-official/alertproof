# Security

Sealpay decides whether a trader releases goods, so the offline check is treated like money logic. This file records the threat model and every review and security pass, with what each found.

## What a green result promises

The receipt was signed by the trader's chosen mint (NUT-12 DLEQ against the cached key for each amount), is locked so only the trader's key can spend it with no way back for the payer (NUT-10/NUT-11), was not accepted before on this phone, and covers the amount asked for. Details: [src/verify/README.md](../src/verify/README.md). Threat model: [docs/SPEC.md](SPEC.md#threat-model-first-draft).

What it can't promise offline: that the mint stays honest and solvent (custodial ecash; the trader picks the mint and Sealpay sweeps to their own Lightning address when online), and, across two phones sharing one key, that a receipt wasn't accepted on the other phone.

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
| 8 | Nov 15 | Static analysis | CodeQL's security-and-quality queries over all JavaScript and TypeScript, and npm audit, in CI ([static.yml](../.github/workflows/static.yml), results on the static-results branch) | npm audit: 0 vulnerabilities. CodeQL: 11 warnings, no errors. 9 are one false positive (CodeQL reads the bigint constant `N` as undefined); 2 are in test and CI-only code (the in-memory test mint sends error text back; the Go/No-Go writes its report from the mint's answers). Nothing to change in shipped code |
| 9 | Nov 15 | Wallet flows end to end | An in-memory mint with real curve math, real P2PK enforcement and input fees ([src/wallet/test/memory-mint.ts](../src/wallet/test/memory-mint.ts)): pay, a lost answer recovered with NUT-09 restore, finishing a payment twice, a mint with a bad DLEQ, the customer trying to take the money back, collect, cash out with change, an invoice bigger than the balance | 13 flow tests pass (114 in all). The Go/No-Go now runs the same pay, collect and cash-out code on testnut.cashu.space: 21 of 21 |
| 10 | Nov 16 | Static analysis, again | CodeQL and npm audit on the full app | 0 vulnerabilities; no new findings in shipped code |
| 11 | Nov 16 | Independent review of the app | A fresh reviewer (a separate Claude agent that didn't write the code) read everything built since Nov 11 (the app, storage, receipt codec, pay, collect, keys, PIN, pay link, service worker, headers) looking for false greens, lost money, injection and privacy leaks, and probed pure functions with hostile inputs | 1 critical, 4 high, 2 medium, 2 low, a few info; all fixed or stated, below. Confirmed sound: no untrusted text reaches HTML, strict pay-link parsing, safe short keyset ids, replay store transactions, PIN lock, CSP, service worker |
| 12 | Nov 16 | The app in a real browser | CI runs the judge's demo on the test mint with the site's real headers, offline open, slow 3G and a real customer payment ([scripts/ui-check.mjs](../scripts/ui-check.mjs)) | 16 of 16 on every push |

Still to come: a second independent review after the app exists, and the privacy pass (no personal data, no cookies, no third-party scripts).

## The trader's PIN, plainly

The seed behind the trader's key is stored encrypted with their PIN (PBKDF2-SHA256 with 600,000 rounds, then AES-GCM; [src/wallet/pin-lock.ts](../src/wallet/pin-lock.ts)). Checking a receipt needs only the public key, so the PIN is asked when collecting or cashing out, never at the till. It stops someone who picks up the phone from collecting or cashing out. It doesn't stop a lab that copies the phone's storage and tries every PIN. The real protection is collecting often (collected money stays locked to the trader's key) and the recovery code on paper.

## Review #7 findings and what was done

| Severity | Finding | Done |
|---|---|---|
| High | A receipt already received, shown again for a bigger price, said "underpaid" instead of "already received", inviting "ask for 333 more" for goods worth 1,333 | Fixed: `acceptReceipt` claims every genuine receipt, full or part, so a second showing is always "already received". Test `review #1`, Go/No-Go step |
| High | A genuine part payment was never recorded: the trader couldn't collect it and the customer could show it again | Fixed: part payments are kept (`kept: true`) and the trader is told to ask for the rest. Test `review #2`, Go/No-Go step |
| Medium | A green secret up to 1,024 characters could be refused by a mint at collect time (nutshell caps at 512) | Fixed: 512-character cap, nonce must be 8 to 32 bytes of hex. Test `review #3` |
| Medium | Replay protection lasts only as long as the phone's storage; a phone restored from the recovery code can't tell an old receipt from a new one offline | Accepted for now, stated in src/verify/README.md: the app will request persistent storage and put the replay list in the backup. Per-sale lock keys (NUT-28 style blinding) are the stronger fix, listed as next steps |
| Low | Fees weren't counted before green: dust proofs could leave the trader with less than the price | Fixed: the amount is what lands after the NUT-02 fee, the pay page adds the fee, dust proofs are refused. Test `review #5`, and the Go/No-Go now collects the full price |
| Low | Proofs from a keyset past its `final_expiry` were green | Fixed: expiry cached and checked. Test `review #6` |
| Low | A lock to the trader's x-coordinate with the other 02/03 prefix is refused though NUT-11 would let the trader spend it | Kept on purpose: Sealpay's pay page copies the key exactly, and one way to read a lock is safer. Documented in lock.ts |
| Low | SPEC said n_sigs above 1 is refused; the code refuses any n_sigs | SPEC aligned with the code (some mints reject n_sigs without pubkeys) |
| Low | cashu-ts v4 hands back `Amount` objects and short keyset ids | Already handled by src/wallet/receipt.ts, which the Go/No-Go now uses |
| Low | Nothing tested a lock made by cashu-ts's own `p2pk` option | The pay page will build the lock itself (the code the Go/No-Go runs, 16-byte nonce, no tags), so the tested path is the shipped path |
| Info | Lock reasons were shown before the signature check, giving a forger a story ("let me fix the refund"); "go online and scan again" read like an excuse | Fixed: signatures first; `unknown_keys` now says "Can't confirm this receipt with your saved mint keys." Test `review #8` |
| Info | "Already received" sat under "Not paid", which is wrong if the trader missed the first green screen | Fixed: its own headline, "Already used. This receipt was scanned before." |

## Review #11 findings and what was done

| Severity | Finding | Done |
|---|---|---|
| Critical | A real shop set up without changing the mint landed on the test mint, which pays its own invoices: fake sats showed as Paid with a naira amount | Fixed: no default mint, the trader must choose; the test mint is labelled on every screen and on the Paid screen; a test stall can be wiped with "Leave the demo" |
| High | One sale the mint refuses blocked every other collect; a crash after the swap lost the new proofs | Fixed: each sale is collected on its own; outputs are saved before the swap and the wallet and the collected mark are written in one transaction; an interrupted collect is recovered with NUT-09 restore; spent sales are marked |
| High | Cash out could make money vanish: UNPAID emptied the wallet, pending melts were never settled, a slow payment timed out | Fixed: the plan (quote, proofs, blank change outputs) is saved and the proofs leave the wallet in one transaction before paying; UNPAID gives them back; PENDING and lost answers settle on the next online open (melt quote state, check state, restore of change); melt waits 90 s |
| High | The pay page could overwrite a paid-but-unfinished payment, or show an old receipt for a new purchase | Fixed: payments are kept by quote; an unfinished one always comes first and is never dropped; a matching receipt is reused only within 30 minutes, with "Start a new payment" |
| High | The recovery code alone recovers no held money, and a restored phone accepted old receipts offline | Fixed what can be now: the setup text says exactly what the code restores; a backup file carries money, sales and seen receipts; a phone restored from the code alone confirms each receipt online. Deterministic secrets (NUT-13) and per-sale keys are next steps |
| Medium | Mint keys were never refreshed, so a rotated keyset would show real money as Not paid | Fixed: keys refresh when online and are merged with the saved ones; collect uses an active keyset |
| Medium | Expiry used the customer's phone clock and deleted the pending payment | Fixed: the mint decides over ten minutes of slower checks; nothing is deleted on the phone's say-so |
| Low | Two pollers could run after a link change | Fixed: a generation counter stops stale polls |
| Low | Sale details were shared between overlapping checks | Fixed: passed with each check |
| Info | A leading byte-order mark was dropped from a secret | Fixed: kept, so the phone reads secrets exactly as mints do |
| Info | Privacy: the mint can link collected payments to one key; CoinGecko sees the trader's IP | Stated on the privacy page |
