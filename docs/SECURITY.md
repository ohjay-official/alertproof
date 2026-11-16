# Security

Sealpay decides whether a trader releases goods, so the offline check is treated like money logic. This file records the threat model and every review and security pass, with what each found.

## What a green result promises

The receipt was signed by the trader's chosen mint (NUT-12 DLEQ against the cached key for each amount), is locked so only the trader's key can spend it with no way back for the payer (NUT-10/NUT-11), was not accepted before on this phone, and covers the amount asked for. Details: [src/verify/README.md](../src/verify/README.md). Threat model: [docs/SPEC.md](SPEC.md#threat-model-first-draft).

What it can't promise offline: that the mint stays honest and solvent (custodial ecash: the trader picks the mint and cashes out to their own Lightning wallet by pasting an invoice; there is no automatic sweep yet), and, across two phones sharing one key, that a receipt wasn't accepted on the other phone. After a restore, the online confirmation catches receipts that were already collected, but not ones the old phone accepted and never collected: those look unspent to the mint. Collecting often keeps that window small.

## Passes so far

| # | Date | Kind | Method | Result |
|---|---|---|---|---|
| 1 | Nov 11 | Functional correctness | Unit tests for every refusal code and the happy path, written before the app | 64 rule-layer tests pass (76 with the curve vectors and wallet modules) |
| 2 | Nov 11 | Adversarial | Parser differential cases (duplicate keys, escapes, non-ASCII, numbers, trailing commas, deep nesting), forged, edited, relabelled and replayed receipts, a curve that throws | all refused |
| 3 | Nov 11 | Fuzzing | Seeded: 3,000 single random changes to genuine receipts, 3,000 random edits to a valid lock | no change ever turns green except harmless spellings of the trusted mint URL; nothing throws |
| 4 | Nov 11 | Mutation testing (once, by hand, rule layer only) | Broke each of 20 rules on purpose and ran the tests | 19 of 20 caught at first; the off-by-one underpayment got a new test, now 20 of 20 |
| 5 | Nov 11 | Real-mint end to end | Go/No-Go on testnut.cashu.space (cdk-mintd 0.18.1): offline green with the network off, replay, relabelled mint, edited amount, attacker-mint signatures, wrong lock, real refund-path token; online, the mint refuses the customer's spends and accepts the trader's; after review #7, part payments and the fee too | 20 of 20 |
| 6 | Nov 11 | Curve math | Official Cashu vectors: NUT-00 hash_to_curve, NUT-12 hash_e, BlindSignature and Proof DLEQ; tampered and invalid inputs | pass; invalid inputs return false, never throw |
| 7 | Nov 11 | Independent review | A fresh reviewer (a separate Claude agent that didn't write the code) read the rule layer, curve layer and Go/No-Go looking for false greens, lost money and hangs, and probed each finding with scratch inputs | no false green for ecash the mint didn't sign or the payer could take back; 2 high, 2 medium and several low findings around replays, part payments and mint limits, below |
| 8 | Nov 15 | Static analysis | CodeQL's security-and-quality queries over all JavaScript and TypeScript, and npm audit, in CI ([static.yml](../.github/workflows/static.yml), results on the static-results branch) | npm audit: 0 vulnerabilities. CodeQL: 11 warnings, no errors. 9 are one false positive (CodeQL reads the bigint constant `N` as undefined); 2 are in test and CI-only code (the in-memory test mint sends error text back; the Go/No-Go writes its report from the mint's answers). Nothing to change in shipped code |
| 9 | Nov 15 | Wallet flows end to end | An in-memory mint with real curve math, real P2PK enforcement and input fees ([src/wallet/test/memory-mint.ts](../src/wallet/test/memory-mint.ts)): pay, a lost answer recovered with NUT-09 restore, finishing a payment twice, a mint with a bad DLEQ, the customer trying to take the money back, collect, cash out with change, an invoice bigger than the balance | 13 flow tests pass (114 in all). The Go/No-Go now runs the same pay, collect and cash-out code on testnut.cashu.space: 21 of 21 |
| 10 | Nov 16 | Static analysis, again | CodeQL and npm audit on the full app | 0 vulnerabilities; no new findings in shipped code |
| 11 | Nov 16 | Independent review of the app | A fresh reviewer (a separate Claude agent that didn't write the code) read everything built since Nov 11 (the app, storage, receipt codec, pay, collect, keys, PIN, pay link, service worker, headers) looking for false greens, lost money, injection and privacy leaks, and probed pure functions with hostile inputs | 1 critical, 4 high, 2 medium, 2 low, a few info; all fixed or stated, below. Confirmed sound: no untrusted text reaches HTML, strict pay-link parsing, safe short keyset ids, replay store transactions, PIN lock, CSP, service worker |
| 12 | Nov 16 | The app in a real browser | CI runs the judge's demo on the test mint with the site's real headers, offline open, slow 3G and a real customer payment ([scripts/ui-check.mjs](../scripts/ui-check.mjs)) | 16 of 16 on every push |
| 13 | Nov 16 | Review: functional correctness | A fresh Claude agent walked every flow (setup, restore, price, pay code, scan, verdicts, sales, collect, cash out, the customer's page, service worker) against the spec | 3 high, 4 medium, 5 low; no false green. Fixed, below |
| 14 | Nov 16 | Review: access control and state | A fresh Claude agent traced who can read or change each piece of state; reproduced a wallet race in headless Chrome | 2 high, 3 medium, 2 low. Fixed, below |
| 15 | Nov 16 | Review: financial logic | A fresh Claude agent checked every amount; 200,000 random conversions and 10,296 receipts through the real check | 1 high, 2 medium, 3 low; no money created, no false green. Fixed, below |
| 16 | Nov 16 | Adversarial scenarios | A fresh Claude agent attacked as a dishonest customer, a swapped pay code, a malicious mint, a phone thief, and with denial-of-service inputs | 1 high, 3 medium, 4 low; no forged, edited, replayed, wrong-mint or wrong-key receipt passed. Fixed, below |
| 17 | Nov 16 | Static analysis, second tool | Semgrep (javascript, typescript, xss, secrets, security-audit packs) in CI, next to CodeQL and npm audit | 2 warnings, both on a test that puts `<script>` in a shop name on purpose; nothing in shipped code |
| 18 | Nov 16 | Fuzzing and invariants | 4,000 random price and fee cases for the minimal fee; 40 random sales end to end on the in-memory mint (green for the price, refused above it, collect and cash out conserve money, nothing spent twice); 20,000 conversions; 300 animated receipts; 3,000 pay links | all hold, on every push |
| 19 | Nov 16 | Mutation testing, as a script | [scripts/mutate.mjs](../scripts/mutate.mjs): 26 rules broken on purpose across the check, lock rules, parser, mint URLs, receipt codec, QR frames and pay links | 26 of 26 caught, on every push; its first run found the 64-proof limit had no test of its own |
| 20 | Nov 16 | Final independent review | A fifth fresh Claude agent formed its own view, then checked every fix from passes 13 to 16 | the fixes hold (Web Locks without deadlock, atomic wallet writes, backup rules, lock whitespace rule); 1 high, 6 medium, 4 low left, fixed, below |

Both independent reviews (#7 and #11) were done by separate Claude agents that hadn't written the code, not by people; a human security review is still to come. The privacy pass is in the [privacy page](https://sealpay-beta.vercel.app/privacy) and review #11.

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

## Audit passes 13 to 16 and 20 (Nov 16): findings and what was done

No pass found a false green for a forged, edited, replayed, wrong-mint or wrong-key receipt. What they found was mostly ways money could get stuck, be double-counted, or be shown wrongly, and ways a backup file or the phone itself could be misused.

| Severity | Finding | Done |
|---|---|---|
| High | Two writers to the wallet (two tabs, or settling while collecting) could drop or duplicate money; reproduced in Chrome | Every money step runs under one lock (Web Locks, across tabs); the wallet and pending steps are read and written inside one transaction, de-duplicated by secret; buttons disable while running |
| High | A cash out could reuse proofs a saved step already held, double-counting them | Cash out re-reads the wallet under the lock and skips anything a saved step holds |
| High | "Save a backup file" needed no PIN and carried the PIN-locked seed, so a 4-digit PIN could be cracked from a shared file | Backup needs the PIN and leaves out the seed; restoring needs the recovery code plus the file, checked against it |
| High | A restored phone recorded a receipt before its online check, so an honest customer could be told "Already used" | The mint confirms first, then the receipt is recorded |
| High | An old unpaid invoice took over every later pay code on the customer's phone | It only resumes for the same code; otherwise a link back to it; "I'm not paying this" keeps the record in case a payment lands |
| High | Restoring from a backup skipped the online confirmation | Every restore confirms receipts online for 14 days |
| Medium | A crafted backup file could plant mint keys, a different shop key, steps or totals | The shop key must come from the recovery code; mint keys are always fetched from the mint (including older keysets the file's money uses); halfway steps are not imported; sale totals are recomputed from the proofs; only known fields are read |
| Medium | A swapped pay code could show "Pay ₦1,000" while asking for 0.1 BTC | The naira or CFA price shows only once it matches the sats at today's rate; otherwise a warning |
| Medium | One stuck step blocked all later settling; a step for an unknown keyset could be dropped, losing its outputs | Each step settles on its own; a step whose keyset isn't known yet is never dropped; mixed spent states are marked |
| Medium | A failed Lightning payment kept the money away for 10 minutes or more | When the mint itself says the payment failed, the money comes straight back; settling also runs when Sales opens |
| Medium | Pay codes could name a keyset that expires within the check's 3-day margin | Keysets that close are never picked |
| Medium | Same price at the same stall within 30 minutes reused the old receipt | Each pay code carries when it was made |
| Medium | Camera kept running after leaving the scan screen | Stopped on every screen change |
| Low | A stray QR code mid-way through an animated receipt ended the scan as Not paid | Ignored |
| Low | Locks with whitespace around them were accepted (a parser-differential surface) | Refused; Sealpay never writes them |
| Low | Proofs from a keyset expiring within minutes passed | Refused within 3 days of expiry |
| Low | splitAmount used 32-bit maths; rates weren't checked before use; prices too big for a pay code; "ask for more" rounded differently on screen and code; a rate arriving while typing changed what digits meant | All fixed |
| Low | Wrong PINs could be tried without limit | They slow down after the third. Moving the phone's clock forward resets the wait; the 600,000-round key derivation remains the real cost |
| Low | Start over could hang with a second tab open | The database closes for other tabs |
| Info | Shop names could be cut mid-emoji or stack accent marks | Cut by whole characters; accent towers trimmed |
