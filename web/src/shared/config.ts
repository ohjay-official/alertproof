/** Mints Sealpay offers. The site's security rules (CSP) allow calls only to these and the price service. */
export const TEST_MINT = 'https://testnut.cashu.space';

export const MINTS: Array<{ url: string; label: string; test: boolean }> = [
  { url: TEST_MINT, label: 'Test mint (fake sats, for trying it out)', test: true },
];
