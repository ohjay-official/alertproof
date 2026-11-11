import type { Received } from './types.ts';

/**
 * Where the trader's phone remembers what it already received.
 *
 * Contract for `claim`: if none of `ys` was recorded before, record all of
 * them together with the payment and resolve true. If any was recorded
 * before, record nothing and resolve false. The two writes happen together
 * or not at all (in the app: one IndexedDB readwrite transaction), so the
 * replay list and the list of payments to collect never disagree.
 *
 * The list must outlive the browser's storage clean-ups (the app asks for
 * persistent storage) and goes into the trader's backup: a phone restored
 * without it can't tell an old receipt from a new one while offline.
 */
export interface SeenStore {
  claim(ys: readonly string[], payment: Received): Promise<boolean>;
}

/** In-memory store for tests and the demo. Check and insert run with no await between them. */
export class MemorySeenStore implements SeenStore {
  readonly seen = new Set<string>();
  readonly payments: Received[] = [];

  async claim(ys: readonly string[], payment: Received): Promise<boolean> {
    for (const y of ys) if (this.seen.has(y)) return false;
    for (const y of ys) this.seen.add(y);
    this.payments.push(payment);
    return true;
  }
}
