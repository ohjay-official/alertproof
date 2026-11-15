# Sealpay

**Payments a fake alert can't fake.** Traders confirm Bitcoin payments in one scan, even with no data.

Built for Dakar Bitcoin Hack 2026. Work in progress: the plan is in [docs/SPEC.md](docs/SPEC.md) and the background research in [docs/RESEARCH.md](docs/RESEARCH.md).

## Status (Nov 15)

The core claim passed its Go/No-Go on a real Cashu mint ([testnut.cashu.space](https://testnut.cashu.space), fake sats): 21 of 21 steps, run by CI on every push, using the app's own pay, collect and cash-out code.

| Part | State |
|---|---|
| Offline check, rule layer ([src/verify](src/verify)) | built; 64 tests incl. 3,000-run fuzzing; independent review done ([docs/SECURITY.md](docs/SECURITY.md)) |
| Curve layer (hash_to_curve, DLEQ) on @noble/curves | built; passes the official Cashu NUT-00 and NUT-12 test vectors |
| Trader's mint cache and cashuB receipt decoding ([src/wallet](src/wallet)) | built; used by the Go/No-Go |
| Customer pays, trader collects and cashes out ([src/wallet](src/wallet)) | built; tested end to end against an in-memory mint with real curve math, and on the test mint |
| Trader's key, recovery code, PIN lock, pay link, rates, animated receipt QR frames | built and tested |
| Go/No-Go on the test mint ([scripts/go-no-go.ts](scripts/go-no-go.ts)) | GO, 21/21 |
| App (trader and customer screens) | designed ([docs/design](docs/design)); being built |

What the Go/No-Go shows, in order: the customer gets mint-signed ecash locked to the trader's key; the receipt survives a cashuB encode and decode with its DLEQ proofs; the trader's check is green **with the network switched off** and makes no request; a second scan says "Already received"; a genuine part payment is kept, and showing it again for a bigger price is "Already received", never "short by"; a relabelled mint, an edited amount, a token signed by an attacker's own mint, a receipt locked to someone else and a real token with a refund path are all refused; online, the mint itself refuses the customer's attempts to spend the locked payment, the trader collects the full price with their signature, and cashes 1,000 sats out to a Lightning invoice, keeping the change.

Numbers from that run (a GitHub runner, not a phone yet): the offline check took 77 ms; a 1,333 sat price (1,334 paid, so the mint's 1 sat fee is covered) was 6 proofs and 2,368 characters as cashuB; the trader's cache was 5.4 KB.

Check it yourself (Node 22.18 or later):

```sh
npm ci
npm run verify      # types, tests, curve vectors, and the Go/No-Go on the test mint; prints PASS or FAIL
```

All code is written with AI (Claude). Day by day: [docs/BUILD_LOG.md](docs/BUILD_LOG.md).
