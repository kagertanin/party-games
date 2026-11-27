import { getVolume, soundOutput } from "../audio/sound";
import type { Point, Shot } from "../../shared/hide/shot";
import type { Player } from "../../shared/hide/world";
import { Footsteps, SoundWalls } from "./acoustics";
import clipUrl from "./spatial.mp3";

// Mono originals, pre-rendered so footsteps for a full room cost one short
// buffer voice per step. Offset, duration, level and audible radius (metres).
const cues = {
  shot: [0, .28, .85, 110], stepA: [.4, .18, .30, 24], stepB: [.7, .18, .30, 24],
  jump: [1, .24, .45, 34], impact: [1.36, .16, .34, 40], penalty: [1.64, .32, .82, 65],
  found: [2.08, .23, .64, 68], yelp: [2.43, .48, .86, 78], taunt: [3.03, .64, .92, 100],
} as const;
type Cue = keyof typeof cues;
let bank: AudioBuffer | undefined;
let pending: Promise<void> | undefined;
let retryAt = 0;
function prepareBank() {
  const output = soundOutput();
  if (bank || pending || !output || performance.now() < retryAt) return;
  pending = fetch(clipUrl).then(async response => {
    if (!response.ok) throw Error("Sound unavailable");
    bank = await output.context.decodeAudioData(await response.arrayBuffer());
  }).catch(() => { retryAt = performance.now() + 10000; }).finally(() => { pending = undefined; });
}

export class HideAudio {
  private output = soundOutput();
  private mix?: DynamicsCompressorNode;
  private ears: Point = [0, 0, 0];
  private yaw = NaN;
  private tilt = NaN;
  private hasListener = false;
  private steps = new Footsteps();
  private active = new Map<AudioBufferSourceNode, boolean>();
  constructor(private walls: SoundWalls) { prepareBank(); }

  listener(x: number, y: number, z: number, yaw: number, tilt: number) {
    const output = this.output ??= soundOutput();
    if (!output || output.context.state !== "running") return;
    if (this.hasListener && x === this.ears[0] && y === this.ears[1] && z === this.ears[2] &&
        yaw === this.yaw && tilt === this.tilt) return;
    const l = output.context.listener;
    const s = Math.sin(yaw), c = Math.cos(yaw), p = Math.sin(tilt), q = Math.cos(tilt);
    if (l.positionX) {
      l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
      l.forwardX.value = -s*q; l.forwardY.value = p; l.forwardZ.value = -c*q;
      l.upX.value = s*p; l.upY.value = q; l.upZ.value = c*p;
    } else {
      l.setPosition(x, y, z); l.setOrientation(-s*q, p, -c*q, s*p, q, c*p);
    }
    this.ears[0] = x; this.ears[1] = y; this.ears[2] = z;
    this.yaw = yaw; this.tilt = tilt; this.hasListener = true;
  }
  private play(kind: Cue, at: Point, delay = 0) {
    const output = this.output ??= soundOutput();
    if (!output || !this.hasListener || !getVolume() || document.hidden || output.context.state !== "running") return;
    if (!bank) { prepareBank(); return; }
    const d = Math.hypot(at[0]-this.ears[0], at[1]-this.ears[1], at[2]-this.ears[2]);
    const [start, length, gain, range] = cues[kind];
    if (d >= range) return;
    const quiet = kind === "stepA" || kind === "stepB";
    if (this.active.size >= 24) {
      if (quiet) return;
      const oldest = this.active.keys().next().value;
      const victim = Array.from(this.active).find(([, step]) => step)?.[0] ?? oldest;
      if (victim) { this.active.delete(victim); victim.stop(); }
    }
    const ctx = output.context;
    const walls = this.walls.between(this.ears, at, d);
    const source = ctx.createBufferSource(), panner = ctx.createPanner(), level = ctx.createGain();
    source.buffer = bank;
    panner.panningModel = "HRTF"; panner.distanceModel = "inverse";
    panner.refDistance = quiet ? 2 : 4; panner.rolloffFactor = .8; panner.maxDistance = range;
    if (panner.positionX) {
      panner.positionX.value = at[0]; panner.positionY.value = at[1]; panner.positionZ.value = at[2];
    } else panner.setPosition(...at);
    level.gain.value = gain * Math.min(1, (range-d)/(range*.24)) * (.6 ** walls);
    const filter = walls ? ctx.createBiquadFilter() : undefined;
    source.connect(panner);
    if (filter) {
      filter.type = "lowpass"; filter.frequency.value = walls === 1 ? 1500 : 850;
      filter.Q.value = .65;
      panner.connect(filter).connect(level);
    } else panner.connect(level);
    // Nearby hunters can fire together. Tame peaks before applying the common volume.
    if (!this.mix) {
      this.mix = ctx.createDynamicsCompressor();
      this.mix.threshold.value = -9;
      this.mix.knee.value = 6;
      this.mix.ratio.value = 5;
      this.mix.connect(output.gain);
    }
    level.connect(this.mix);
    this.active.set(source, quiet);
    source.onended = () => {
      this.active.delete(source); source.disconnect(); panner.disconnect(); filter?.disconnect(); level.disconnect();
    };
    source.start(ctx.currentTime + delay, start, length);
  }
  movement(p: Player, now: number) {
    const cue = this.steps.sample(p, now);
    if (cue) this.play(cue, [p.x, (p.y ?? 0) + .18, p.z]);
  }
  shot(shot: Shot) {
    this.play("shot", shot.origin);
    if (shot.hit) {
      this.play("found", shot.end, .045);
      this.play("yelp", shot.end, .08);
    } else if (shot.impact) {
      this.play(shot.penalty ? "penalty" : "impact", shot.end, .055);
    }
  }
  cry(position: Point) { this.play("taunt", position); }
  reset() {
    this.steps.reset(); this.hasListener = false;
    for (const source of this.active.keys()) source.stop();
    this.active.clear();
    this.mix?.disconnect(); this.mix = undefined;
  }
}
