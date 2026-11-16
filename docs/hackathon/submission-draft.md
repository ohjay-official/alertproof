# Devpost submission draft

Every field the form asks for, answered. Lines marked TBD-post-build are filled once the film, the trader visits and the real-money run exist. Grokbot can list the form's exact fields now that you're registered.

**Project name:** Sealpay

**Elevator pitch (short):** Payments a fake alert can't fake: traders scan the customer's receipt and their own phone says Paid or Not paid, even with no data.

**Try it out:** https://sealpay-beta.vercel.app/app#demo (demo on fake sats), https://github.com/ohjay-official/sealpay

**Video:** TBD-post-build: film link (YouTube, unlisted first)

**Built with:** bitcoin, lightning, cashu, ecash, typescript, noble-curves, pwa, service-worker, indexeddb, github-actions, vercel, playwright

## About the project

### Inspiration
In Nigerian markets a "credit alert" on the customer's phone is how a sale is closed, and fake alert apps and edited screenshots cost traders their goods. In a Punch survey of 330 traders in four Lagos markets, 52% had seen a fake alert. On a bad network even the real alert comes late, so the trader holds up the queue or trusts a screen.

### What it does
The trader types the price and shows a pay code. The customer pays from any Lightning wallet and gets a receipt. The trader scans it, and their own phone checks it with no internet: green **Paid** with the amount, a buzz and a spoken "Paid, 2000 naira", or red **Not paid** / **Already used**. Later, online, the trader collects and cashes out to their own Lightning wallet.

### How we built it
The receipt is Cashu ecash: the mint signs it with a proof anyone can check offline (NUT-12 DLEQ) and it is locked to the trader's key (NUT-11 P2PK), so the customer can't take it back. The trader's phone saves the mint's keys once and checks every receipt against them. A static web app (no server of our own), the cryptography on the audited @noble libraries, our own strict receipt reader to keep the app at 46.5 KB, and CI that runs the whole demo in a real browser on the public test mint on every change.

### Challenges we ran into
Lightning can't pay a phone that's offline, so the design moved the "trust" from the network to a signature the phone can check. Receipts of several proofs are too dense for one QR on a cheap camera, so the receipt QR plays as an animation. Building from a phone, with CI as the laptop.

### Accomplishments that we're proud of
The check makes zero network requests and takes 15 to 80 ms. A customer's whole payment uses about 46 KB of data. The app opens with no data after the first visit. 123 tests, a real-mint run of 21 steps, and two independent reviews with every finding fixed.

### What we learned
TBD-post-build: what the traders said, in their words.

### What's next for Sealpay
A pilot with traders near school, cash-out that lands in naira or CFA, an NFC sticker for tap-to-pay, per-sale keys, and offering the offline check upstream to Cashu (CDK issue #1927).

## Checks before submitting

- [ ] Every link opens; the film is public or unlisted as the rules allow
- [ ] The README, film, live app and this text say the same thing
- [ ] The prize payout goes to Oh-Jay's own wallet or Lightning address, never a project address
- [ ] Submit once, by Nov 20 midday Lagos
