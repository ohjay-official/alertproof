/**
 * How the verdict reaches a trader with busy hands: a tone, a buzz and the
 * phone's own voice. Each works on its own; if the phone has no voice for
 * the language, the tone and the buzz still come.
 */

let audio: AudioContext | null = null;

function tone(freqs: number[], ms: number): void {
  try {
    audio ??= new AudioContext();
    let t = audio.currentTime;
    for (const f of freqs) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = f;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + ms / 1000 + 0.02);
      t += ms / 1000;
    }
  } catch {
    // no audio on this phone
  }
}

export function say(text: string, lang = 'en'): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'fr' ? 'fr-FR' : 'en-NG';
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
    if (voice) u.voice = voice;
    u.rate = 0.95;
    synth.speak(u);
  } catch {
    // no voice on this phone
  }
}

export function signalPaid(spoken: string, lang?: string): void {
  tone([880, 1320], 140);
  navigator.vibrate?.([90, 60, 90]);
  say(spoken, lang);
}

export function signalNotPaid(spoken: string, lang?: string): void {
  tone([300, 220], 260);
  navigator.vibrate?.([400]);
  say(spoken, lang);
}

/** Browsers only allow sound after a tap: call this from the first button press. */
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    // fine
  }
}
