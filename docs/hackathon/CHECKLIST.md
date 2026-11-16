# Sealpay: everything left, Nov 16 to submission

Deadline: **Nov 20, 21:00 Lagos.** We submit by **Nov 20 midday**, never at the wire. Owner: **Claude**, **Oh-Jay**, or **Grokbot** (Oh-Jay's agent). Tick items here as they finish; the runsheet keeps the decisions.

## Already done

- [x] Idea, research, spec (Nov 11)
- [x] Offline check, 5 review passes, independent review, Go/No-Go on the real test mint (Nov 11)
- [x] Money logic: pay, collect, cash out, keys, recovery code, PIN lock, pay link, rates, QR frames; 114 tests; Go/No-Go 21/21 (Nov 15)
- [x] Static analysis: CodeQL and npm audit, clean (Nov 15)
- [x] Screen mockup (Nov 15)
- [x] Renamed to Sealpay, repo ohjay-official/sealpay (Nov 16)
- [x] Live link: https://sealpay-beta.vercel.app (Nov 16)

## 1. Calls only Oh-Jay can make (Nov 16 morning)

- [ ] **Oh-Jay**: OK the screen look, or say what to change
- [ ] **Oh-Jay**: confirm you're registered on Devpost and your student ID is ready (students only)
- [ ] **Oh-Jay**: pick the 5 traders or POS agents near school and when you'll visit (by Nov 17 evening)
- [ ] **Oh-Jay**: yes or no to a small real-money test (about ₦2,000 of real bitcoin, two phones), and which Lightning wallet you'll pay from
- [ ] **Oh-Jay**: yes or no to the NFC sticker (needs NTAG215 stickers bought; otherwise it goes in next steps)
- [ ] **Oh-Jay**: the music for the film (real track, cleared to use)

## 2. Build the app (Nov 16 to 17), Claude

- [ ] Build step in CI (esbuild), app code in `web/src`, deploy the built app instead of the placeholder
- [ ] Open the site's security rules (CSP) only to the test mint, the real mint and the price service
- [ ] QR drawing, and QR scanning (phone's built-in scanner, with a backup loaded only on iPhones)
- [ ] Trader setup: shop name, naira or CFA, mint picked for them, key made, recovery code shown and confirmed, PIN
- [ ] Trader setup saves the mint's keys and today's rate for offline use
- [ ] Price screen: POS-style keypad, naira to sats, rate age shown
- [ ] Pay code screen: QR of the pay link, shop name, amount
- [ ] Scan screen: camera, collects the animated receipt QR, shows progress
- [ ] Verdict screens: green Paid, red Not paid, red Already used, amber Part paid; phone speaks it, buzzes and beeps
- [ ] Saved sales on the phone (replay list and payments saved together, storage kept from being wiped)
- [ ] Sales list and end-of-day summary, shared as plain text to WhatsApp
- [ ] Collect button (asks the PIN) and Cash out to a Lightning invoice
- [ ] Restore a trader from the recovery code
- [ ] Customer pay page: shop and amount, Lightning invoice QR, Open wallet, Copy invoice, waits for payment
- [ ] Customer receipt: animated QR, saved on their phone, survives a page reload
- [ ] Demo mode for judges: one tap makes a test trader on fake sats, pays itself, and hands the receipt to the trader side, with a clear "network off" switch
- [ ] Works as an app: install to home screen, opens with no data after the first visit
- [ ] French for the verdict and the spoken result (Senegal judges)
- [ ] **CHECK IN**: Oh-Jay opens the live app on his phone and tries it

## 3. Prove it works (Nov 17 to 18)

- [ ] **Claude**: browser test in CI of the whole journey on the test mint, trader's network off, screenshots saved
- [ ] **Claude**: measure first-load size (budget 60 KB), data cost per payment in naira, and a slow-3G load time, in CI
- [ ] **Claude**: one command, `npm run verify`, prints PASS or FAIL for everything, including the above
- [ ] **Oh-Jay**: test on your Android and your iPhone, send screenshots of anything odd
- [ ] **Oh-Jay**: 2 or 3 friends try it; **Claude** fixes what they hit
- [ ] **Oh-Jay**: visit 5 traders or POS agents, ask the 5 questions in the spec, show the demo, voice-note or photo your notes; **Claude** writes them up as docs/TRADERS.md (their words, with permission, no full names)
- [ ] **Claude**: find a real mint that supports locks, offline proofs and browser calls, for the real-money test
- [ ] **Oh-Jay** (with **Claude** guiding): real-money test with two phones, about ₦2,000; **Claude** records it in the README with no personal wallet address
- [ ] **Claude**: second independent review of the app by a fresh agent, and the privacy pass (no personal data, no cookies, no outside scripts); results in docs/SECURITY.md
- [ ] **Claude**: fix everything the tests, visits and reviews find

## 4. Website launch checklist (Nov 18), Claude

- [ ] Custom 404, main button above the fold
- [ ] Title and description on every page, share image (Open Graph and Twitter card)
- [ ] Icon set: tab, Apple, 192, 512, app manifest
- [ ] robots.txt, sitemap.xml, canonical links, structured data on the home page
- [ ] Alt text on every image, loading states on buttons ("Paying…"), keyboard focus, works on small phones
- [ ] Privacy and terms pages; the privacy page says there are no cookies
- [ ] CI checks every page of the live site after each deploy (the no-cookie check already runs)
- [ ] **CHECK IN**: Oh-Jay opens the live site on his phone

## 5. README and docs (Nov 18), Claude

- [ ] README rewritten: one-line pitch, a picture of it working, a one-line path for judges, quick links, "Try it in 30 seconds"
- [ ] Proof it's real: tests, Go/No-Go, real-money test, trader visits, measured numbers
- [ ] What's new here, how it compares with Numo (credit it), how it works, architecture diagram (judges ask for one)
- [ ] Judging criteria table: each criterion and where to check it
- [ ] Reach estimate from sourced numbers (POS agents, market traders), never invented
- [ ] "What works today" table that admits what isn't finished; constraints; next steps
- [ ] Built during the event: first commit date, written with AI (Claude), every library with its version, day-by-day build log
- [ ] LICENSE file (MIT)
- [ ] **CHECK IN**: Oh-Jay reads the top of the README
- [ ] Judge simulation: a fresh agent follows the README against the repo and the live site and lists every claim that doesn't match; fix every one

## 6. Film and pitch (Nov 18 to 19)

- [ ] **Claude**: update the 60-second film script with the Sealpay name and today's real rate; **Oh-Jay** OKs it
- [ ] **Claude**: shot list with numbered steps for recording on your phone; **Oh-Jay** records the clips (airplane mode on the trader phone)
- [ ] **Claude**: backup film first (Nov 18), final cut after (Nov 19): text intro, the app working within 10 seconds, real screens only, cuts on the beat, your music
- [ ] **Oh-Jay**: watch the final cut and approve
- [ ] **Claude**: the presentation the rules ask for (3 minutes: problem, solution, impact, next steps, with the traders' words and the numbers); **Oh-Jay** approves

## 7. Submit (Nov 19 to 20)

- [ ] **Claude**: re-read the rules page and every submission field (Nov 18)
- [ ] **Claude**: fill docs/hackathon/submission-draft.md with an answer for every field
- [ ] **Oh-Jay**: check the prize payout details are your own wallet or Lightning address, never the project's
- [ ] Freeze Nov 19 evening: fixes only after that
- [ ] **Claude**: Nov 20 morning, retest the whole journey from a fresh browser; README, film and live app all match
- [ ] **Oh-Jay** (or Grokbot, with the final click yours): submit once, by Nov 20 midday
- [ ] **Claude**: draft the X post in your style (problem first, one moment, film, links, a real question); **Oh-Jay** posts it

## 8. After submitting

- [ ] Keep the live app up through judging and a week after; watch for the test mint resetting
- [ ] Offer the offline check upstream: a pull request or example for cashu-ts, and a comment on CDK issue #1927
- [ ] Per-sale lock keys (the one open medium finding), the NFC sticker if it wasn't built
- [ ] Follow up with Btrust and the judges; keep any judge feedback in the runsheet
