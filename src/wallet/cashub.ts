/**
 * cashuB tokens (NUT-00 V4) without the full Cashu library: "cashuB" then
 * base64url of CBOR. Only the small part of CBOR that tokens use is read
 * (unsigned ints, byte and text strings, arrays, maps, true/false/null), with
 * strict limits, and anything else is refused. Cuts about 35 KB (gzipped)
 * from what the trader's phone downloads.
 *
 *   { m: mint, u: unit, d?: memo,
 *     t: [ { i: keyset id (bytes), p: [ { a: amount, s: secret, c: C (bytes),
 *                                          d?: { e, s, r } (bytes), w?: witness } ] } ] }
 *
 * v2 keyset ids (01 + 32 bytes) travel as their 8-byte short form (NUT-02)
 * and are expanded from the trader's cached ids, as cashu-ts does.
 * Checked against cashu-ts both ways in src/wallet/cashub.test.ts, and on the real
 * test mint by the Go/No-Go.
 */
import type { Proof } from '../verify/types.ts';

export interface CashuToken {
  mint: string;
  unit: string;
  memo?: string;
  proofs: Proof[];
}

const MAX_BYTES = 16_000;
const MAX_ITEMS = 256;
const MAX_DEPTH = 8;

// ---------------------------------------------------------------- hex and base64url

const HEX = /^[0-9a-f]*$/;

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !HEX.test(hex)) throw new Error('bad hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[n >> 18]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64[n >> 18]! + B64[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[n >> 18]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]!;
  }
  return out;
}

function fromBase64Url(text: string): Uint8Array {
  const s = text.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('bad base64');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = B64.indexOf(s[i]!);
    const b = B64.indexOf(s[i + 1]!);
    const c = i + 2 < s.length ? B64.indexOf(s[i + 2]!) : 0;
    const d = i + 3 < s.length ? B64.indexOf(s[i + 3]!) : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = n >> 16;
    if (i + 2 < s.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < s.length) out[o++] = n & 255;
  }
  return out;
}

// ---------------------------------------------------------------- CBOR (the subset tokens use)

type CborValue = number | string | Uint8Array | boolean | null | CborValue[] | Map<string, CborValue>;

