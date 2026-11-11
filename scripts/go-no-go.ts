/**
 * Go/No-Go: AlertProof's core claim, end to end, on a real Cashu test mint
 * (fake sats, no real money).
 *
 *   node scripts/go-no-go.ts            (MINT_URL=... to use another test mint)
 *
 * The customer side talks to the mint over its plain REST API (NUT-01/02/03/
 * 04/06/07), with blinding done here on @noble/curves, so every byte is
 * visible. The trader side is the app's real offline check (src/verify).
 * Prints PASS or FAIL per step, then GO or NO-GO, and writes go-no-go.json.
 */
import { writeFile } from 'node:fs/promises';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  acceptReceipt,
  checkReceipt,
  MemorySeenStore,
  type CachedKeyset,
  type Proof,
  type TraderContext,
  type Verdict,
} from '../src/verify/index.ts';
import {
  G,
  N,
  Point,
  bytesToHex,
  hashE,
  hashToCurveBytes,
  hexToBytes,
  nobleCurve,
  scalarToHex,
  verifyBlindDleq,
} from '../src/verify/curve-noble.ts';

const MINT = (process.env.MINT_URL ?? 'https://nofees.testnut.cashu.space').replace(/\/+$/, '');
const PRICE_SATS = 1333; // about NGN 2,000 in the demo story
const utf8 = (s: string) => new TextEncoder().encode(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- reporting

type Step = { step: string; pass: boolean; note: string };
const steps: Step[] = [];
const info: Record<string, unknown> = { mint: MINT, startedAt: new Date().toISOString() };

function record(step: string, pass: boolean, note = ''): boolean {
  steps.push({ step, pass, note });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step}${note ? `  (${note})` : ''}`);
  return pass;
}

function expectRefused(step: string, v: Verdict, code: string): boolean {
  if (v.ok) return record(step, false, 'was accepted');
  return record(step, v.code === code, v.code === code ? code : `got ${v.code}: ${v.detail}`);
}

// ---------------------------------------------------------------- network switch

const realFetch = globalThis.fetch;
let blockedRequests = 0;
function networkOff(): void {
  globalThis.fetch = (async () => {
    blockedRequests++;
    throw new Error('network is off');
  }) as typeof fetch;
}
function networkOn(): void {
  globalThis.fetch = realFetch;
}

// ---------------------------------------------------------------- mint REST

async function api(path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const init: RequestInit =
    body === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(MINT + path, init);
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

function randomScalar(): bigint {
  for (;;) {
    const v = BigInt('0x' + bytesToHex(crypto.getRandomValues(new Uint8Array(32))));
    if (v > 0n && v < N) return v;
  }
}
const randomHex32 = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

function split(total: number): number[] {
  const out: number[] = [];
  for (let bit = 1; bit <= total; bit *= 2) if (total & bit) out.push(bit);
  return out;
}

type Output = { amount: number; id: string; B_: string; secret: string; r: bigint };
type BlindSig = { amount: number; id: string; C_: string; dleq?: { e: string; s: string } };

function blind(amount: number, id: string, secret: string): Output {
  const r = randomScalar();
  const B_ = hashToCurveBytes(utf8(secret)).add(G.multiply(r));
  return { amount, id, B_: B_.toHex(true), secret, r };
}

/** Unblind, after checking the mint's own DLEQ (NUT-12: wallets MUST). */
function unblind(sig: BlindSig, out: Output, A: string): Proof {
  if (!sig.dleq) throw new Error('mint returned no DLEQ');
  const Ap = Point.fromHex(A);
  const C_ = Point.fromHex(sig.C_);
  if (!verifyBlindDleq(Point.fromHex(out.B_), C_, sig.dleq.e, sig.dleq.s, Ap)) {
    throw new Error("the mint's DLEQ did not verify");
  }
  const C = C_.subtract(Ap.multiply(out.r));
  return {
    id: out.id,
    amount: out.amount,
    secret: out.secret,
    C: C.toHex(true),
    dleq: { e: sig.dleq.e, s: sig.dleq.s, r: scalarToHex(out.r) },
  };
}

const outputsBody = (outs: Output[]) => outs.map(({ amount, id, B_ }) => ({ amount, id, B_ }));
const asInput = (p: Proof, witness?: string) => ({
  id: p.id,
  amount: p.amount,
  secret: p.secret,
  C: p.C,
  ...(witness ? { witness } : {}),
});

function lockedSecret(pubkey: string, tags: string[][] = [['sigflag', 'SIG_INPUTS']]): string {
  return JSON.stringify(['P2PK', { nonce: randomHex32(), data: pubkey, tags }]);
}

async function mintProofs(ks: CachedKeyset, amount: number, secretFor: () => string): Promise<Proof[]> {
  const q = await api('/v1/mint/quote/bolt11', { amount, unit: 'sat' });
  if (q.status !== 200 || !q.json.quote) throw new Error(`mint quote: ${q.status} ${JSON.stringify(q.json)}`);
  // The test mint pays its own invoices. Wait until it says so.
  for (let i = 0; ; i++) {
    const s = await api(`/v1/mint/quote/bolt11/${q.json.quote}`);
    if (s.json.state === 'PAID' || s.json.paid === true) break;
    if (i >= 30) throw new Error(`quote never paid: ${JSON.stringify(s.json)}`);
    await sleep(1000);
  }
  const outs = split(amount).map((a) => blind(a, ks.id, secretFor()));
  const m = await api('/v1/mint/bolt11', { quote: q.json.quote, outputs: outputsBody(outs) });
  if (m.status !== 200) throw new Error(`mint: ${m.status} ${JSON.stringify(m.json)}`);
  return (m.json.signatures as BlindSig[]).map((sig, n) => unblind(sig, outs[n]!, ks.keys[String(outs[n]!.amount)]!));
}

/** A mint the attacker runs: same keyset id as the real one, the attacker's own key. */
function attackerSign(B_hex: string, a: bigint): BlindSig & { A: string } {
  const A = G.multiply(a);
  const B_ = Point.fromHex(B_hex);
  const C_ = B_.multiply(a);
  const p = randomScalar();
  const e = hashE([G.multiply(p), B_.multiply(p), A, C_]);
  const s = (p + BigInt('0x' + e) * a) % N;
  return { amount: 0, id: '', C_: C_.toHex(true), dleq: { e, s: scalarToHex(s) }, A: A.toHex(true) };
}

// ---------------------------------------------------------------- the run

async function main(): Promise<void> {
  console.log(`AlertProof Go/No-Go on ${MINT}\n`);

  // 1. Trader setup, online once: mint info, keys, the trader's key.
  const mintInfo = await api('/v1/info');
  const nuts = mintInfo.json?.nuts ?? {};
  info.mintVersion = mintInfo.json?.version;
  record(
    'mint supports P2PK locks (NUT-11) and offline proofs (NUT-12)',
    nuts['11']?.supported === true && nuts['12']?.supported === true,
    `version ${String(mintInfo.json?.version)}`,
  );
  const keysets = await api('/v1/keysets');
  const active = (keysets.json.keysets as any[]).find((k) => k.unit === 'sat' && k.active);
  if (!active) throw new Error('no active sat keyset');
  const keys = await api(`/v1/keys/${active.id}`);
  const ks: CachedKeyset = {
    id: active.id,
    unit: 'sat',
    keys: keys.json.keysets[0].keys,
    input_fee_ppk: active.input_fee_ppk ?? 0,
  };
  info.keysetId = ks.id;
  info.inputFeePpk = ks.input_fee_ppk;

  const traderSecret = randomScalar();
  const traderPub = G.multiply(traderSecret).toHex(true);
  const ctx: TraderContext = {
    traderPubkey: traderPub,
    mints: [{ url: MINT, info: { nuts }, keysets: [ks] }],
  };
  info.cacheBytes = JSON.stringify(ctx).length;

  // 2. Customer pays: mints ecash locked to the trader's key, keeping the DLEQ.
  const proofs = await mintProofs(ks, PRICE_SATS, () => lockedSecret(traderPub));
  const token = { mint: MINT, unit: 'sat', proofs };
  record('customer gets mint-signed ecash locked to the trader', proofs.length > 0, `${proofs.length} proofs, ${PRICE_SATS} sats`);

  // 3. cashuB round trip through cashu-ts, the library the app will use.
  let receipt: unknown = token;
  try {
    const ts: any = await import('@cashu/cashu-ts');
    const encode = ts.getEncodedTokenV4 ?? ((t: unknown) => ts.getEncodedToken(t, { version: 4 }));
    const encoded: string = encode({ mint: MINT, unit: 'sat', proofs });
    const decoded = ts.getDecodedToken(encoded, [{ id: ks.id, unit: 'sat', active: true, input_fee_ppk: 0 }]);
    const keptDleq = (decoded.proofs as any[]).every((p) => p.dleq && p.dleq.r);
    info.receiptChars = encoded.length;
    info.receiptPrefix = encoded.slice(0, 6);
    record('receipt survives cashuB encode/decode with DLEQ kept', keptDleq, `${encoded.length} characters`);
    receipt = decoded;
  } catch (err) {
    const ts: any = await import('@cashu/cashu-ts').catch(() => ({}));
    record('receipt survives cashuB encode/decode with DLEQ kept', false, String(err));
    console.log('cashu-ts token exports:', Object.keys(ts).filter((k) => /token/i.test(k)).join(', '));
  }

  // 4. Trader checks with the network switched off.
  networkOff();
  const t0 = performance.now();
  const offline = checkReceipt(receipt, ctx, { requestedSats: PRICE_SATS }, nobleCurve);
  const ms = performance.now() - t0;
  info.offlineCheckMs = Math.round(ms);
  record('trader check is green with the network off', offline.ok, offline.ok ? `${Math.round(ms)} ms` : `${offline.code}: ${offline.detail}`);
  record('trader check made no network request', blockedRequests === 0, `${blockedRequests} blocked`);

  // 5. Replays and fakes, still offline.
  const store = new MemorySeenStore();
  const first = await acceptReceipt(receipt, ctx, { requestedSats: PRICE_SATS }, nobleCurve, store);
  record('first scan is accepted and recorded', first.ok);
  expectRefused('second scan of the same receipt: "Already received"', await acceptReceipt(structuredClone(token), ctx, { requestedSats: PRICE_SATS }, nobleCurve, store), 'already_received');

  expectRefused(
    'same receipt relabelled to a mint the trader did not choose',
    checkReceipt({ ...token, mint: 'https://mint.attacker.example' }, ctx, {}, nobleCurve),
    'untrusted_mint',
  );

  const edited = structuredClone(token);
  const p0 = edited.proofs[0]!;
  p0.amount = p0.amount === 1024 ? 2048 : 1024;
  expectRefused('edited amount', checkReceipt(edited, ctx, {}, nobleCurve), 'bad_signature');

  // An attacker's own mint, using the real keyset id and the real mint URL.
  const a = randomScalar();
  const fakeOuts = split(PRICE_SATS).map((amt) => blind(amt, ks.id, lockedSecret(traderPub)));
  const fakeProofs = fakeOuts.map((o) => {
    const sig = attackerSign(o.B_, a);
    return unblind({ ...sig, amount: o.amount, id: ks.id }, o, sig.A);
  });
  const attackerToken = { mint: MINT, unit: 'sat', proofs: fakeProofs };
  expectRefused('token signed by an attacker mint, labelled as the trusted mint', checkReceipt(attackerToken, ctx, {}, nobleCurve), 'bad_signature');
  const attackerKeys: Record<string, string> = {};
  for (const amt of Object.keys(ks.keys)) attackerKeys[amt] = G.multiply(a).toHex(true);
  const fooled = checkReceipt(attackerToken, { ...ctx, mints: [{ url: MINT, info: { nuts }, keysets: [{ ...ks, keys: attackerKeys }] }] }, {}, nobleCurve);
  record('(control) the same fake passes only if the trader had cached the attacker keys', fooled.ok);

  expectRefused('receipt locked to someone else', checkReceipt(token, { ...ctx, traderPubkey: G.multiply(randomScalar()).toHex(true) }, {}, nobleCurve), 'not_locked_to_you');
  networkOn();

  // 6. A real mint-signed token with a refund path, checked offline.
  const customerSecret = randomScalar();
  const customerPub = G.multiply(customerSecret).toHex(true);
  const refundable = await mintProofs(ks, 8, () =>
    lockedSecret(traderPub, [['locktime', String(Math.floor(Date.now() / 1000) + 3600)], ['refund', customerPub]]),
  );
  networkOff();
  expectRefused('real token with a locktime and refund key: "could take it back"', checkReceipt({ mint: MINT, unit: 'sat', proofs: refundable }, ctx, {}, nobleCurve), 'can_be_taken_back');
  networkOn();

  // 7. Online again: the mint itself enforces the lock.
  const ys = proofs.map((p) => nobleCurve.hashToCurve(p.secret));
  const fee = Math.ceil((proofs.length * (ks.input_fee_ppk ?? 0)) / 1000);
  const freshOutputs = () => split(PRICE_SATS - fee).map((amt) => blind(amt, ks.id, randomHex32()));

  const noSig = await api('/v1/swap', { inputs: proofs.map((p) => asInput(p)), outputs: outputsBody(freshOutputs()) });
  record('customer cannot spend the locked payment (no signature)', noSig.status !== 200, `mint said ${noSig.status} ${noSig.json?.detail ?? ''}`.trim());

  const thiefKey = hexToBytes(scalarToHex(customerSecret));
  const wrongSig = await api('/v1/swap', {
    inputs: proofs.map((p) => asInput(p, JSON.stringify({ signatures: [bytesToHex(schnorr.sign(sha256(utf8(p.secret)), thiefKey))] }))),
    outputs: outputsBody(freshOutputs()),
  });
  record("customer cannot spend it with their own key's signature", wrongSig.status !== 200, `mint said ${wrongSig.status} ${wrongSig.json?.detail ?? ''}`.trim());

  const before = await api('/v1/checkstate', { Ys: ys });
  record('payment still unspent after both attempts', (before.json.states as any[]).every((s) => s.state === 'UNSPENT'));

  const traderKey = hexToBytes(scalarToHex(traderSecret));
  const outs = freshOutputs();
  const collect = await api('/v1/swap', {
    inputs: proofs.map((p) => asInput(p, JSON.stringify({ signatures: [bytesToHex(schnorr.sign(sha256(utf8(p.secret)), traderKey))] }))),
    outputs: outputsBody(outs),
  });
  let collected = 0;
  if (collect.status === 200) {
    const fresh = (collect.json.signatures as BlindSig[]).map((sig, n) => unblind(sig, outs[n]!, ks.keys[String(outs[n]!.amount)]!));
    collected = fresh.reduce((n, p) => n + p.amount, 0);
  }
  record('trader collects with their signature', collect.status === 200 && collected === PRICE_SATS - fee, `${collected} sats back${fee ? `, fee ${fee}` : ''}${collect.status !== 200 ? `; mint said ${collect.status} ${JSON.stringify(collect.json)}` : ''}`);

  const after = await api('/v1/checkstate', { Ys: ys });
  record('the receipt is now spent at the mint', (after.json.states as any[]).every((s) => s.state === 'SPENT'));
}

let crashed: unknown = null;
try {
  await main();
} catch (err) {
  crashed = err;
  networkOn();
  record('run finished without an error', false, err instanceof Error ? err.message : String(err));
}

const go = steps.length > 0 && steps.every((s) => s.pass) && crashed === null;
info.finishedAt = new Date().toISOString();
await writeFile('go-no-go.json', JSON.stringify({ go, steps, info }, null, 2));
console.log(`\n${steps.filter((s) => s.pass).length}/${steps.length} steps passed`);
console.log(JSON.stringify(info));
console.log(go ? '\nGO' : '\nNO-GO');
process.exit(go ? 0 : 1);
