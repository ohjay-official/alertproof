/**
 * The few mint calls AlertProof makes, over the mint's plain REST API
 * (NUT-03 swap, NUT-04 mint, NUT-05 melt, NUT-07 check state, NUT-09 restore).
 * Every response is read defensively: amounts as whole numbers (some mints
 * send them as decimal strings), states normalized, errors carried with the
 * mint's own code and message.
 */
import type { BlindSignature } from './ecash.ts';

export class MintError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = 'MintError';
    this.status = status;
    this.code = code;
  }
}

export type MintQuoteState = 'UNPAID' | 'PAID' | 'ISSUED';
export type MeltState = 'UNPAID' | 'PENDING' | 'PAID';

export interface MintQuote {
  quote: string;
  /** bolt11 invoice to pay */
  request: string;
  state: MintQuoteState;
  /** unix seconds, or null */
  expiry: number | null;
}

export interface MeltQuote {
  quote: string;
  amount: number;
  fee_reserve: number;
  state: MeltState;
  expiry: number | null;
}

export interface MeltResult {
  state: MeltState;
  preimage: string | null;
  change: BlindSignature[];
}

type Input = { id: string; amount: number; secret: string; C: string; witness?: string };
type Output = { amount: number; id: string; B_: string };

const TIMEOUT_MS = 20_000;

function wholeNumber(value: unknown, what: string): number {
  const n = typeof value === 'string' && /^[0-9]{1,16}$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) throw new MintError(`mint sent a bad ${what}`, 200);
  return n;
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new MintError(`mint sent no ${what}`, 200);
  return value;
}

function expiryOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function readSignatures(list: unknown): BlindSignature[] {
  if (!Array.isArray(list)) throw new MintError('mint sent no signatures', 200);
  return list.map((s: any) => {
    const sig: BlindSignature = { id: text(s?.id, 'keyset id'), amount: wholeNumber(s?.amount, 'amount'), C_: text(s?.C_, 'signature') };
    if (s?.dleq && typeof s.dleq.e === 'string' && typeof s.dleq.s === 'string') sig.dleq = { e: s.dleq.e, s: s.dleq.s };
    return sig;
  });
}

function mintQuoteState(j: any): MintQuoteState {
  if (j?.state === 'UNPAID' || j?.state === 'PAID' || j?.state === 'ISSUED') return j.state;
  // older mints: paid / issued booleans
  if (j?.issued === true) return 'ISSUED';
  return j?.paid === true ? 'PAID' : 'UNPAID';
}

function meltState(j: any): MeltState {
  if (j?.state === 'UNPAID' || j?.state === 'PENDING' || j?.state === 'PAID') return j.state;
  return j?.paid === true ? 'PAID' : 'UNPAID';
}

export class MintApi {
  readonly url: string;
  private readonly fetchFn: typeof fetch;
  // The default reads `fetch` at call time, so a test or the demo's "network off" switch can replace it.
  constructor(url: string, fetchFn: typeof fetch = (input, init) => fetch(input, init)) {
    this.url = url;
    this.fetchFn = fetchFn;
  }

  private async call(path: string, body?: unknown): Promise<any> {
    const init: RequestInit = {
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    };
    if (body !== undefined) {
      init.method = 'POST';
      init.body = JSON.stringify(body);
    }
    const res = await this.fetchFn(this.url + path, init);
    const raw = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // not JSON; handled below
    }
    if (!res.ok) {
      const detail = typeof json?.detail === 'string' ? json.detail : raw.slice(0, 200) || res.statusText;
      const code = typeof json?.code === 'number' ? json.code : undefined;
      throw new MintError(`${path}: ${detail}`, res.status, code);
    }
    if (json === null) throw new MintError(`${path}: the mint did not answer with JSON`, res.status);
    return json;
  }

  async createMintQuote(amount: number): Promise<MintQuote> {
    const j = await this.call('/v1/mint/quote/bolt11', { amount, unit: 'sat' });
    return { quote: text(j.quote, 'quote id'), request: text(j.request, 'invoice'), state: mintQuoteState(j), expiry: expiryOf(j.expiry) };
  }

  async getMintQuote(quote: string): Promise<MintQuote> {
    const j = await this.call(`/v1/mint/quote/bolt11/${encodeURIComponent(quote)}`);
    return { quote, request: typeof j.request === 'string' ? j.request : '', state: mintQuoteState(j), expiry: expiryOf(j.expiry) };
  }

  async mint(quote: string, outputs: Output[]): Promise<BlindSignature[]> {
    const j = await this.call('/v1/mint/bolt11', { quote, outputs });
    return readSignatures(j.signatures);
  }

  /** NUT-09: signatures the mint already gave for these outputs (to recover after a lost answer). */
  async restore(outputs: Output[]): Promise<{ outputs: Output[]; signatures: BlindSignature[] }> {
    const j = await this.call('/v1/restore', { outputs });
    const outs = Array.isArray(j.outputs) ? j.outputs : [];
    return {
      outputs: outs.map((o: any) => ({ amount: wholeNumber(o?.amount, 'amount'), id: text(o?.id, 'keyset id'), B_: text(o?.B_, 'output') })),
      signatures: readSignatures(j.signatures ?? j.promises),
    };
  }

  async swap(inputs: Input[], outputs: Output[]): Promise<BlindSignature[]> {
    const j = await this.call('/v1/swap', { inputs, outputs });
    return readSignatures(j.signatures);
  }

  async checkState(Ys: string[]): Promise<Array<'UNSPENT' | 'PENDING' | 'SPENT'>> {
    const j = await this.call('/v1/checkstate', { Ys });
    if (!Array.isArray(j.states) || j.states.length !== Ys.length) throw new MintError('mint sent the wrong number of states', 200);
    return j.states.map((s: any, n: number) => {
      if (s?.Y !== undefined && s.Y !== Ys[n]) throw new MintError('mint sent states out of order', 200);
      if (s?.state === 'UNSPENT' || s?.state === 'PENDING' || s?.state === 'SPENT') return s.state;
      throw new MintError('mint sent an unknown state', 200);
    });
  }

  async createMeltQuote(invoice: string): Promise<MeltQuote> {
    const j = await this.call('/v1/melt/quote/bolt11', { request: invoice, unit: 'sat' });
    return {
      quote: text(j.quote, 'quote id'),
      amount: wholeNumber(j.amount, 'amount'),
      fee_reserve: wholeNumber(j.fee_reserve ?? 0, 'fee reserve'),
      state: meltState(j),
      expiry: expiryOf(j.expiry),
    };
  }

  async melt(quote: string, inputs: Input[], outputs: Output[]): Promise<MeltResult> {
    const j = await this.call('/v1/melt/bolt11', { quote, inputs, outputs });
    return {
      state: meltState(j),
      preimage: typeof j.payment_preimage === 'string' ? j.payment_preimage : null,
      change: Array.isArray(j.change) ? readSignatures(j.change) : [],
    };
  }
}
