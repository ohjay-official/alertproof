/**
 * Bitcoin's price in naira and CFA, fetched while online and cached, so the
 * trader can type a price in naira with no data. The age is always shown
 * next to the amount, because a stale rate is the trader's call to accept.
 *
 * Source: CoinGecko's public price API (BTC in NGN and EUR). CFA (XOF) is
 * pegged to the euro by law at 655.957 XOF per EUR, so it is worked out from
 * the euro price rather than from a thinly traded pair.
 */

export type Currency = 'NGN' | 'XOF';

export interface Rates {
  /** price of 1 BTC */
  btc: Record<Currency, number>;
  /** when fetched, ms since 1970 */
  at: number;
  source: string;
}

export const XOF_PER_EUR = 655.957;
export const RATES_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=ngn,eur';
const SATS_PER_BTC = 100_000_000;

function price(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`no ${what} price in the answer`);
  return value;
}

export async function fetchRates(fetchFn: typeof fetch = (i, init) => fetch(i, init), now: () => number = Date.now): Promise<Rates> {
  const res = await fetchFn(RATES_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`price service: HTTP ${res.status}`);
  const j: any = await res.json();
  const ngn = price(j?.bitcoin?.ngn, 'naira');
  const eur = price(j?.bitcoin?.eur, 'euro');
  return { btc: { NGN: ngn, XOF: eur * XOF_PER_EUR }, at: now(), source: 'CoinGecko' };
}

/** Sats for a price in naira or CFA, rounded up so the trader is never a sat short. */
export function fiatToSats(amount: number, currency: Currency, rates: Rates): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new RangeError('amount must be more than zero');
  return Math.max(1, Math.ceil((amount / rates.btc[currency]) * SATS_PER_BTC - 1e-9));
}

/** What sats are worth in naira or CFA, for display. */
export function satsToFiat(sats: number, currency: Currency, rates: Rates): number {
  return (sats / SATS_PER_BTC) * rates.btc[currency];
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" */
export function rateAge(rates: Rates, now: number = Date.now()): string {
  const min = Math.max(0, Math.floor((now - rates.at) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/** "₦2,000" or "2,000 CFA". Naira and CFA are shown as whole amounts at a market stall. */
export function formatFiat(amount: number, currency: Currency): string {
  const whole = Math.round(amount).toLocaleString('en-US');
  return currency === 'NGN' ? `₦${whole}` : `${whole} CFA`;
}
