# Runsheet: Sealpay at Dakar Bitcoin Hack 2026

Read this first in every session, then the plan in [docs/SPEC.md](../SPEC.md) and what is left in [CHECKLIST.md](CHECKLIST.md). Update and push it before ending.

## Event

- Event: Dakar Bitcoin Hack 2026 by Btrust, https://dakar-bitcoin-hack-2026.devpost.com/ (rules: /rules, gallery: /project-gallery)
- Closes **Nov 20, 2026, 21:00 Lagos (20:00 UTC)**. Submit by Nov 20 midday, never at the wire.
- Students only, must reside in Africa, solo allowed (confirmed Nov 11). 1st prize $500 in BTC.
- Required: presentation (text or video), public GitHub repo, MVP online or a demo video, a Bitcoin/Lightning wallet implementation.

## Checkpoints (Lagos time)

| By | What | Status |
|---|---|---|
| Nov 11 | Idea locked, repo, spec, research | done |
| Nov 12 end | Core verifier solid, Go/No-Go passes on the test mint | **GO on Nov 11** (18/18 on testnut.cashu.space); review passes continue |
| Nov 12 | Live URL (placeholder is fine) | **live Nov 16: https://sealpay-beta.vercel.app** (sealpay.vercel.app was taken); every page checked, no cookies |
| Nov 15 | App's money logic (pay, collect, cash out, keys, PIN, pay link, rates, QR frames) | **done**: 114 tests, Go/No-Go 21/21 on testnut running the app's own code |
| Nov 16 to 19 | Screens, trader visits (5 by Nov 17), real-money proof, README, film | screens: mockup sent Nov 15, waiting for his OK on the look |
| Nov 19 | Everything frozen except fixes | |
| Nov 20 midday | Submit once | |

## Decisions

