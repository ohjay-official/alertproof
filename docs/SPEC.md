# AlertProof: spec (Dakar Bitcoin Hack 2026)

**Payments a fake alert can't fake.** A trader confirms a Bitcoin payment in one scan, even with no data on their phone. The receipt is signed by the mint and locked to the trader's key, so it can't be faked, edited, reused or taken back.

## Deadline

| When (Lagos time) | What |
|---|---|
| **Nov 20, 21:00 (20:00 UTC)** | **Dakar Bitcoin Hack closes. Submit by Nov 20 midday, never at the wire.** |

Build windows: Nov 11 to 12 (core and Go/No-Go), Nov 16 to 19 (app, trader visits, real-money proof, docs, film), Nov 20 morning (final checks, submit).

## Rules that shape the build

- Students only; must reside in Africa. Solo entry confirmed allowed (Nov 11). Keep a student ID ready.
- Required: a presentation (text or video), a **public GitHub repo**, an MVP reachable on the internet or a demo video, and at least a Bitcoin/Lightning wallet implementation.
- Judges mainly look for an MVP they can test. Criteria: usefulness and local impact (primary user, workflow change, reach estimate); security by design (threat model, least privilege, safe secrets, validated inputs, no PII in logs, proven libraries); UX on **low bandwidth and mid-range phones**; working MVP (one-command setup, seed data, testable happy path); clear pitch (3-minute demo: problem, solution, impact, next steps) and README (setup, architecture diagram, constraints, metrics, next steps).
- Judges: Mouhamadou "Nourou" Kouta (organizer; Banxaas, a Lightning to Wave/Orange Money bridge), Kelvin Isievwore (Head of Engineering, Btrust), Peter Tyonum (BDK maintainer, Btrust Builders), Yogen Ghodke (AI solutions engineer). See docs/RESEARCH.md.

## Why this idea (competition as of Nov 11)

21 entries already. Four are savings circles on Lightning (Ajo on Lightning, Twese, CircleSats, Natt), three are merchant or shop payments (SunuSats, SamaBoutik, SmartPay Africa), one is remittances with fake HMAC "offline vouchers" (SatsFlow), one is a scam-warning wallet (Zafy). None lets a trader with no data confirm a real payment. SunuSats lists low-end phones as future work. Nobody measures bandwidth.

