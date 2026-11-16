/** QR codes drawn as SVG (crisp at any size, no image files, no data: URLs). */
import { encode } from 'uqr';
import { toFrames } from '../../../src/wallet/frames.ts';

const SVG = 'http://www.w3.org/2000/svg';

export function qrSvg(text: string, label: string): SVGSVGElement {
  const qr = encode(text, { ecc: 'M', border: 2 });
  const n = qr.data.length;
  let d = '';
  qr.data.forEach((row: boolean[], y: number) => row.forEach((dark: boolean, x: number) => {
    if (dark) d += `M${x} ${y}h1v1h-1z`;
  }));
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(SVG, 'rect');
  bg.setAttribute('width', String(n));
  bg.setAttribute('height', String(n));
  bg.setAttribute('fill', '#fff');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#10231c');
  svg.append(bg, path);
  return svg;
}

/**
 * A receipt QR that plays through its frames. Returns the element, a
 * progress row, and a stop function. One frame if the receipt is short.
 */
export function animatedQr(text: string, label: string, ms = 300): { box: HTMLElement; dots: HTMLElement; stop: () => void } {
  const frames = toFrames(text);
  const box = document.createElement('div');
  box.className = 'qr';
  const dots = document.createElement('div');
  dots.className = 'frames';
  dots.setAttribute('aria-hidden', 'true');
  const svgs = frames.map((f, i) => qrSvg(f, frames.length > 1 ? `${label}, part ${i + 1} of ${frames.length}` : label));
  const marks = frames.map(() => document.createElement('i'));
  if (frames.length > 1) dots.append(...marks);
  let i = 0;
  const step = () => {
    box.replaceChildren(svgs[i]!);
    marks.forEach((m, k) => (m.className = k === i ? 'on' : ''));
    i = (i + 1) % frames.length;
  };
  step();
  const timer = frames.length > 1 ? window.setInterval(step, ms) : 0;
  return { box, dots, stop: () => window.clearInterval(timer) };
}
