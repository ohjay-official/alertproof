/**
 * A Cashu mint in memory, with real curve math, for testing the wallet flows
 * without a network. It signs with real keys and DLEQ proofs, checks every
 * input's signature, enforces P2PK locks (Schnorr witness by the locked
 * key), keeps a spent list, charges input fees, and answers over the same
 * REST paths the real mint uses, through a fake `fetch`.
 *
 * It can also lose its answer after doing the work (`loseNextAnswer`), to
 * test recovery with NUT-09 restore.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { G, N, Point, hashE, hashToCurveBytes, hexToBytes, scalarToHex, type CurvePoint } from '../../verify/curve-noble.ts';
import { parseStrictJson } from '../../verify/strict-json.ts';
import { randomHex, randomScalar } from '../ecash.ts';
import type { CachedKeyset, TrustedMint } from '../../verify/types.ts';

type Quote = { amount: number; state: 'UNPAID' | 'PAID' | 'ISSUED'; request: string };
type MeltQ = { amount: number; fee_reserve: number; state: 'UNPAID' | 'PAID' };
type Out = { amount: number; id: string; B_: string };
type In = { id: string; amount: number; secret: string; C: string; witness?: string };
type Sig = { id: string; amount: number; C_: string; dleq: { e: string; s: string } };

class Refusal extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

const utf8 = (s: string) => new TextEncoder().encode(s);

export class MemoryMint {
  readonly url: string;
  readonly keysetId: string;
  readonly feePpk: number;
  readonly feeReserve: number;
  readonly keys: Record<string, string> = {};
  /** pay mint quotes as soon as they are made, as the public test mint does */
  autoPay = true;
  /** do the next state-changing call, then fail as if the answer was lost on a bad network */
  loseNextAnswer = false;
  readonly calls: string[] = [];
  readonly spent = new Set<string>();

  private readonly priv = new Map<number, bigint>();
  private readonly quotes = new Map<string, Quote>();
  private readonly meltQuotes = new Map<string, MeltQ>();
  private readonly signed = new Map<string, Sig>();

  constructor(opts: { url?: string; feePpk?: number; feeReserve?: number } = {}) {
    this.url = opts.url ?? 'https://mint.test.example';
    this.feePpk = opts.feePpk ?? 0;
    this.feeReserve = opts.feeReserve ?? 2;
    this.keysetId = '00' + randomHex(7);
    for (let i = 0; i <= 20; i++) {
      const a = randomScalar();
      this.priv.set(2 ** i, a);
      this.keys[String(2 ** i)] = G.multiply(a).toHex(true);
    }
  }

  keyset(): CachedKeyset {
    return { id: this.keysetId, unit: 'sat', keys: { ...this.keys }, input_fee_ppk: this.feePpk };
  }

  trusted(): TrustedMint {
    return { url: this.url, info: { nuts: { '11': { supported: true }, '12': { supported: true } } }, keysets: [this.keyset()] };
  }

  /** Mark a mint quote paid (when autoPay is off). */
  pay(quote: string): void {
    const q = this.quotes.get(quote);
    if (q && q.state === 'UNPAID') q.state = 'PAID';
  }

  private sign(o: Out): Sig {
    if (o.id !== this.keysetId) throw new Refusal('keyset not known', 12001);
    const a = this.priv.get(o.amount);
    if (a === undefined) throw new Refusal(`no key for amount ${o.amount}`, 11006);
    if (this.signed.has(o.B_)) throw new Refusal('Blinded message is already signed', 10002);
    const B_ = Point.fromHex(o.B_);
    const C_ = B_.multiply(a);
    const A = G.multiply(a);
    const p = randomScalar();
    const e = hashE([G.multiply(p), B_.multiply(p), A, C_]);
    const s = (p + BigInt('0x' + e) * a) % N;
    const sig: Sig = { id: o.id, amount: o.amount, C_: C_.toHex(true), dleq: { e, s: scalarToHex(s) } };
    return sig;
  }

  private signAll(outs: Out[]): Sig[] {
    const seen = new Set<string>();
    for (const o of outs) {
      if (seen.has(o.B_)) throw new Refusal('duplicate output', 11002);
      seen.add(o.B_);
    }
    const sigs = outs.map((o) => this.sign(o));
    outs.forEach((o, n) => this.signed.set(o.B_, sigs[n]!));
    return sigs;
  }

  private y(secret: string): string {
    return hashToCurveBytes(utf8(secret)).toHex(true);
  }

  /** Check inputs (signature, lock, not spent), return their total and fee. Spends nothing. */
  private checkInputs(inputs: In[]): { total: number; fee: number; ys: string[] } {
    if (!Array.isArray(inputs) || inputs.length === 0) throw new Refusal('no inputs', 11002);
    const ys: string[] = [];
    let total = 0;
    for (const p of inputs) {
      if (p.id !== this.keysetId) throw new Refusal('keyset not known', 12001);
      const a = this.priv.get(p.amount);
      if (a === undefined) throw new Refusal('bad amount', 11006);
      const Y: CurvePoint = hashToCurveBytes(utf8(p.secret));
      if (!Point.fromHex(p.C).equals(Y.multiply(a))) throw new Refusal('Token could not be verified', 10003);
      const yHex = Y.toHex(true);
      if (this.spent.has(yHex) || ys.includes(yHex)) throw new Refusal('Token already spent', 11001);
      if (p.secret.startsWith('[')) {
        const parsed = parseStrictJson(p.secret) as any;
        if (parsed[0] === 'P2PK') {
          const lockKey = (parsed[1] as Map<string, unknown>).get('data') as string;
          let sigs: unknown;
          try {
            sigs = JSON.parse(p.witness ?? 'null')?.signatures;
          } catch {
            sigs = null;
          }
          if (!Array.isArray(sigs) || sigs.length === 0) {
            throw new Refusal('Witness signatures not provided. P2PK signatures are required but not provided', 20008);
          }
          const msg = sha256(utf8(p.secret));
          const xonly = hexToBytes(lockKey).slice(1);
          const ok = sigs.some((s) => {
            try {
              return typeof s === 'string' && schnorr.verify(hexToBytes(s), msg, xonly);
            } catch {
              return false;
            }
          });
          if (!ok) throw new Refusal('P2PK spend conditions are not met', 20008);
        }
      }
      ys.push(yHex);
      total += p.amount;
    }
    return { total, fee: Math.ceil((inputs.length * this.feePpk) / 1000), ys };
  }

  private handle(method: string, path: string, body: any): unknown {
    if (method === 'GET' && path === '/v1/info') return { name: 'memory mint', nuts: { '11': { supported: true }, '12': { supported: true } } };
    if (method === 'GET' && path === '/v1/keysets') return { keysets: [{ id: this.keysetId, unit: 'sat', active: true, input_fee_ppk: this.feePpk }] };
    if (method === 'GET' && path === `/v1/keys/${this.keysetId}`) return { keysets: [{ id: this.keysetId, unit: 'sat', keys: this.keys }] };

    if (method === 'POST' && path === '/v1/mint/quote/bolt11') {
      const quote = randomHex(16);
      const q: Quote = { amount: body.amount, state: this.autoPay ? 'PAID' : 'UNPAID', request: `lnfake-mint-${quote}` };
      this.quotes.set(quote, q);
      return { quote, request: q.request, state: q.state, expiry: Math.floor(Date.now() / 1000) + 600, amount: q.amount, unit: 'sat' };
    }
    const mq = /^\/v1\/mint\/quote\/bolt11\/([0-9a-f]+)$/.exec(path);
    if (method === 'GET' && mq) {
      const q = this.quotes.get(mq[1]!);
      if (!q) throw new Refusal('quote not found', 20000);
      return { quote: mq[1], request: q.request, state: q.state, expiry: null, amount: q.amount };
    }
    if (method === 'POST' && path === '/v1/mint/bolt11') {
      const q = this.quotes.get(body.quote);
      if (!q) throw new Refusal('quote not found', 20000);
      if (q.state === 'ISSUED') throw new Refusal('Quote already issued', 20002);
      if (q.state !== 'PAID') throw new Refusal('Quote not paid', 20001);
      const outs = body.outputs as Out[];
      if (outs.reduce((n, o) => n + o.amount, 0) !== q.amount) throw new Refusal('Outputs do not match the quote', 11002);
      const signatures = this.signAll(outs);
      q.state = 'ISSUED';
      return { signatures };
    }
    if (method === 'POST' && path === '/v1/restore') {
      const outputs: Out[] = [];
      const signatures: Sig[] = [];
      for (const o of body.outputs as Out[]) {
        const sig = this.signed.get(o.B_);
        if (sig) {
          outputs.push(o);
          signatures.push(sig);
        }
      }
      return { outputs, signatures };
    }
    if (method === 'POST' && path === '/v1/swap') {
      const { total, fee, ys } = this.checkInputs(body.inputs);
      const outs = body.outputs as Out[];
      if (outs.reduce((n, o) => n + o.amount, 0) !== total - fee) throw new Refusal('Transaction is not balanced', 11002);
      const signatures = this.signAll(outs);
      for (const y of ys) this.spent.add(y);
      return { signatures };
    }
    if (method === 'POST' && path === '/v1/checkstate') {
      return { states: (body.Ys as string[]).map((Y) => ({ Y, state: this.spent.has(Y) ? 'SPENT' : 'UNSPENT', witness: null })) };
    }
    if (method === 'POST' && path === '/v1/melt/quote/bolt11') {
      const m = /^lnfake(?:-mint-[0-9a-f]+|([0-9]+))$/.exec(body.request ?? '');
      if (!m) throw new Refusal('invoice not understood', 20000);
      const amount = m[1] ? Number(m[1]) : (this.quotes.get(body.request.slice('lnfake-mint-'.length))?.amount ?? 0);
      const quote = randomHex(16);
      this.meltQuotes.set(quote, { amount, fee_reserve: this.feeReserve, state: 'UNPAID' });
      return { quote, amount, fee_reserve: this.feeReserve, state: 'UNPAID', expiry: null };
    }
    if (method === 'POST' && path === '/v1/melt/bolt11') {
      const q = this.meltQuotes.get(body.quote);
      if (!q) throw new Refusal('quote not found', 20000);
      if (q.state === 'PAID') throw new Refusal('Invoice already paid', 20006);
      const { total, fee, ys } = this.checkInputs(body.inputs);
      if (total - fee < q.amount + q.fee_reserve) throw new Refusal('Not enough inputs for the amount and fee reserve', 11002);
      // The Lightning payment itself costs nothing here, so all of the reserve comes back.
      const changeAmounts: number[] = [];
      for (let left = total - fee - q.amount, bit = 1; left > 0; bit *= 2) {
        if (left & bit) {
          changeAmounts.push(bit);
          left -= bit;
        }
      }
      const blanks = (body.outputs ?? []) as Out[];
      const change = this.signAll(changeAmounts.slice(0, blanks.length).map((amount, n) => ({ ...blanks[n]!, amount })));
      for (const y of ys) this.spent.add(y);
      q.state = 'PAID';
      return { quote: body.quote, state: 'PAID', payment_preimage: '00'.repeat(32), change };
    }
    throw new Refusal(`no route ${method} ${path}`, 0);
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname;
    this.calls.push(`${method} ${path}`);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    let status = 200;
    let answer: unknown;
    try {
      answer = this.handle(method, path, body);
    } catch (err) {
      status = 400;
      answer = { detail: err instanceof Error ? err.message : String(err), code: err instanceof Refusal ? err.code : 0 };
    }
    if (this.loseNextAnswer && method === 'POST' && status === 200 && path !== '/v1/restore') {
      this.loseNextAnswer = false;
      throw new TypeError('network connection lost');
    }
    return new Response(JSON.stringify(answer), { status, headers: { 'content-type': 'application/json' } });
  };
}
