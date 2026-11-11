# AlertProof

**Payments a fake alert can't fake.** Traders confirm Bitcoin payments in one scan, even with no data.

Built for Dakar Bitcoin Hack 2026. Work in progress: the plan is in [docs/SPEC.md](docs/SPEC.md) and the background research in [docs/RESEARCH.md](docs/RESEARCH.md).

## Status (Nov 11)

The core claim passed its Go/No-Go on a real Cashu mint ([testnut.cashu.space](https://testnut.cashu.space), fake sats): 18 of 18 steps, run by CI on every push.

| Part | State |
|---|---|
| Offline check, rule layer ([src/verify](src/verify)) | built; 58 tests incl. 3,000-run fuzzing |
| Curve layer (hash_to_curve, DLEQ) on @noble/curves | built; passes the official Cashu NUT-00 and NUT-12 test vectors |
| Go/No-Go on the test mint ([scripts/go-no-go.ts](scripts/go-no-go.ts)) | GO, 18/18 |
| App (trader and customer screens) | not started |

What the Go/No-Go shows, in order: the customer gets mint-signed ecash locked to the trader's key; the receipt survives a cashuB encode and decode through cashu-ts with its DLEQ proofs; the trader's check is green **with the network switched off** and makes no request; a second scan says "Already received"; a relabelled mint, an edited amount, a token signed by an attacker's own mint, a receipt locked to someone else and a real token with a refund path are all refused; online, the mint itself refuses the customer's attempts to spend the locked payment, and accepts the trader's signature when the trader collects.

First numbers from that run (a GitHub runner, not a phone yet): the offline check took 48 ms; a 1,333 sat receipt was 6 proofs and 2,896 characters as cashuB; the trader's cache was 5.4 KB.

Check it yourself (Node 22.18 or later):

```sh
npm ci
npm run verify      # types, tests, curve vectors, and the Go/No-Go on the test mint; prints PASS or FAIL
```

All code is written with AI (Claude). Day by day: [docs/BUILD_LOG.md](docs/BUILD_LOG.md).