class Writer {
  private parts: number[] = [];
  head(major: number, n: number): void {
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('bad length');
    const m = major << 5;
    if (n < 24) this.parts.push(m | n);
    else if (n < 0x100) this.parts.push(m | 24, n);
    else if (n < 0x10000) this.parts.push(m | 25, n >> 8, n & 255);
    else if (n < 0x100000000) this.parts.push(m | 26, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    else {
      const hi = Math.floor(n / 0x100000000);
      const lo = n >>> 0;
      this.parts.push(m | 27, 0, 0, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    }
  }
  value(v: CborValue): void {
    if (typeof v === 'number') this.head(0, v);
    else if (typeof v === 'string') {
      const b = new TextEncoder().encode(v);
      this.head(3, b.length);
      for (const x of b) this.parts.push(x);
    } else if (v instanceof Uint8Array) {
      this.head(2, v.length);
      for (const x of v) this.parts.push(x);
    } else if (Array.isArray(v)) {
      this.head(4, v.length);
      for (const x of v) this.value(x);
    } else if (v instanceof Map) {
      this.head(5, v.size);
      for (const [k, x] of v) {
        this.value(k);
        this.value(x);
      }
    } else if (v === true) this.parts.push(0xf5);
    else if (v === false) this.parts.push(0xf4);
    else this.parts.push(0xf6);
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

class Reader {
  private at = 0;
  private items = 0;
  private readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  private byte(): number {
    if (this.at >= this.b.length) throw new Error('token ends early');
    return this.b[this.at++]!;
  }
  private length(info: number): number {
    if (info < 24) return info;
    if (info === 24) return this.byte();
    if (info === 25) return (this.byte() << 8) | this.byte();
    if (info === 26) return ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
    if (info === 27) {
      let n = 0;
      for (let i = 0; i < 8; i++) n = n * 256 + this.byte();
      if (!Number.isSafeInteger(n)) throw new Error('number too big');
      return n;
    }
    throw new Error('unsupported CBOR length');
  }
  value(depth = 0): CborValue {
    if (depth > MAX_DEPTH) throw new Error('token nests too deep');
    if (++this.items > 4 * MAX_ITEMS * 8) throw new Error('token has too many parts');
    const first = this.byte();
    const major = first >> 5;
    const info = first & 31;
    if (major === 7) {
      if (first === 0xf5) return true;
      if (first === 0xf4) return false;
      if (first === 0xf6 || first === 0xf7) return null;
      throw new Error('unsupported CBOR value');
    }
    const n = this.length(info);
    switch (major) {
      case 0:
        return n;
      case 2:
      case 3: {
        if (this.at + n > this.b.length) throw new Error('token ends early');
        const slice = this.b.slice(this.at, this.at + n);
        this.at += n;
        if (major === 2) return slice;
        return new TextDecoder('utf-8', { fatal: true }).decode(slice);
      }
      case 4: {
        if (n > MAX_ITEMS) throw new Error('list too long');
        const out: CborValue[] = [];
        for (let i = 0; i < n; i++) out.push(this.value(depth + 1));
        return out;
      }
      case 5: {
        if (n > MAX_ITEMS) throw new Error('map too long');
        const out = new Map<string, CborValue>();
        for (let i = 0; i < n; i++) {
          const k = this.value(depth + 1);
          if (typeof k !== 'string') throw new Error('map key is not text');
          if (out.has(k)) throw new Error(`key "${k}" appears twice`);
          out.set(k, this.value(depth + 1));
        }
        return out;
      }
      default:
        throw new Error('unsupported CBOR type');
    }
  }
  end(): void {
    if (this.at !== this.b.length) throw new Error('extra bytes after the token');
  }
}

// ---------------------------------------------------------------- tokens

const isV2 = (id: string) => /^01[0-9a-f]{64}$/.test(id);

export function encodeCashuB(token: CashuToken): string {
  const byKeyset = new Map<string, Proof[]>();
  for (const p of token.proofs) byKeyset.set(p.id, [...(byKeyset.get(p.id) ?? []), p]);
  const t: CborValue[] = [];
  for (const [id, proofs] of byKeyset) {
    const wireId = isV2(id) ? id.slice(0, 16) : id;
    t.push(
      new Map<string, CborValue>([
        ['i', hexToBytes(wireId)],
        [
          'p',
          proofs.map((p) => {
            const m = new Map<string, CborValue>([
              ['a', Number(p.amount)],
              ['s', p.secret],
              ['c', hexToBytes(p.C)],
            ]);
            if (p.dleq) m.set('d', new Map<string, CborValue>([['e', hexToBytes(p.dleq.e)], ['s', hexToBytes(p.dleq.s)], ['r', hexToBytes(p.dleq.r)]]));
            return m;
          }),
        ],
      ]),
    );
  }
  const root = new Map<string, CborValue>([['m', token.mint], ['u', token.unit]]);
  if (token.memo) root.set('d', token.memo);
  root.set('t', t);
  const w = new Writer();
  w.value(root);
  return 'cashuB' + toBase64Url(w.bytes());
}

function get(m: CborValue, key: string): CborValue | undefined {
  return m instanceof Map ? m.get(key) : undefined;
}

/**
 * Decode a cashuB token into plain fields. Shape problems throw; the
 * offline check then judges every field anyway.
 */
export function decodeCashuB(text: string, fullKeysetIds: readonly string[]): CashuToken {
  if (!text.startsWith('cashuB')) throw new Error('not a cashuB token');
  const bytes = fromBase64Url(text.slice(6));
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error('token size is not valid');
  const r = new Reader(bytes);
  const root = r.value();
  r.end();
  const mint = get(root, 'm');
  const unit = get(root, 'u');
  const memo = get(root, 'd');
  const t = get(root, 't');
  if (typeof mint !== 'string' || typeof unit !== 'string' || !Array.isArray(t)) throw new Error('token is missing its mint, unit or proofs');
  const proofs: Proof[] = [];
  for (const group of t) {
    const idBytes = get(group, 'i');
    const list = get(group, 'p');
    if (!(idBytes instanceof Uint8Array) || !Array.isArray(list)) throw new Error('token group is malformed');
    let id = bytesToHex(idBytes);
    if (id.length === 16 && id.startsWith('01')) {
      const matches = fullKeysetIds.filter((full) => full.startsWith(id));
      if (matches.length !== 1) throw new Error('keyset is not in the saved mint keys');
      id = matches[0]!;
    }
    for (const raw of list) {
      const a = get(raw, 'a');
      const s = get(raw, 's');
      const c = get(raw, 'c');
      const d = get(raw, 'd');
      if (typeof a !== 'number' || typeof s !== 'string' || !(c instanceof Uint8Array)) throw new Error('proof is malformed');
      const proof: Proof = { id, amount: a, secret: s, C: bytesToHex(c) };
      if (d !== undefined) {
        const e = get(d, 'e');
        const ss = get(d, 's');
        const rr = get(d, 'r');
        if (!(e instanceof Uint8Array) || !(ss instanceof Uint8Array) || !(rr instanceof Uint8Array)) throw new Error('proof DLEQ is malformed');
        proof.dleq = { e: bytesToHex(e), s: bytesToHex(ss), r: bytesToHex(rr) };
      }
      proofs.push(proof);
      if (proofs.length > MAX_ITEMS) throw new Error('too many proofs');
    }
  }
  const token: CashuToken = { mint, unit, proofs };
  if (typeof memo === 'string') token.memo = memo;
  return token;
}
