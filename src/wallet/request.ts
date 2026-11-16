/**
 * The trader's "pay me" link, shown as a QR (and later written to the NFC
 * sticker). Everything is in the part after "#", which browsers never send
 * to a server.
 *
 *   https://sealpay.vercel.app/pay#k=<key>&m=<mint>&s=<shop>&a=<sats>&f=<fiat>&c=NGN&h=<keyset>
 *
 *   k  trader's lock key (compressed, hex)      required
 *   m  mint URL (https)                          required
 *   s  shop name, shown to the customer          required, up to 40 characters
 *   a  amount in sats                            left out on the sticker
 *   f  the same amount in naira or CFA, shown    optional, with c
 *   c  NGN or XOF                                with f
 *   h  start of the keyset id the trader cached  optional
 *   t  when the code was made (base-36 seconds)  optional; tells two sales at one price apart
 *
 * Read strictly: the customer's page shows the shop name as plain text and
 * pays only a valid key at an https mint. Nothing here is trusted by the
 * trader; their own scan and check decide.
 */
import { isPubkeyHex } from '../verify/lock.ts';
import { normalizeMintUrl } from '../verify/mint-url.ts';
import type { Currency } from './rates.ts';

export interface PayLink {
  traderPubkey: string;
  mint: string;
  shop: string;
  sats?: number;
  fiat?: { amount: number; currency: Currency };
  keysetHint?: string;
  /** when the trader made this code (base-36 seconds): tells two sales at the same price apart */
  made?: string;
}

export const MAX_SHOP = 40;
export const MAX_SATS = 10_000_000; // 0.1 BTC: far above a market sale
const HINT_RE = /^[0-9a-f]{8,16}$/;
const FIAT_RE = /^[0-9]{1,10}(\.[0-9]{1,2})?$/;

/** Shop names: printable characters only, single spaces, trimmed. */
export function cleanShopName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/ {2,}/g, ' ')
    // no towers of accent marks (used to fake other letters)
    .replace(/(\p{M}{2})\p{M}+/gu, '$1')
    .trim();
  // cut by whole characters, never in the middle of an emoji
  return Array.from(cleaned).slice(0, MAX_SHOP).join('').trim();
}

export function payLinkUrl(origin: string, link: PayLink): string {
  const p = new URLSearchParams();
  p.set('k', link.traderPubkey);
  p.set('m', link.mint);
  p.set('s', cleanShopName(link.shop));
  if (link.sats !== undefined) p.set('a', String(link.sats));
  if (link.fiat) {
    p.set('f', String(link.fiat.amount));
    p.set('c', link.fiat.currency);
  }
  if (link.keysetHint) p.set('h', link.keysetHint.slice(0, 16));
  if (link.made) p.set('t', link.made);
  return `${origin.replace(/\/+$/, '')}/pay#${p.toString()}`;
}

export type ParsedPayLink = { ok: true; link: PayLink } | { ok: false; error: string };

export function parsePayLink(input: string): ParsedPayLink {
  if (typeof input !== 'string' || input.length > 2000) return { ok: false, error: 'This payment link is not valid.' };
  const hash = input.includes('#') ? input.slice(input.indexOf('#') + 1) : input;
  const p = new URLSearchParams(hash);
  for (const key of new Set(p.keys())) {
    if (p.getAll(key).length > 1) return { ok: false, error: 'This payment link is not valid.' };
  }

  const k = p.get('k') ?? '';
  if (!isPubkeyHex(k)) return { ok: false, error: "This link has no valid shop key. Ask the trader to show their code again." };
  const mint = normalizeMintUrl(p.get('m'));
  if (!mint) return { ok: false, error: 'This link has no valid mint.' };
  const shop = cleanShopName(p.get('s') ?? '');
  if (!shop) return { ok: false, error: 'This link has no shop name.' };

  const link: PayLink = { traderPubkey: k, mint, shop };

  const a = p.get('a');
  if (a !== null) {
    if (!/^[1-9][0-9]{0,7}$/.test(a) || Number(a) > MAX_SATS) return { ok: false, error: 'The amount in this link is not valid.' };
    link.sats = Number(a);
  }
  const f = p.get('f');
  const c = p.get('c');
  if (f !== null || c !== null) {
    if (f === null || !FIAT_RE.test(f) || Number(f) <= 0 || (c !== 'NGN' && c !== 'XOF')) {
      return { ok: false, error: 'The price in this link is not valid.' };
    }
    link.fiat = { amount: Number(f), currency: c };
  }
  const t = p.get('t');
  if (t !== null) {
    if (!/^[0-9a-z]{1,12}$/.test(t)) return { ok: false, error: 'This payment link is not valid.' };
    link.made = t;
  }
  const h = p.get('h');
  if (h !== null) {
    if (!HINT_RE.test(h)) return { ok: false, error: 'This payment link is not valid.' };
    link.keysetHint = h;
  }
  return { ok: true, link };
}
