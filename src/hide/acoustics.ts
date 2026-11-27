import type { Point } from "../../shared/hide/shot";
import type { Player } from "../../shared/hide/world";

type Box = { at: number[]; size: number[]; solid?: boolean };
export class SoundWalls {
  private walls: { min: number[]; max: number[] }[];
  constructor(boxes: Box[]) {
    this.walls = boxes.filter(b => b.solid !== false).map(b => ({
      min: b.at.map((v, i) => v - b.size[i] * .5),
      max: b.at.map((v, i) => v + b.size[i] * .5),
    }));
  }
  // Once per audible cue, count structures between the ears and the source.
  // Ignore endpoint contact so a ricochet on our side of a wall stays clear.
  between(a: Point, b: Point, distance: number) {
    if (distance < .25) return 0;
    const delta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let hits = 0;
    for (const wall of this.walls) {
      let enter = .07 / distance, leave = 1 - enter;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(delta[i]) < 1e-7) {
          if (a[i] < wall.min[i] || a[i] > wall.max[i]) { leave = -1; break; }
        } else {
          const t0 = (wall.min[i] - a[i]) / delta[i], t1 = (wall.max[i] - a[i]) / delta[i];
          enter = Math.max(enter, Math.min(t0, t1));
          leave = Math.min(leave, Math.max(t0, t1));
          if (leave <= enter) break;
        }
      }
      if (leave > enter) hits++;
      if (hits === 2) break;
    }
    return hits;
  }
}

export type MovementCue = "jump" | "stepA" | "stepB";
export class Footsteps {
  private tracks = new Map<string, { x: number; z: number; jump: number; meters: number; left: boolean; time: number }>();
  reset() { this.tracks.clear(); }
  sample(p: Player, now: number): MovementCue | undefined {
    const jump = p.lastJump ?? 0;
    const track = this.tracks.get(p.id);
    if (!p.online || !p.alive) { this.tracks.delete(p.id); return; }
    if (!track || now - track.time > 450) {
      this.tracks.set(p.id, { x: p.x, z: p.z, meters: 0, jump, left: true, time: now });
      return;
    }
    const movement = Math.hypot(p.x - track.x, p.z - track.z);
    track.time = now; track.x = p.x; track.z = p.z;
    if (jump > track.jump) { track.jump = jump; track.meters = 0; return "jump"; }
    if (Math.abs(p.vy ?? 0) > .05 || movement > 1.7) { track.meters = 0; return; }
    track.meters += movement;
    if (track.meters < 1.55) return;
    track.meters %= 1.55;
    track.left = !track.left;
    return track.left ? "stepA" : "stepB";
  }
}
