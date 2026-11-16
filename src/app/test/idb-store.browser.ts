import { IdbStore, openDb } from '../idb-store.ts';
const pay = (n: number) => ({ mint: 'https://m.example', totalSats: n, feeSats: 1, ys: [], proofs: [] } as any);
(window as any).run = async () => {
  const out: Record<string, unknown> = {};
  const s = new IdbStore(await openDb('t' + Math.random()));
  s.context = { requestedSats: 1333, now: () => 1 };
  out.first = await s.claim(['a', 'b'], pay(1334));
  out.again = await s.claim(['b', 'c'], pay(1334));
  out.fresh = await s.claim(['c'], pay(500));
  const race = await Promise.all([s.claim(['x'], pay(1334)), s.claim(['x'], pay(1334))]);
  out.race = race;
  const sales = await s.sales();
  out.sales = sales.map((x) => [x.totalSats, x.part, x.collected]);
  await s.markCollected([sales[0]!.id]);
  out.collected = (await s.sales()).map((x) => x.collected);
  await s.set('k', { v: 1 }); out.kv = await s.get('k');
  out.export = (await s.exportAll()).seen;
  return out;
};
