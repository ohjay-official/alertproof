/**
 * The trader's phone memory, in IndexedDB: what was received (so a receipt
 * shown twice is caught) and the payments still to collect. Both are written
 * in one transaction, so they can never disagree (see SeenStore in
 * src/verify/seen.ts).
 *
 * The app asks the browser to keep this storage (navigator.storage.persist),
 * so a clean-up can't quietly wipe the list of what was already received.
 */
import type { SeenStore } from '../verify/seen.ts';
import type { Proof, Received } from '../verify/types.ts';

export const DB_NAME = 'sealpay';
const VERSION = 1;

export interface Sale {
  id: number;
  at: number;
  mint: string;
  totalSats: number;
  feeSats: number;
  /** the price asked, in sats, if one was set */
  requestedSats: number | null;
  /** the price as the trader typed it, when there was one */
  fiat: { amount: number; currency: string } | null;
  /** true for a genuine part payment kept while the trader asks for the rest */
  part: boolean;
  /** collected at the mint yet? */
  collected: boolean;
  /** set when the mint says this money can't be collected (already spent elsewhere) */
  problem?: string;
  proofs: Proof[];
  ys: string[];
}

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });

export function openDb(name = DB_NAME, idb: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = idb.open(name, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('seen')) db.createObjectStore('seen');
      if (!db.objectStoreNames.contains('sales')) db.createObjectStore('sales', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('storage is busy in another tab'));
  });
}

/** Ask the browser not to clear this site's storage under pressure. Best effort. */
export async function keepStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export interface ClaimContext {
  requestedSats: number | null;
  fiat?: { amount: number; currency: string } | null;
  now?: () => number;
}

export class IdbStore implements SeenStore {
  readonly db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.db = db;
  }

  /**
   * One readwrite transaction: if any Y was seen, write nothing and resolve
   * false; otherwise record every Y and the sale together.
   */
  async claim(ys: readonly string[], payment: Received, ctx: ClaimContext = { requestedSats: null }): Promise<boolean> {
    const tx = this.db.transaction(['seen', 'sales'], 'readwrite');
    const seen = tx.objectStore('seen');
    const sales = tx.objectStore('sales');
    const finished = done(tx);
    let fresh = true;
    // Every read and write is queued inside the same transaction, with no
    // await on anything outside it, so the transaction can't close midway.
    const checks = ys.map((y) => seen.count(y));
    await new Promise<void>((resolve, reject) => {
      let left = checks.length;
      if (left === 0) resolve();
      for (const c of checks) {
        c.onsuccess = () => {
          if (c.result > 0) fresh = false;
          if (--left === 0) resolve();
        };
        c.onerror = () => reject(c.error);
      }
    });
    if (!fresh) {
      tx.abort();
      await finished.catch(() => undefined);
      return false;
    }
    const at = (ctx.now ?? Date.now)();
    for (const y of ys) seen.put(at, y);
    const lands = payment.totalSats - payment.feeSats;
    const sale: Omit<Sale, 'id'> = {
      at,
      mint: payment.mint,
      totalSats: payment.totalSats,
      feeSats: payment.feeSats,
      requestedSats: ctx.requestedSats,
      fiat: ctx.fiat ?? null,
      part: ctx.requestedSats !== null && lands < ctx.requestedSats,
      collected: false,
      proofs: payment.proofs,
      ys: [...ys],
    };
    sales.add(sale);
    await finished;
    return true;
  }

  async sales(): Promise<Sale[]> {
    const tx = this.db.transaction('sales', 'readonly');
    return req(tx.objectStore('sales').getAll() as IDBRequest<Sale[]>);
  }

  /** Mark sales collected, in one transaction. */
  async markCollected(ids: readonly number[]): Promise<void> {
    const tx = this.db.transaction('sales', 'readwrite');
    const store = tx.objectStore('sales');
    for (const id of ids) {
      const r = store.get(id);
      r.onsuccess = () => {
        if (r.result) store.put({ ...r.result, collected: true });
      };
    }
    await done(tx);
  }

  /**
   * Several changes in one transaction, so money never sits in two places or
   * none: the wallet, the list of pending steps, and which sales are collected.
   */
  async apply(change: { kv?: Record<string, unknown>; collected?: number[]; problems?: Record<number, string> }): Promise<void> {
    const tx = this.db.transaction(['kv', 'sales'], 'readwrite');
    const kv = tx.objectStore('kv');
    const sales = tx.objectStore('sales');
    for (const [k, v] of Object.entries(change.kv ?? {})) kv.put(v, k);
    const touch = new Set([...(change.collected ?? []), ...Object.keys(change.problems ?? {}).map(Number)]);
    for (const id of touch) {
      const r = sales.get(id);
      r.onsuccess = () => {
        if (!r.result) return;
        const next = { ...r.result };
        if (change.collected?.includes(id)) next.collected = true;
        if (change.problems?.[id]) next.problem = change.problems[id];
        sales.put(next);
      };
    }
    await done(tx);
  }

  /** Put a backup back: profile and wallet replace this phone's, seen receipts and sales are added. */
  async importAll(backup: { kv: Record<string, unknown>; seen: string[]; sales: Sale[] }): Promise<void> {
    const tx = this.db.transaction(['kv', 'seen', 'sales'], 'readwrite');
    for (const [k, v] of Object.entries(backup.kv)) tx.objectStore('kv').put(v, k);
    for (const y of backup.seen) tx.objectStore('seen').put(0, y);
    for (const sale of backup.sales) tx.objectStore('sales').put(sale);
    await done(tx);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const tx = this.db.transaction('kv', 'readonly');
    return req(tx.objectStore('kv').get(key) as IDBRequest<T | undefined>);
  }

  async set(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    await done(tx);
  }

  /** Everything, for the trader's backup: the replay list must travel with the key. */
  async exportAll(): Promise<{ seen: string[]; sales: Sale[] }> {
    const tx = this.db.transaction(['seen', 'sales'], 'readonly');
    const seen = req(tx.objectStore('seen').getAllKeys() as IDBRequest<string[]>);
    const sales = req(tx.objectStore('sales').getAll() as IDBRequest<Sale[]>);
    return { seen: await seen, sales: await sales };
  }
}
