/** Mints Sealpay offers. The site's security rules (CSP) allow calls only to these and the price service. */
export const TEST_MINT = 'https://testnut.cashu.space';

export const MINTS: Array<{ url: string; label: string; test: boolean }> = [
  { url: TEST_MINT, label: 'Test mint (fake sats, for trying it out)', test: true },
  // Picked Nov 16 from CI's probe of public mints (scripts/probe-mints.mjs): same mint
  // software as the test mint (cdk-mintd), every feature Sealpay needs, no fee per proof.
  { url: 'https://mint.minibits.cash/Bitcoin', label: 'Minibits (real bitcoin)', test: false },
];
