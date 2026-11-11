// @ts-check
// Sets up AlertProof's Vercel project through Vercel's REST API, for
// .github/workflows/web.yml (adapted from Contri). Needs VERCEL_TOKEN; never
// prints a secret. Run from the web/ folder.
//
//   node ../scripts/vercel.mjs setup    create the project if needed, link this
//                                       folder to it (.vercel/project.json)
//   node ../scripts/vercel.mjs domain   print the project's production URL

import { mkdir, writeFile } from 'node:fs/promises';

const API = 'https://api.vercel.com';
const TOKEN = process.env.VERCEL_TOKEN ?? '';
const PROJECT = process.env.PROJECT ?? 'alertproof';
if (!TOKEN) throw new Error('VERCEL_TOKEN is not set');

/** The team the token is scoped to; every API call names it. */
let team = '';

/** @param {string} path @param {RequestInit} [init] */
async function api(path, init = {}) {
  if (team) path += `${path.includes('?') ? '&' : '?'}teamId=${team}`;
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function project() {
  let r = await api(`/v9/projects/${PROJECT}`);
  if (r.status === 404) {
    r = await api('/v11/projects', { method: 'POST', body: JSON.stringify({ name: PROJECT, framework: null }) });
    if (r.status >= 300) throw new Error(`couldn't create the project: ${r.status} ${r.body?.error?.message ?? ''}`);
    console.log(`created project ${PROJECT}`);
  } else if (r.status >= 300) {
    throw new Error(`couldn't read the project: ${r.status} ${r.body?.error?.message ?? ''}`);
  }
  return r.body;
}

const command = process.argv[2];
const teams = await api('/v2/teams');
const list = /** @type {any[]} */ (teams.body?.teams ?? []);
if (list.length >= 1) {
  team = (list.find((t) => t.slug === process.env.VERCEL_TEAM) ?? list[0]).id;
  console.error(`team: ${list.find((t) => t.id === team)?.name ?? team}`);
}
const p = await project();

if (command === 'setup') {
  await mkdir('.vercel', { recursive: true });
  await writeFile('.vercel/project.json', JSON.stringify({ projectId: p.id, orgId: p.accountId }));
  console.log(`linked to ${PROJECT}`);
} else if (command === 'domain') {
  const aliases = /** @type {string[]} */ ([
    ...(p.targets?.production?.alias ?? []),
    ...(p.alias ?? []).map((/** @type {any} */ a) => a.domain),
  ]);
  const vercel = aliases.filter((a) => a.endsWith('.vercel.app')).sort((a, b) => a.length - b.length)[0];
  console.log(`https://${vercel ?? `${PROJECT}.vercel.app`}`);
} else {
  throw new Error('usage: node scripts/vercel.mjs setup | domain');
}
