import type { Accepted } from './types.ts';

/**
 * Where the trader's phone remembers what it already accepted.
 *
 * Contract for `claim`: if none of `ys` was recorded before, record all of
 * them together with the receipt and resolve true. If any was recorded
 * before, record nothing and resolve false. The two writes happen together
 * or not at all (in the app: one IndexedDB readwrite transaction), so the
 * replay list and the list of payments to collect never disagree.
 */
export interface SeenStore {
  claim(ys: readonly string[], receipt: Accepted): Promise<boolean>;
}

/** In-memory store for tests and the demo. Check and insert run with no await between them. */
export class MemorySeenStore implements SeenStore {
  readonly seen = new Set<string>();
  readonly receipts: Accepted[] = [];

  async claim(ys: readonly string[], receipt: Accepted): Promise<boolean> {
    for (const y of ys) if (this.seen.has(y)) return false;
    for (const y of ys) this.seen.add(y);
    this.receipts.push(receipt);
    return true;
  }
}
