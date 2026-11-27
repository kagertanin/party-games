import clipUrl from "./fabric.mp3";

const clips = {
  hover: [0, .09], press: [.19, .14], background: [.43, .12], flight: [.65, .28],
  turn: [1.03, .32], points: [1.45, .21], miss: [1.76, .20], cheer: [2.06, 1.4],
} as const;
export type Sound = keyof typeof clips;
const preferenceKey = "party-games.sound.v1";
type Settings = { volume: number; muted: boolean };
function read(): Settings {
  try {
    const data = JSON.parse(localStorage.getItem(preferenceKey) || "null");
    if (Number.isInteger(data?.volume) && data.volume > 0 && data.volume <= 100) {
      return { volume: data.volume, muted: data.muted === true };
    }
  } catch { /* Storage can be unavailable. */ }
  return { volume: 45, muted: false };
}
let settings = read();
export const getVolume = () => settings.muted ? 0 : settings.volume;
let context: AudioContext | undefined;
let gain: GainNode | undefined;
let buffer: AudioBuffer | undefined;
let loading: Promise<void> | undefined;
const voices = new Set<AudioBufferSourceNode>();

function updateGain() {
  if (gain && context) gain.gain.setTargetAtTime((getVolume() / 100) ** 1.4, context.currentTime, .005);
  if (settings.muted) for (const voice of voices) voice.stop();
}
export function setVolume(value: number, restore = settings.volume) {
  settings = { volume: value || restore || 45, muted: value === 0 };
  updateGain();
  try { localStorage.setItem(preferenceKey, JSON.stringify(settings)); } catch { /* Optional preference persistence. */ }
}
export function toggleSound() { setVolume(settings.muted ? settings.volume : 0); }
export function syncVolume() { settings = read(); updateGain(); }

// Fetch the small bank once. Decode independently of the first user gesture.
export function prepareSound() {
  if (loading || buffer || !window.AudioContext) return;
  try {
    context ??= new AudioContext({ latencyHint: "interactive" });
    if (!gain) {
      gain = context.createGain();
      gain.connect(context.destination);
      updateGain();
    }
    const ctx = context;
    loading = fetch(clipUrl).then(async response => {
      if (!response.ok) throw Error("audio");
      buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    }).catch(() => {}).finally(() => { loading = undefined; });
  } catch { /* Gameplay also works without audio output. */ }
}
export function unlockSound() {
  prepareSound();
  if (context && context.state !== "running") void context.resume().catch(() => {});
}
export function playSound(sound: Sound, step = 0) {
  if (!context || !gain || settings.muted || document.hidden) return;
  const ctx = context, output = gain;
  const started = performance.now();
  function play() {
    if (!buffer || settings.muted || document.hidden || ctx.state !== "running" ||
        performance.now() - started > 220) return;
    const voice = ctx.createBufferSource();
    voice.buffer = buffer;
    const rate = sound === "points" ? 1 + (step % 5) * .055 : 1;
    voice.playbackRate.value = rate;
    const level = ctx.createGain();
    level.gain.value = 1 / Math.sqrt(1 + voices.size);
    voice.connect(level).connect(output);
    voices.add(voice);
    voice.onended = () => { voices.delete(voice); voice.disconnect(); level.disconnect(); };
    const [offset, length] = clips[sound];
    voice.start(0, offset, length);
  }
  if (ctx.state === "running" && buffer) play();
  else if (sound !== "hover" && navigator.userActivation?.hasBeenActive) {
    void Promise.all([ctx.resume(), loading]).then(play).catch(() => {});
  }
}