- Nov 11: Sealpay chosen (Cashu ecash locked to the trader's key, checked offline with DLEQ). Name chosen for being clear to anyone.
- Nov 11: NFC sticker only after the core works. USSD and AI skipped.
- Nov 11: Tests use Node's built-in runner with native TypeScript (zero dev dependencies for the rule layer); Vitest dropped from the stack.
- Nov 11: Only one lock shape is accepted (P2PK to the trader, sigflag SIG_INPUTS or none). Secrets are read with a narrow parser so the phone and the mint can't read one secret two ways. Signatures are checked before the amount.
- Nov 11: The Go/No-Go talks to the mint over its plain REST API with blinding on @noble/curves, and round-trips the receipt through cashu-ts (cashuB).
- Nov 11: Test mint is testnut.cashu.space (cdk-mintd 0.18.1, 100 ppk fee per proof): nofees.testnut.cashu.space no longer resolves.
- Nov 11: Go/No-Go passed. Measured: offline check 48 ms (CI runner), 1,333 sats = 6 proofs = 2,896 cashuB characters, trader cache 5.4 KB. That receipt is too dense for one QR on a cheap camera, so the receipt QR must be animated, and the customer page should keep receipts small (short nonce, no sigflag tag, which defaults to SIG_INPUTS).
- Nov 11: Pinned versions from CI's lockfile: @cashu/cashu-ts 4.13.1, @noble/curves 2.4.0, @noble/hashes 2.4.0, typescript 6.0.3. cashu-ts v4 decodes amounts as `Amount` objects and `getDecodedToken` needs the full keyset ids to expand short ones.
- Nov 11: Independent review done, findings fixed or accepted (docs/SECURITY.md). Genuine part payments are kept. The pay page builds the lock itself (16-byte nonce, no tags) rather than through cashu-ts's p2pk option, so the tested path is the shipped path; receipt now 2,368 characters for 6 proofs. Go/No-Go 20/20.
- Nov 15: Wallet logic talks to the mint's plain REST API with blinding on @noble/curves (src/wallet), not cashu-ts's Wallet class, so the code the Go/No-Go runs on testnut is the code the app ships. cashu-ts is only used to encode and decode cashuB.
- Nov 15: Collect swaps received proofs into fresh proofs that stay locked to the trader, so a stolen phone without the PIN can't spend them. Cash out melts to a Lightning invoice with change locked to the trader (NUT-08). A lost mint answer is recovered with NUT-09 restore.
- Nov 15: Recovery code is the 16-byte seed as 28 characters (Crockford base32, groups of four, 2-character check). The 12-word form waits for Advanced.
- Nov 15: Rates from CoinGecko (BTC in NGN and EUR); CFA from the euro peg (655.957 XOF per EUR). CI confirmed testnut and CoinGecko both allow browser calls (CORS `*`), so no server is needed. Rate on Nov 15: 1 BTC = ₦87.26M, so ₦2,000 is about 2,292 sats: the film and README must use the live rate, not the old 1,333 sat example.
- Nov 15: Pay link is `/pay#k=&m=&s=&a=&f=&c=&h=` (key, mint, shop, sats, fiat, currency, keyset hint), read strictly; the part after # never reaches a server.
- Nov 15: Animated receipt QR uses its own small frame format (`AP1:n/total:check:part`, about 280 characters a frame); a short receipt stays one plain cashuB QR any Cashu wallet reads.
- Nov 15: Per-sale lock keys (review #7's medium finding) deferred to next steps: screens, trader visits and the live link come first.
- Nov 16: Renamed to Sealpay everywhere in the repo (no payments brand by that name found). Key derivation domain is now "Sealpay trader key v1" (no real keys existed yet). Repo renamed to ohjay-official/sealpay by his agent (Grokbot) on Nov 16; old links redirect.
- Nov 15: Static analysis pass done (CodeQL + npm audit), nothing to fix in shipped code (docs/SECURITY.md pass 8).

## CHECK IN (open)

- Nov 15: mockup of the six main screens sent (POS-style keypad, full-screen green/red verdict with a "Paid" stamp, no web fonts; [docs/design](../design)). Waiting for his reaction before building the UI.

## HIS CALL (open)

- Optional: allow package installs in Claude's network settings, so future chats can run everything locally too.

## Gate log

- Nov 11: confirmed solo entries are allowed; chose the idea (then named AlertProof); created the public repo ohjay-official/alertproof.
- Nov 15: said "continue the Dakar build" (resumed a day early).
- Nov 16: his agent (Grokbot) added VERCEL_TOKEN; first deploy 00:53 Lagos, live at https://sealpay-beta.vercel.app.
- Nov 16: his agent renamed the repo to ohjay-official/sealpay (only the name changed; still public, main).
- Nov 16: renamed the product from AlertProof ("generic, sounds AI-made") to **Sealpay**: the mint seals the payment, locked to the trader, and the trader's phone checks the seal. Rejected: Gbam, Landed, Stamp, Touchstone, Till; wanted a made-up brand word from plain English.

## Session capabilities (Nov 15, session 3)

- Push to GitHub: yes. Package installs: **blocked**. GitHub API: readable without a token (`curl https://api.github.com/repos/ohjay-official/sealpay/actions/runs`).
- Local: Node 22.23, tsc, esbuild (/opt/npm-tools/node_modules/esbuild), Playwright 1.63 with Chrome (/usr/bin/google-chrome) for screenshots and browser tests of local pages, ffmpeg. Not local: @noble, @cashu, so anything with curve math is tested in CI.
- CI is the laptop: `verify.yml` (types, tests, Go/No-Go, CORS and price probes) publishes to `verify-results`; `static.yml` (CodeQL, npm audit) to `static-results`; `web.yml` to `web-results`. These branches are force-pushed: fetch with a + refspec, e.g. `git fetch --depth 2 origin +verify-results:refs/remotes/origin/verify-results`.
- Locally, `npm run test:pure` runs the 87 tests that need no packages.

## Next step

1. Get his reaction to the screen mockup (CHECK IN) and the VERCEL_TOKEN (HIS CALL).
2. Then the app shell: esbuild in CI, `web/src`, CSP opened only to the trusted mints and the price API. Trader: setup (shop, mint, key, recovery code, PIN), ask (keypad, rate), pay code QR, scan (BarcodeDetector, lazy fallback for iPhone), verdict screen (voice, buzz), IndexedDB store, collect and cash out. Customer: pay page with the invoice, then the animated receipt QR. Demo mode on testnut for judges.
3. Playwright in CI: the whole flow in a real browser against testnut, with the trader's network switched off; screenshots to the results branch.
