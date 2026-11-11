# Offline receipt check

Checks a Cashu payment on a phone with no data, against what the phone cached while it was online once: the trader's own key, the mint's info (NUT-06) and its keysets (NUT-01, NUT-02). Written as a standalone module so it can go upstream to Cashu.

```ts
import { acceptReceipt, MemorySeenStore } from './index.ts';
import { nobleCurve } from './curve-noble.ts';

const verdict = await acceptReceipt(decodedToken, traderContext, { requestedSats: 1333 }, nobleCurve, store);
// { ok: true, totalSats, overpaidSats, feeSats, ... } or { ok: false, code: 'bad_signature', ... }
```

## What a green result means

Every proof in the receipt:

1. comes from a mint the trader chose, which lists NUT-11 and NUT-12 in its cached info
2. names a keyset and amount key in the trader's cache, unit `sat`
3. is locked to the trader's key with no way back for the payer (below)
4. carries a DLEQ proof (NUT-12) that verifies against the cached key for its amount, so the mint really signed this secret for this amount
5. was not seen on this phone before, and appears only once in the receipt

and the total covers the amount asked for. Signatures are checked before the amount, so "less than you asked for" is only ever said about a genuine receipt.

What it can't know offline: whether the trader's own key already spent the proofs elsewhere. Only the trader can spend them, so for a single phone the replay list covers this.

## The only lock accepted

```json
["P2PK", {"nonce": "<non-empty>", "data": "<trader's key, lowercase compressed hex>", "tags": [["sigflag", "SIG_INPUTS"]]}]
```

`tags` may also be empty or left out. Refused, with the reason:

| In the lock | Code | Why |
|---|---|---|
| no lock (plain secret), another key, another kind | `not_locked_to_you` | whoever holds it, or someone else, can spend it |
| `locktime`, `refund`, `n_sigs_refund` | `can_be_taken_back` | after the locktime the payer, or anyone, can spend it (NUT-11) |
| `pubkeys`, `n_sigs` | `shared_lock` | other keys could sign, or the trader alone couldn't |
| `sigflag` other than `SIG_INPUTS`, a repeated tag, an unknown tag | `unsupported_lock` | NUT-11 makes duplicate tags unspendable; unknown tags have no defined meaning |

## Reading the secret the same way the mint does

NUT-10 says a secret the mint can't parse is treated as a plain secret, and a plain secret can be spent by whoever holds it. So if the phone and the mint read one secret differently, the phone could see a lock to the trader while the mint sees none. The secret is read with a deliberately narrow parser (`strict-json.ts`) that refuses anything two common JSON parsers might disagree on: duplicate keys, any backslash escape, anything outside printable ASCII, numbers, booleans, null, trailing commas, deep nesting. Real secrets from cashu-ts, cdk and nutshell fit easily.

## Files

| File | What |
|---|---|
| `check.ts` | `checkReceipt` (pure) and `acceptReceipt` (check, then record atomically) |
| `lock.ts` | the lock rules above |
| `strict-json.ts` | the narrow parser |
| `mint-url.ts` | https only, normalized before comparing |
| `seen.ts` | the replay store contract, and an in-memory store |
| `curve-noble.ts` | hash_to_curve (NUT-00) and DLEQ (NUT-12) on @noble/curves |
| `reasons.ts` | one plain line per refusal for the trader |

The rule layer has no dependencies; curve operations are passed in (`CurveOps`). Tests: `npm test` (all, needs the packages) or `npm run test:rules` (rule layer only, plain Node 22.18+).
