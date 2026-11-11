# AlertProof

**Payments a fake alert can't fake.** Traders confirm Bitcoin payments in one scan, even with no data.

Built for Dakar Bitcoin Hack 2026. Work in progress: the plan is in [docs/SPEC.md](docs/SPEC.md) and the background research in [docs/RESEARCH.md](docs/RESEARCH.md).

## Status (Nov 11)

| Part | State |
|---|---|
| Offline check, rule layer ([src/verify](src/verify)) | built, 58 tests incl. fuzzing |
| Curve layer (hash_to_curve, DLEQ) on @noble/curves | built; its tests use the official Cashu vectors and run in CI |
| Go/No-Go on the Cashu test mint ([scripts/go-no-go.ts](scripts/go-no-go.ts)) | built, runs in CI |
| App (trader and customer screens) | not started |

Check it yourself (Node 22.18 or later):

```sh
npm install
npm run verify      # types, tests, curve vectors, and the Go/No-Go on the test mint; prints PASS or FAIL
```

All code is written with AI (Claude). Day by day: [docs/BUILD_LOG.md](docs/BUILD_LOG.md).
