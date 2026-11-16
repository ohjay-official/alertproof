# Build log

All code in this repo is written with AI (Claude), directed and reviewed by the builder. Times are Lagos.

## Nov 11, 2026

- Researched the event, judges, last year's winners and this year's field; chose Sealpay. Plan and research pushed as docs/SPEC.md and docs/RESEARCH.md.
- Offline verifier rule layer (src/verify): strict secret parser, lock rules (only P2PK to the trader with no locktime, refund, extra keys or unknown tags), trusted mint and keyset checks, DLEQ through injected curve operations, signatures before amount, atomic replay store.
- 58 rule-layer tests: every refusal, parser differential cases (duplicate keys, escapes, non-ASCII), 3,000-run seeded fuzzing of genuine receipts and of locks. Each rule was broken on purpose once to confirm a test catches it (20 of 20 caught after one test was added).
- Curve layer on @noble/curves with the official Cashu NUT-00 and NUT-12 test vectors.
- Go/No-Go script for the real test mint, and a CI workflow that runs everything and publishes logs to the verify-results branch.
- CI: 65 of 65 tests pass, including the official NUT-00 and NUT-12 vectors. Go/No-Go: 18 of 18 on testnut.cashu.space (GO). Fixed on the way: nofees.testnut.cashu.space no longer resolves (switched to testnut), and cashu-ts v4's `getDecodedToken` wants full keyset ids.
- Lockfile pinned from CI.
- App modules: the trader's mint cache (src/wallet/mint-cache.ts) and cashuB receipt decoding (src/wallet/receipt.ts). The Go/No-Go now runs on them: still 18 of 18, 70 tests in CI.
- Placeholder site (web/) and a Vercel deploy workflow adapted from Contri; it deploys once VERCEL_TOKEN is added.
- Independent review by a separate agent: no false green for unsigned or take-back-able ecash; fixed its two high findings (replay vs "short by", part payments kept) and the rest (fees, keyset expiry, 512-char secrets, check order, wording). Recorded in docs/SECURITY.md.
- Compact lock (16-byte nonce, no tags) cut the receipt from 2,896 to 2,368 characters. Go/No-Go: 20 of 20, 76 tests in CI.

## Nov 15, 2026

- Resumed after the Apart sprint. The app's money logic, all in src/wallet and tested before any screen:
  - customer pays (pay.ts): an invoice for the price plus the mint's collect fee, then ecash locked to the trader, every DLEQ checked; a lost mint answer is recovered with NUT-09 restore, and finishing a payment twice gives the same receipt, not double money
  - trader collects and cashes out (collect.ts): a signed swap into fresh proofs that stay locked to the trader, and a melt to a Lightning invoice with the change locked to the trader (NUT-08)
  - the trader's key from a 16-byte seed, shown as a 28-character recovery code with a check (keys.ts), and kept encrypted with a PIN (pin-lock.ts)
  - the pay link (request.ts), naira and CFA rates (rates.ts), and animated receipt QR frames (frames.ts)
- An in-memory mint with real curve math and real lock enforcement, so the whole money path is tested without a network.
- The Go/No-Go now runs the app's own pay, collect and cash-out code on testnut.cashu.space: 21 of 21, including a cash-out of 1,000 sats with 332 sats of change. 114 tests in CI.
- Static analysis pass: CodeQL and npm audit in CI; 0 vulnerabilities, nothing to change in shipped code (docs/SECURITY.md).
- CI confirmed the test mint and the price API both accept calls from a browser page, so the app needs no server.
- Mockup of the six main screens for review ([docs/design](design)).

## Nov 16, 2026

- Renamed the product from AlertProof to Sealpay across the code, docs and site.
- The app: trader setup, POS keypad, pay code, camera scan of animated receipts, full-screen verdicts with tone, buzz and voice, sales, collect and cash out; customer pay page; demo mode with a network switch. Live at https://sealpay-beta.vercel.app.
- CI now builds the app and runs the whole demo in a real browser on the test mint: 12 of 12, Paid checked in 17 ms with the network off and 0 requests.
- Own cashuB reader and writer replaced the Cashu library in the app: first load 77.5 KB to 42.7 KB gzipped (budget 60 KB). 120 tests; Go/No-Go 21 of 21.
- Afternoon: full audit before UI work, as for Contri. Four review passes with different purposes (functional, state and access, financial logic, adversarial), a final independent review, Semgrep next to CodeQL, money invariants over random sales, and mutation testing on every push (26 of 26). No false green found; about 40 findings on stuck or double-counted money, backups, restores and the customer page, all fixed or stated (docs/SECURITY.md). 132 tests.
