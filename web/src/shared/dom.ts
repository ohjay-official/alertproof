/** Tiny DOM helpers. Text always goes in as text nodes, never as HTML. */

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  return el;
}

/** Replace the whole screen. */
export function show(...nodes: Node[]): void {
  const app = document.getElementById('app')!;
  app.replaceChildren(...nodes);
  app.className = '';
  window.scrollTo(0, 0);
}

/** A screen: optional top area, a body, and actions pinned to the bottom. */
export function screen(opts: { top?: Child[]; body: Child[]; actions?: Child[]; tone?: 'ok' | 'no' | 'part' }): HTMLElement {
  const el = h(
    'section',
    { class: `screen${opts.tone ? ` verdict ${opts.tone}` : ''}` },
    opts.top ? h('header', { class: 'top' }, ...opts.top) : null,
    h('div', { class: 'body' }, ...opts.body),
    opts.actions ? h('div', { class: 'actions' }, ...opts.actions) : null,
  );
  return el;
}

export function button(label: string, onclick: () => void, kind: 'main' | 'quiet' = 'main', extra: Props = {}): HTMLButtonElement {
  return h('button', { type: 'button', class: `btn${kind === 'quiet' ? ' quiet' : ''}`, onclick, ...extra }, label);
}

/** Run an async action from a button: show a busy label, restore it after. */
export async function busy<T>(btn: HTMLButtonElement, label: string, work: () => Promise<T>): Promise<T> {
  const before = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  btn.setAttribute('aria-busy', 'true');
  try {
    return await work();
  } finally {
    btn.disabled = false;
    btn.textContent = before;
    btn.removeAttribute('aria-busy');
  }
}

export function note(text: string, kind: 'info' | 'error' = 'info'): HTMLParagraphElement {
  return h('p', { class: `note ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
}

export const sats = (n: number): string => `${Math.round(n).toLocaleString('en-US')} sats`;

/** Friendly message for anything thrown while online. */
export function explain(err: unknown): string {
  if (err instanceof TypeError || (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError'))) {
    return "Couldn't reach the internet. Check your data and try again.";
  }
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 160 ? msg.slice(0, 157) + '...' : msg;
}
