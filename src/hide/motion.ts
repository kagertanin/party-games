import { MAX_BATCH_STEPS, STEP_SECONDS, type MoveBatch } from "../../shared/hide/movement.js";
import { walk, type Input, type Player, type Snapshot } from "../../shared/hide/world.js";

export class LocalMotion {
  private player: Player;
  private sequence: number;
  private sampledAt?: number;
  private sent: number;
  private acknowledged: number;
  private pending: Input[] = [];
  private fraction = 0;
  private partialInput?: Input;
  private offsetX = 0;
  private offsetZ = 0;

  constructor(player: Player, ack = 0) {
    this.player = { ...player };
    this.sequence = this.sent = this.acknowledged = ack;
  }

  resetClock(now: number) {
    this.sampledAt = now;
  }

  advanceTo(input: Input, time: number) {
    if (this.sampledAt === undefined) this.sampledAt = time;
    if (time <= this.sampledAt) return;
    this.advance(input, (time - this.sampledAt) / 1000);
    this.sampledAt = time;
  }

  advance(input: Input, seconds: number) {
    const dt = Math.min(Math.max(seconds, 0), MAX_BATCH_STEPS * STEP_SECONDS);
    const decay = Math.exp(-18 * dt);
    this.offsetX *= decay;
    this.offsetZ *= decay;
    let remaining = dt;
    while (remaining > 1e-10 && this.pending.length < 240) {
      // A partly displayed step must finish with the same controls. Changing
      // direction on a 144 Hz display must not undo a previously drawn frame.
      const move = this.partialInput ?? input;
      const needed = STEP_SECONDS - this.fraction;
      if (remaining + 1e-10 < needed) {
        this.partialInput = move;
        this.fraction += remaining;
        break;
      }
      walk(this.player, move, STEP_SECONDS);
      this.pending.push(move);
      this.sequence++;
      this.fraction = 0;
      this.partialInput = undefined;
      remaining -= needed;
    }
  }

  takeBatch(): MoveBatch | undefined {
    if (this.sent >= this.sequence) return;
    const inputs = this.pending.slice(this.sent - this.acknowledged,
      this.sent - this.acknowledged + MAX_BATCH_STEPS);
    const first = this.sent + 1;
    this.sent += inputs.length;
    return { first, inputs };
  }

  reconcile(player: Player, ack: number) {
    if (ack < this.acknowledged || ack > this.sequence) return;
    this.pending.splice(0, ack - this.acknowledged);
    this.acknowledged = ack;
    const corrected = { ...player };
    for (const move of this.pending) walk(corrected, move, STEP_SECONDS);
    this.offsetX += this.player.x - corrected.x;
    this.offsetZ += this.player.z - corrected.z;
    if (Math.hypot(this.offsetX, this.offsetZ) > 1.5)
      this.offsetX = this.offsetZ = 0;
    this.player = corrected;
  }

  pose(input: Input) {
    const pose = { ...this.player };
    if (this.partialInput) {
      // Blend toward the collision-tested end of this step. A shorter
      // collision probe could appear to enter a wall, then snap back.
      walk(pose, this.partialInput, STEP_SECONDS);
      const blend = this.fraction / STEP_SECONDS;
      pose.x = this.player.x + (pose.x - this.player.x) * blend;
      pose.z = this.player.z + (pose.z - this.player.z) * blend;
    } else {
      walk(pose, input, 0);
    }
    pose.x += this.offsetX;
    pose.z += this.offsetZ;
    return pose;
  }
}

const BUFFER_MS = 125;
const angleBetween = (a: number, b: number, t: number) =>
  a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export class RemoteMotion {
  private samples: Snapshot[] = [];
  private serverTime = 0;
  private localTime = 0;
  private arrivedAt = 0;

  push(snapshot: Snapshot, now: number) {
    const previous = this.samples.at(-1);
    if (!previous || snapshot.phase === "lobby" || previous.phase === "lobby" ||
        snapshot.now - previous.now > 1000) {
      this.samples = [];
      this.serverTime = snapshot.now - BUFFER_MS;
      this.localTime = now;
    } else if (snapshot.now < previous.now) return;
    if (this.samples.at(-1)?.now === snapshot.now) this.samples.pop();
    this.samples.push(snapshot);
    this.arrivedAt = now;
    if (this.samples.length > 20) this.samples.shift();
  }

  at(now: number) {
    const latest = this.samples.at(-1);
    if (!latest) return 0;
    const elapsed = Math.max(0, now - this.localTime);
    // Estimate server time from the newest snapshot's arrival. Never play a
    // queue of stale snapshots after shader compilation or a background tab.
    const target = latest.now + Math.max(0, now - this.arrivedAt) - BUFFER_MS;
    const advance = this.serverTime + elapsed;
    const drift = target - advance;
    const adjustment = Math.max(-0.08 * elapsed, Math.min(0.08 * elapsed, drift));
    const next = drift > 100 ? target : advance + adjustment;
    this.serverTime = Math.max(this.serverTime, Math.min(latest.now, next));
    this.localTime = now;
    return this.serverTime;
  }

  pose(latest: Player, time: number): Player {
    let right = this.samples.findIndex(s => s.now >= time);
    if (right < 0) right = this.samples.length - 1;
    if (right < 0) return latest;
    const b = this.samples[right];
    const a = this.samples[Math.max(0, right - 1)];
    const to = b.players.find(p => p.id === latest.id);
    if (!to) {
      // Newly visible players may have no sample on the playhead yet.
      for (let i = right + 1; i < this.samples.length; i++) {
        const first = this.samples[i].players.find(p => p.id === latest.id);
        if (first) return first;
      }
      return latest;
    }
    const from = a.players.find(p => p.id === latest.id);
    if (!from || a.now === b.now) return to;
    const t = Math.max(0, Math.min(1, (time - a.now) / (b.now - a.now)));
    return { ...to, x: from.x + (to.x - from.x) * t,
      z: from.z + (to.z - from.z) * t,
      yaw: angleBetween(from.yaw, to.yaw, t),
      pitch: from.pitch + (to.pitch - from.pitch) * t,
      facing: angleBetween(from.facing, to.facing, t) };
  }
}
