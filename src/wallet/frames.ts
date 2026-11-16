/**
 * Animated receipt QR. A receipt of several proofs is about 2,400 characters,
 * too dense for one QR on a cheap phone camera, so the customer's screen
 * cycles through smaller QR frames and the trader's camera collects them in
 * any order, missing ones coming round again.
 *
 *   AP1:<n>/<total>:<check>:<part>
 *
 * <check> is 8 hex characters of FNV-1a over the whole receipt, so frames
 * from two different receipts never mix. It only catches mix-ups; the
 * receipt's own signatures are what's trusted.
 *
 * A receipt short enough for one QR is shown as plain cashuB text, which any
 * Cashu wallet can also read.
 */

export const FRAME_PREFIX = 'AP1:';
export const DEFAULT_PART = 280;
const MAX_FRAMES = 64;
const FRAME_RE = /^AP1:([1-9][0-9]?)\/([1-9][0-9]?):([0-9a-f]{8}):(.+)$/s;

export function check(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function toFrames(text: string, part = DEFAULT_PART): string[] {
  if (!Number.isSafeInteger(part) || part < 16) throw new RangeError('part size too small');
  if (text.length <= part) return [text];
  const total = Math.ceil(text.length / part);
  if (total > MAX_FRAMES) throw new RangeError('receipt too long to show');
  const sum = check(text);
  const frames: string[] = [];
  for (let n = 0; n < total; n++) frames.push(`${FRAME_PREFIX}${n + 1}/${total}:${sum}:${text.slice(n * part, (n + 1) * part)}`);
  return frames;
}

export type Collected =
  | { done: true; text: string }
  | { done: false; have: number; total: number };

/** Feeds on every QR the camera reads, in any order, repeats included. */
export class FrameCollector {
  private total = 0;
  private sum = '';
  private parts = new Map<number, string>();

  reset(): void {
    this.total = 0;
    this.sum = '';
    this.parts.clear();
  }

  add(scanned: string): Collected {
    const m = FRAME_RE.exec(scanned);
    if (!m) {
      // Mid-way through an animated receipt, a stray code (a sign, a URL) is ignored, not judged.
      if (this.total > 0 && !/^(cashu:)?cashu[AB]/i.test(scanned.trim())) return { done: false, have: this.parts.size, total: this.total };
      // A plain single-QR receipt (or anything else: the check decides).
      this.reset();
      return { done: true, text: scanned };
    }
    const n = Number(m[1]);
    const total = Number(m[2]);
    const sum = m[3]!;
    if (n > total || total > MAX_FRAMES) return { done: false, have: this.parts.size, total: this.total };
    if (sum !== this.sum || total !== this.total) {
      // A new receipt: start over.
      this.reset();
      this.total = total;
      this.sum = sum;
    }
    this.parts.set(n, m[4]!);
    if (this.parts.size < total) return { done: false, have: this.parts.size, total };
    let text = '';
    for (let i = 1; i <= total; i++) text += this.parts.get(i)!;
    this.reset();
    if (check(text) !== sum) return { done: false, have: 0, total };
    return { done: true, text };
  }
}
