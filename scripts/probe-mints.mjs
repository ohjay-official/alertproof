/**
 * Which public mainnet mints can Sealpay use? Each must answer from a
 * browser page (CORS), support P2PK locks (NUT-11), offline signature
 * proofs (NUT-12), Lightning mint and melt (NUT-04/05), state checks
 * (NUT-07) and restore (NUT-09), with an active sat keyset.
 *
 *   node scripts/probe-mints.mjs [out.json]
 */
import { writeFileSync } from 'node:fs';

const CANDIDATES = [
  'https://mint.minibits.cash/Bitcoin',
  'https://mint.coinos.io',
  'https://mint.macadamia.cash',
  'https://mint.lnvoltz.com',
  'https://mint.cubabitcoin.org',
  'https://mint.agorist.space',
  'https://mint.0xchat.com',
  'https://mint.lnwallet.app',
  'https://mint.chorus.community',
  'https://cashu.cz',
  'https://8333.space:3338',
  'https://mint.belo.app',
  'https://testnut.cashu.space',
];
const ORIGIN = 'https://sealpay-beta.vercel.app';
const need = ['4', '5', '7', '9', '11', '12'];

async function get(url) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { Origin: ORIGIN, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  return { status: res.status, cors: res.headers.get('access-control-allow-origin'), ms: Date.now() - t0, json: await res.json().catch(() => null) };
}

const rows = [];
for (const url of CANDIDATES) {
  const row = { url };
  try {
    const info = await get(`${url}/v1/info`);
    const nuts = info.json?.nuts ?? {};
    const supported = (n) => n === '4' || n === '5' ? Array.isArray(nuts[n]?.methods) && nuts[n].methods.some((m) => m.method === 'bolt11' && m.unit === 'sat') && nuts[n].disabled !== true : nuts[n]?.supported === true;
    row.version = info.json?.version ?? null;
    row.cors = info.cors;
    row.ms = info.ms;
    row.missing = need.filter((n) => !supported(n));
    row.meltMax = nuts['5']?.methods?.find((m) => m.unit === 'sat')?.max_amount ?? null;
    row.mintMax = nuts['4']?.methods?.find((m) => m.unit === 'sat')?.max_amount ?? null;
    const ks = await get(`${url}/v1/keysets`);
    const sat = (ks.json?.keysets ?? []).filter((k) => k.unit === 'sat' && k.active);
    row.satKeysets = sat.length;
    row.feePpk = sat.map((k) => k.input_fee_ppk ?? 0);
    row.usable = info.status === 200 && row.cors === '*' && row.missing.length === 0 && sat.length > 0;
  } catch (err) {
    row.error = String(err?.cause?.message ?? err?.message ?? err);
    row.usable = false;
  }
  rows.push(row);
  console.log(`${row.usable ? 'USABLE ' : 'no     '} ${url}  ${JSON.stringify({ v: row.version, cors: row.cors, missing: row.missing, fee: row.feePpk, ms: row.ms, err: row.error })}`);
}
writeFileSync(process.argv[2] ?? 'mints.json', JSON.stringify(rows, null, 2));
