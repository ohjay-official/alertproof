/** After one visit the app opens with no data (see web/src/sw-template.js). */
export function keepOffline(): void {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
