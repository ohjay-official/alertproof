/**
 * A deliberately narrow JSON reader for NUT-10 secrets.
 *
 * Why not JSON.parse: the mint parses the same secret with its own parser
 * (Python, Rust serde, Go). If two parsers read one secret differently, the
 * trader's phone could see a lock to the trader while the mint sees no valid
 * lock and lets the payer spend it. NUT-10 secrets that fail to parse are
 * treated as plain secrets, which anyone holding them can spend.
 *
 * So this reader only accepts input that every common parser reads the same
 * way:
 *   - printable ASCII plus the four JSON whitespace characters, nothing else
 *   - no backslashes, so no escapes and no unicode tricks
 *   - strings, arrays and objects only (no numbers, true, false or null)
 *   - no duplicate keys in an object (serde rejects them, Python keeps the last)
 *   - no trailing commas, bounded depth and length
 *
 * Anything outside that is refused. A real P2PK secret from cashu-ts, cdk or
 * nutshell fits easily.
 */

export type StrictValue = string | StrictValue[] | Map<string, StrictValue>;

export const MAX_SECRET_LENGTH = 1024;
const MAX_DEPTH = 4;

export class StrictJsonError extends Error {}

function isAllowedChar(code: number): boolean {
  // tab, LF, CR, or printable ASCII except backslash
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  return code >= 0x20 && code <= 0x7e && code !== 0x5c;
}

export function parseStrictJson(text: string): StrictValue {
  if (typeof text !== 'string') throw new StrictJsonError('not a string');
  if (text.length === 0) throw new StrictJsonError('empty');
  if (text.length > MAX_SECRET_LENGTH) throw new StrictJsonError('too long');
  for (let k = 0; k < text.length; k++) {
    if (!isAllowedChar(text.charCodeAt(k))) {
      throw new StrictJsonError(`character not allowed at ${k}`);
    }
  }

  let i = 0;

  const ws = (): void => {
    while (i < text.length) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++;
      else break;
    }
  };

  const fail = (why: string): never => {
    throw new StrictJsonError(`${why} at ${i}`);
  };

  const readString = (): string => {
    // text[i] is the opening quote
    i++;
    const start = i;
    while (i < text.length && text[i] !== '"') {
      const code = text.charCodeAt(i);
      // JSON forbids raw control characters inside strings
      if (code < 0x20) fail('control character in string');
      i++;
    }
    if (i >= text.length) fail('unterminated string');
    const out = text.slice(start, i);
    i++; // closing quote
    return out;
  };

  const readValue = (depth: number): StrictValue => {
    if (depth > MAX_DEPTH) fail('too deep');
    ws();
    const c = text[i];
    if (c === '"') return readString();
    if (c === '[') return readArray(depth);
    if (c === '{') return readObject(depth);
    return fail('unsupported value');
  };

  const readArray = (depth: number): StrictValue[] => {
    i++; // [
    const out: StrictValue[] = [];
    ws();
    if (text[i] === ']') {
      i++;
      return out;
    }
    for (;;) {
      out.push(readValue(depth + 1));
      ws();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        return out;
      }
      fail('expected , or ]');
    }
  };

  const readObject = (depth: number): Map<string, StrictValue> => {
    i++; // {
    const out = new Map<string, StrictValue>();
    ws();
    if (text[i] === '}') {
      i++;
      return out;
    }
    for (;;) {
      ws();
      if (text[i] !== '"') fail('expected key');
      const key = readString();
      if (out.has(key)) fail(`duplicate key "${key}"`);
      ws();
      if (text[i] !== ':') fail('expected :');
      i++;
      const value = readValue(depth + 1);
      out.set(key, value);
      ws();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        return out;
      }
      fail('expected , or }');
    }
  };

  const value = readValue(0);
  ws();
  if (i !== text.length) fail('trailing characters');
  return value;
}
