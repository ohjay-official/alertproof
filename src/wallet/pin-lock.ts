/**
 * The trader's seed is kept on the phone encrypted with their PIN
 * (WebCrypto: PBKDF2-SHA256, 600,000 rounds, then AES-GCM). Checking a
 * receipt needs only the public key, so no PIN is asked at the till; the PIN
 * is asked when collecting or cashing out.
 *
 * What it protects against, plainly: someone picking up the phone can't
 * collect or cash out. It doesn't stop a lab that copies the phone's storage
 * and tries every PIN; the recovery code and collecting often are the real
 * safety. Stated in docs/SECURITY.md.
 */

export interface LockedSeed {
  v: 1;
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

export const PIN_ITERATIONS = 600_000;
const PIN_RE = /^[0-9]{4,8}$/;

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && PIN_RE.test(pin);
}

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function lockSeed(seed: Uint8Array, pin: string, iterations = PIN_ITERATIONS): Promise<LockedSeed> {
  if (!isValidPin(pin)) throw new Error('PIN must be 4 to 8 digits');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt, iterations);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, seed as BufferSource));
  return { v: 1, iterations, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

/** The seed, or null if the PIN is wrong (or the stored blob was changed). */
export async function unlockSeed(locked: LockedSeed, pin: string): Promise<Uint8Array | null> {
  if (!isValidPin(pin) || locked?.v !== 1 || !Number.isSafeInteger(locked.iterations) || locked.iterations < 1) return null;
  try {
    const key = await deriveKey(pin, unb64(locked.salt), locked.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(locked.iv) as BufferSource }, key, unb64(locked.data) as BufferSource);
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}
