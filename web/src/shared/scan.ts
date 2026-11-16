/**
 * Reads QR codes from the back camera. Uses the phone's built-in detector
 * (Chrome on Android); on phones without one (iPhone Safari) it loads a
 * small decoder only then, so most traders never download it.
 */

interface Detector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => Detector;
  }
}

export interface Scanner {
  stop(): void;
}

export async function startScanner(video: HTMLVideoElement, onText: (text: string) => void): Promise<Scanner> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use the camera.');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  await video.play();

  let stopped = false;
  let read: () => Promise<string[]>;
  let native: Detector | null = null;
  if (window.BarcodeDetector) {
    try {
      native = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch {
      native = null;
    }
  }
  if (native) {
    const d = native;
    read = async () => (await d.detect(video)).map((c) => c.rawValue);
  } else {
    const { default: jsQR } = await import('jsqr');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    read = async () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return [];
      const scale = Math.min(1, 800 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      return code ? [code.data] : [];
    };
  }

  const tick = async () => {
    if (stopped) return;
    try {
      for (const t of await read()) if (t) onText(t);
    } catch {
      // a bad frame; keep going
    }
    if (!stopped) window.setTimeout(tick, 90);
  };
  void tick();

  return {
    stop() {
      stopped = true;
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}
