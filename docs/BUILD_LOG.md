# Build log

All code in this repo is written with AI (Claude), directed and reviewed by the builder. Times are Lagos.

## Nov 11, 2026

- Researched the event, judges, last year's winners and this year's field; chose AlertProof. Plan and research pushed as docs/SPEC.md and docs/RESEARCH.md.
- Offline verifier rule layer (src/verify): strict secret parser, lock rules (only P2PK to the trader with no locktime, refund, extra keys or unknown tags), trusted mint and keyset checks, DLEQ through injected curve operations, signatures before amount, atomic replay store.
- 58 rule-layer tests: every refusal, parser differential cases (duplicate keys, escapes, non-ASCII), 3,000-run seeded fuzzing of genuine receipts and of locks. Each rule was broken on purpose once to confirm a test catches it (20 of 20 caught after one test was added).
- Curve layer on @noble/curves with the official Cashu NUT-00 and NUT-12 test vectors.
- Go/No-Go script for the real test mint, and a CI workflow that runs everything and publishes logs to the verify-results branch.
- CI: 65 of 65 tests pass, including the official NUT-00 and NUT-12 vectors. Go/No-Go: 18 of 18 on testnut.cashu.space (GO). Fixed on the way: nofees.testnut.cashu.space no longer resolves (switched to testnut), and cashu-ts v4's `getDecodedToken` wants full keyset ids.
- Lockfile pinned from CI.