Lightning can't pay a receiver whose phone is offline (BOLT async payments are still an open proposal). Cashu ecash, backed by Lightning, can: proofs locked to the trader's key (NUT-11) carry the mint's signature proof (NUT-12 DLEQ), so a phone with no connection can check them against the mint's cached public keys. This is a live topic upstream (cashu-ts kept DLEQ on offline sends on Nov 7, 2026; CDK issue #1927 asks for offline receive), so the core is current and contributable.

**Numo** (the Cashu team's Android point-of-sale app) is the closest product and the mirror image: its customer can be offline but its merchant must be online ("You can't start new charges until you're back online"), and it redeems tokens online instead of checking DLEQ. README line: **"Numo needs the trader online. AlertProof works when the trader isn't."** Credit Numo in the README.

## The problem and the users

- **Primary user:** a market trader or kiosk owner with patchy data (fabric seller, phone accessories, food vendor). Nigeria first (fake credit alerts), Senegal and the rest of West Africa too (fake Wave and Orange Money screenshots). Pilot users: traders near the builder's school in Nigeria.
- **Second user:** POS agents, who hand over cash against transfers and are a main target of fake alerts. Same check, same app.
- **Today:** the customer pays by transfer or mobile money and shows a screen, or the trader waits for an SMS alert. Fake alert apps and edited screenshots cost traders their goods. On a bad network the real alert is late, so the trader either holds up the queue or trusts a screen.
- **With AlertProof:** one scan, a green screen, the amount spoken out loud and a buzz in under a second, no data on the trader's phone. A copied, edited or reused receipt turns red.
- **Reach estimate for the README:** source a real count of POS agents and informal traders (Nigeria, Senegal) before writing a number. No invented metrics.

## Talk to 5 real traders (before the UI is final)

Visit 5 traders or POS agents near school by Nov 17. Ask: how do you confirm a transfer today; have you or someone you know lost goods to a fake alert or screenshot; how much data do you buy a week and how often is it out; which phone do you use; would you accept a receipt you scan, if the money lands in your bank account at the end of the day. Show them the demo and watch where they hesitate. Write it up in docs/TRADERS.md: their words, with permission, no full names unless they agree. Use only what they actually said in the pitch.

## What it guarantees (exact wording for the README)

- If the customer's phone has data at the moment of payment, the trader's phone needs none: the payment is signed by the mint and locked so that only the trader can spend it. The customer can't take it back.
- If the trader's phone has data, it claims the payment on the spot.
- If neither phone has data, AlertProof can tell the payment is real but not that it hasn't been spent elsewhere. This mode is off by default and capped when on.
- The mint holds the bitcoin until the trader moves it out (custodial ecash). AlertProof sweeps to the trader's own Lightning address when online, so only the day's float sits at the mint.
- The result shows only on the trader's own phone. Nothing the customer shows on their screen counts.

## Flows (one PWA, two roles)

1. **Trader setup (online, once, first sale in under a minute):** shop name; a trusted mint is preselected (changeable); the key is created and backed up as a short recovery code to write down or print (the same secret as 12 words, which stay under Advanced); PIN; the app caches the mint's keysets and NUT-06 info and a BTC/NGN and BTC/XOF rate with its time. Optional: the trader's own Lightning address for cash-out.
2. **Ask for money (offline OK):** type ₦2,000 (or 2,000 CFA); the app converts with the cached rate (shows the rate's age) and shows a NUT-18 payment request QR: amount in sats, unit sat, trusted mint, NUT-10 P2PK lock to the trader's public key. Also a printable static sticker (shop name, key and mint, no amount).
3. **Pay (customer online), no Cashu wallet needed:** the customer opens the trader's request in a phone browser and pays a Lightning invoice from the wallet they already use (Bitnob, Wallet of Satoshi, Phoenix, Blink, or Wave through Banxaas). Once paid, the page mints ecash locked to the trader's key (cashu-ts mint option `p2pk: { pubkey }`) with DLEQ kept and shows it as a receipt QR (animated if large). Cashu wallets that support NUT-18 requests can also pay directly.
4. **Customer receipt:** the customer's page keeps the receipt (amount, shop name, time, the token) so both sides have proof in a dispute. If the trader loses an unclaimed payment, the customer's copy can still be claimed with the trader's recovery code.
5. **Check (trader offline):** the trader scans the receipt; offline checks below. Result fills the screen: green with the amount in big naira or CFA, a sound, a vibration, and the phone's built-in voice saying "Paid, two thousand naira" (or "Payé, deux mille francs"); red with the reason and "Not paid, don't release the goods". Sound, icon and vibration still work if the phone has no offline voice. For busy hands and traders who can't read well.
6. **Collect (trader online later):** one "Collect" button claims everything (swap with the trader's signature) and pays the total to the trader's own Lightning address (LNURL-pay, then melt). That address can be one that converts straight to naira in a bank account (for example Mavapay or Tapnob) or to CFA (Banxaas, Bitnob). We don't integrate those services' APIs; we only pay the trader's Lightning address. Auto-collect when the phone comes online, if the trader turns it on.
7. **End-of-day summary (offline):** sold, collected, still to collect; share as plain text to WhatsApp (no personal data).
8. **Top up (customer):** Lightning invoice from a mint quote, payable from any Lightning wallet.

## Add-on after the core works: NFC sticker

An NFC sticker on the stall (NTAG215, 504 bytes; NTAG213 also fits) holds the link to the trader's pay page (shop name, key and mint, no amount), with the same link printed as a QR on the sticker. The customer taps their phone on it and the pay page opens; they type the amount the trader tells them. iPhones (XS and later) and most Androids open NFC links without an app.

- Programmed once from AlertProof on Android Chrome with Web NFC ("Write my sticker"), then locked read-only. Web NFC is Android Chrome only, so iPhone traders use any NFC writer app or a pre-written sticker.
- Build only after the Go/No-Go passes and the core flows work. If time runs out, it goes in next steps.
- Not built: phone-to-phone NFC. A web page can't act as a tag (that needs a native Android app with card emulation, which Numo already does), and the sticker gives the same tap.

## Offline checks (pure functions, each with a failing test)

1. Token decodes; unit is sat; mint is on the trusted list.
2. Every keyset id belongs to the cached keysets of that mint; a key exists for every amount.
3. Every proof has a DLEQ and it verifies against the cached key for its amount.
4. Every secret is NUT-10 P2PK with data equal to the trader's public key; reject any `refund` tag, any `locktime` (after a locktime with no refund key anyone can spend), any extra `pubkeys`, `n_sigs` above 1.
5. The cached mint info lists NUT-11 (a mint without it may treat P2PK proofs as anyone-can-spend).
6. Total covers the requested amount; overpayment is shown. For sticker payments with no amount set, the big amount on screen is what the trader compares with the price.
7. Replay: Y = hash_to_curve(secret) not already in the local seen set; insert atomically.

## Threat model (first draft)

| Threat | Defence |
|---|---|
| Fake alert app or edited screenshot | Doesn't count: only the trader's own scan and check give a green result |
| Fake token from an attacker's own mint | Keyset and key must match the cached trusted mint; DLEQ check |
| Edited amount | Signature is per amount key; DLEQ fails |
| Screenshot replay of a real receipt | Seen set rejects a second scan |
| Customer keeps a way to take it back | Reject refund, locktime, extra keys, multisig |
| Mint ignores P2PK | Require NUT-11 in cached mint info |
| Swapped QR or rewritten NFC sticker | Money locked to someone else's key fails check 4, so the trader sees red and keeps the goods; sticker locked read-only; pay page shows the shop name |
| Stolen trader phone | Key encrypted at rest with a PIN (WebCrypto AES-GCM, PBKDF2); recovery code on paper; unclaimed proofs live only on the phone (and the customer's receipt), so collect as soon as online |
| Malicious script | Static site, strict CSP, no third-party scripts, no analytics, no cookies |
| Mint failure or theft | Trusted mint choice, sweep to own Lightning address, small float, stated plainly |
| PII | No accounts, no phone numbers, no server of our own, nothing logged |

## What we skip, and why

- **USSD:** a separate product with its own server and gateway; it adds build risk and doesn't strengthen the core claim.
- **Phone-to-phone NFC:** needs a native Android app (see the NFC add-on).
- **AI features:** five generic AI entries are already in the field, and AI adds nothing to the core. The spoken result uses the phone's built-in voice.

## Stack

Static PWA on Vercel, no backend. Vite with plain TypeScript (no framework unless it stays under budget). @cashu/cashu-ts (uses audited @noble libraries), @scure/bip39, a small QR encoder, native BarcodeDetector with a lazy-loaded fallback for iOS, Web Speech (speechSynthesis) and Vibration APIs, Web NFC for the sticker, IndexedDB, a hand-written service worker. Node's built-in test runner with native TypeScript for unit tests (no test framework to install), Playwright for end-to-end with the browser set offline. GitHub Actions for CI and deploy.

## Low-bandwidth budget (measured, published in the README)

- First load: 60 KB gzipped or less (stretch 40 KB); repeat loads from cache. Measure on day one. If cashu-ts alone breaks it, split the trader check from the customer pay code (lazy-loaded) and publish the real numbers.
- Trader check: 0 bytes, proven by an end-to-end test run with the network switched off.
- Customer payment: measure and publish the bytes and the naira/CFA data cost.
- Lighthouse mobile run and a throttled 3G/2G timing in CI.

## Demo mode

Test mint with fake sats (nofees.testnut.cashu.space). "Get 5,000 test sats" in one tap. Trader and Customer tabs side by side; a clearly labelled "network off" switch that makes the app refuse all requests, plus the real airplane-mode film. Real-money proof on a mainnet mint with two phones, transaction details in the README.

## One command

`npm run verify` prints PASS or FAIL: adversarial unit tests, offline end-to-end check, bundle-size budget.

## 60-second film (write before code)

1. 0 to 8 s, text: "Fake alerts cost traders their goods. Bad network makes it worse."
2. 8 to 15 s: trader's phone, airplane mode on; types ₦2,000; QR appears.
3. 15 to 25 s: customer scans, pays from their Lightning wallet; receipt QR.
4. 25 to 32 s: trader scans: green, the phone says "Paid, two thousand naira" and buzzes. "Checked with no internet."
5. 32 to 42 s: same QR again: red "Already received". Edited receipt: red "Not signed by your mint".
6. 42 to 52 s: data on: Collect, then paid out to the trader's Lightning address.
7. 52 to 60 s: end card "AlertProof. Payments a fake alert can't fake." and the demo link.

The 3-minute pitch adds the problem with sourced numbers, what the 5 traders said, how it works (diagram), security, bandwidth numbers, the Numo comparison, and next steps (pilot traders, NFC sticker if not shipped, CFA and mobile-money cash-out, upstream contribution).

## Go/No-Go Script (first thing built, decide by end of Nov 12)

One command, on the test mint: mint test sats; make a payment request locked to a trader key; pay it with DLEQ kept; verify it with the network switched off; reject a second scan of the same token, a token from another mint, an edited amount, and a token with a refund path; print PASS or FAIL.

## Build order

1. Offline verifier and its adversarial tests, written as a standalone module (src/verify/) so it can go upstream; five review passes with different purposes.
2. Wallet flows on the test mint; deploy to a public URL on day one.
3. Result screen (sound, vibration, voice, big amount), customer receipt, Collect and end-of-day summary.
4. Privacy and security passes (static analysis, manual review, adversarial scenarios, fuzzing the verifier, independent review); publish in docs/SECURITY.md.
5. README (backbone): for-judges line and a picture at the top, Try it in 30 seconds, proof, what works today, constraints, metrics, Numo credit, AI-written-code disclosure, libraries with versions, day-by-day build log.
6. UI rules: no purple gradients, no pill buttons, no fake reviews or metrics, no emoji icons, no em dashes, no vague hero text.
7. Trader visits, real-money two-phone proof, friends and traders test, NFC sticker if time, film, submit once.

## Upstream contribution

Offer the offline-check module to Cashu: a PR or example for cashu-ts, and a comment on CDK issue #1927 (offline receive) linking our tests. Btrust exists to grow open-source Bitcoin developers, so a real upstream PR speaks to these judges.

## Stretch

French UI polish by a native speaker; a standard Nostr "pay me" profile for the trader (NIP-61: trusted mint and lock key) so Nostr wallets can pay too.
