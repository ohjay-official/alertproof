# Runsheet: AlertProof at Dakar Bitcoin Hack 2026

Read this first in every session, then the plan in [docs/SPEC.md](../SPEC.md). Update and push it before ending.

## Event

- Event: Dakar Bitcoin Hack 2026 by Btrust, https://dakar-bitcoin-hack-2026.devpost.com/ (rules: /rules, gallery: /project-gallery)
- Closes **Nov 20, 2026, 21:00 Lagos (20:00 UTC)**. Submit by Nov 20 midday, never at the wire.
- Students only, must reside in Africa, solo allowed (confirmed Nov 11). 1st prize $500 in BTC.
- Required: presentation (text or video), public GitHub repo, MVP online or a demo video, a Bitcoin/Lightning wallet implementation.

## Checkpoints (Lagos time)

| By | What | Status |
|---|---|---|
| Nov 11 | Idea locked, repo, spec, research | done |
| Nov 12 end | Core verifier solid, Go/No-Go passes on the test mint | in progress |
| Nov 12 | Live URL (placeholder is fine) | waiting on VERCEL_TOKEN |
| Nov 16 to 19 | App, trader visits (5 by Nov 17), real-money proof, README, film | not started |
| Nov 19 | Everything frozen except fixes | |
| Nov 20 midday | Submit once | |

## Decisions

- Nov 11: AlertProof chosen (Cashu ecash locked to the trader's key, checked offline with DLEQ). Name chosen for being clear to anyone.
- Nov 11: NFC sticker only after the core works. USSD and AI skipped.
- Nov 11: Tests use Node's built-in runner with native TypeScript (zero dev dependencies for the rule layer); Vitest dropped from the stack.
- Nov 11: Only one lock shape is accepted (P2PK to the trader, sigflag SIG_INPUTS or none). Secrets are read with a narrow parser so the phone and the mint can't read one secret two ways. Signatures are checked before the amount.
- Nov 11: The Go/No-Go talks to the mint over its plain REST API with blinding on @noble/curves, and round-trips the receipt through cashu-ts (cashuB).

## HIS CALL (open)

- Add `VERCEL_TOKEN` to this repo's GitHub secrets for the live URL (steps in the session summary; never paste it in chat).
- Optional: allow package installs in Claude's network settings, so future chats can run everything locally too.

## Gate log

- Nov 11: confirmed solo entries are allowed; chose AlertProof; created the public repo ohjay-official/alertproof.

## Session capabilities (Nov 11, session 2)

- Push to GitHub: yes. Package installs: **blocked**. Test mint from the workspace: **blocked**. GitHub CLI: no valid token.
- So CI is the laptop: `.github/workflows/verify.yml` installs, runs types, tests, curve vectors and the Go/No-Go, and publishes logs to the `verify-results` branch. Read them with `git fetch origin verify-results`.
- Locally, `npm run test:rules` runs the rule layer with plain Node.

## Next step

Read `verify-results`. If the Go/No-Go is green, commit the lockfile from it, then start build order step 2 (wallet flows on the test mint, deploy to a public URL).
