import type { HideSettings } from "./settings.js";
import office from "./office.json" with { type: "json" };
import catalogue from "./models.json" with { type: "json" };

export { office };
export const models: Record<string, typeof catalogue.food_mug> = catalogue;
export type Phase = "lobby" | "hide" | "hunt" | "results";
export interface Player {
  foundAt?: number;
  id: string;
  name: string;
  hunter: boolean;
  alive: boolean;
  online: boolean;
  x: number;
  /** Feet above the office floor, in metres. */
  y?: number;
  vy?: number;
  lastJump?: number;
  z: number;
  yaw: number;
  pitch: number;
  facing: number;
  form: string;
  /** Remaining hunter lives; keep the original field name on the wire. */
  ammo: number;
}
export interface Snapshot {
  settings: HideSettings;
  ack: number;
  players: Player[];
  host: string;
  phase: Phase;
  until: number;
  now: number;
  winner: string;
  remaining: number;
}
export interface Input {
  /** Increments once per distinct jump press. */
  jump?: number;
  forward: number;
  side: number;
  yaw: number;
  pitch: number;
}
export const rad = Math.PI / 180;
type Bounds = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  cosine: number;
  sine: number;
  prop: number;
};
const bounds = (
  at: number[],
  size: number[],
  angle: number,
  prop: number,
): Bounds => ({
  x: at[0],
  y: at[1],
  z: at[2],
  w: size[0] / 2,
  h: size[1] / 2,
  d: size[2] / 2,
  cosine: Math.cos(angle),
  sine: Math.sin(angle),
  prop,
});
export const obstacles: Bounds[] = office.boxes
  .filter((b) => b.solid !== false)
  .map((b) => bounds(b.at, b.size, 0, -1));
office.props.forEach((p, i) => {
  const s = models[p.id].size;
  obstacles.push(
    bounds([p.at[0], p.at[1] + s[1] / 2, p.at[2]], s, (p.yaw ?? 0) * rad, i),
  );
});
// A single cell covers every obstacle reachable by the interaction ray,
// the camera boom or the player's collision radius.
const cellSize = 4;
export const cameraBoom = 2.8;
export const copyRange = 4;
const cameraMargin = 0.1;
const padding = Math.max(copyRange, cameraBoom + 2 * cameraMargin);
const grid = new Map<string, Bounds[]>();
const cell = (v: number) => Math.floor(v / cellSize);
const cellKey = (x: number, z: number) => x + ":" + z;
for (const o of obstacles) {
  const halfX = Math.abs(o.cosine) * o.w + Math.abs(o.sine) * o.d + padding;
  const halfZ = Math.abs(o.sine) * o.w + Math.abs(o.cosine) * o.d + padding;
  for (let x = cell(o.x - halfX); x <= cell(o.x + halfX); x++) {
    for (let z = cell(o.z - halfZ); z <= cell(o.z + halfZ); z++) {
      const key = cellKey(x, z);
      let local = grid.get(key);
      if (!local) grid.set(key, (local = []));
      local.push(o);
    }
  }
}
const empty: Bounds[] = [];
function near(x: number, z: number) {
  return grid.get(cellKey(cell(x), cell(z))) ?? empty;
}
export function cameraDistance(at: number[], dir: number[]) {
  let distance = cameraBoom;
  for (const o of near(at[0], at[2]))
    distance = Math.min(distance, intersect(at, dir, o, cameraMargin) - 0.015);
  return Math.max(0.01, distance);
}
export function body(p: Player, facing = p.facing) {
  const s = models[p.form]?.size ?? [0.52, 1.72, 0.52];
  return bounds([p.x, (p.y ?? 0) + s[1] / 2, p.z], s, facing, -2);
}
// Human movement has a fixed footprint, independent of where the camera looks.
// Props use the orientation copied from the office model.
function hiderBody(p: Player) {
  return body(p, p.form ? p.facing : 0);
}

export function hiderColliders(p: Player, players: Iterable<Player>): Bounds[] {
  if (p.hunter) return empty;
  const others: Bounds[] = [];
  for (const other of players) {
    if (other.id !== p.id && !other.hunter && other.alive) others.push(hiderBody(other));
  }
  return others;
}
export function eye(p: Player) {
  return (p.y ?? 0) + Math.max(0.23, (models[p.form]?.size[1] ?? 1.72) * 0.875);
}
export function walk(p: Player, input: Input, seconds: number, others = empty) {
  p.yaw = input.yaw;
  p.pitch = input.pitch;
  if (!p.form) p.facing = p.yaw;
  // A legacy/time-delayed step can span a whole small disguise in one tick.
  const steps = others.length ? Math.max(1, Math.ceil(seconds * 60)) : 1;
  const dt = seconds / steps;
  const speed = (4.6 * dt) / Math.max(1, Math.hypot(input.side, input.forward));
  const dx =
    (Math.cos(p.yaw) * input.side - Math.sin(p.yaw) * input.forward) * speed;
  const dz =
    (-Math.sin(p.yaw) * input.side - Math.cos(p.yaw) * input.forward) * speed;
  for (let i = 0; i < steps; i++) {
    if (dx && fits(p, p.x + dx, p.z, others)) p.x += dx;
    if (dz && fits(p, p.x, p.z + dz, others)) p.z += dz;
    if (!p.hunter && dt > 0) stepHeight(p, input, dt, others);
  }
}

function footprintRadius(p: Player) {
  const size = models[p.form]?.size;
  return Math.max(0.09, Math.min(0.75, (size ? Math.max(size[0], size[2]) : 0.52) * 0.425));
}

function overlapsFootprint(x: number, z: number, radius: number, o: Bounds) {
  const dx = x - o.x, dz = z - o.z;
  const outsideX = Math.max(0, Math.abs(dx * o.cosine - dz * o.sine) - o.w);
  const outsideZ = Math.max(0, Math.abs(dx * o.sine + dz * o.cosine) - o.d);
  return outsideX * outsideX + outsideZ * outsideZ < radius * radius;
}

const contactEpsilon = 1e-5;
// Separating-axis test on both models' local X/Z axes. Using the moving
// prop's full footprint also keeps long sofas and desks from clipping corners.
function hidersOverlap(a: Bounds, x: number, z: number, b: Bounds) {
  const dx = x - b.x, dz = z - b.z;
  const cos = Math.abs(a.cosine * b.cosine + a.sine * b.sine);
  const sin = Math.abs(a.sine * b.cosine - a.cosine * b.sine);
  return Math.abs(dx * a.cosine - dz * a.sine) < a.w + b.w * cos + b.d * sin - contactEpsilon &&
    Math.abs(dx * a.sine + dz * a.cosine) < a.d + b.w * sin + b.d * cos - contactEpsilon &&
    Math.abs(dx * b.cosine - dz * b.sine) < b.w + a.w * cos + a.d * sin - contactEpsilon &&
    Math.abs(dx * b.sine + dz * b.cosine) < b.d + a.w * sin + a.d * cos - contactEpsilon;
}

export function overlapsHider(p: Player, x: number, feet: number, z: number, others: Bounds[]) {
  if (!others.length) return false;
  const moving = hiderBody(p);
  const head = feet + moving.h * 2;
  return others.some(o => o.y + o.h > feet + contactEpsilon && o.y - o.h < head - contactEpsilon &&
    hidersOverlap(moving, x, z, o));
}
const gravity = 16;
const jumpSpeed = 5.1; // A single press rises about 0.81 metres; later presses reset the impulse.

function stepHeight(p: Player, input: Input, dt: number, others: Bounds[]) {
  const feet = p.y ?? 0;
  let speed = p.vy ?? 0;
  if ((input.jump ?? 0) > (p.lastJump ?? 0)) {
    p.lastJump = input.jump;
    speed = jumpSpeed;
  }
  // Ground-level horizontal movement is the most common case.
  if (feet === 0 && speed === 0) return;
  const height = models[p.form]?.size[1] ?? 1.72;
  const radius = footprintRadius(p);
  const next = feet + speed * dt - 0.5 * gravity * dt * dt;
  const rising = next >= feet;
  let limit = rising ? Infinity : 0;
  const moving = others.length ? hiderBody(p) : undefined;
  function constrain(o: Bounds, dynamic: boolean) {
    const contact = rising ? o.y - o.h - height : o.y + o.h;
    if (rising ? contact < feet - contactEpsilon || contact > next || contact >= limit :
        contact > feet + contactEpsilon || contact < next || contact <= limit) return;
    const overlaps = dynamic ? hidersOverlap(moving!, p.x, p.z, o) : overlapsFootprint(p.x, p.z, radius, o);
    if (overlaps) limit = contact;
  }
  for (const o of near(p.x, p.z)) constrain(o, false);
  for (const o of others) constrain(o, true);
  const stopped = rising ? next >= limit : next <= limit;
  p.y = stopped ? limit : next;
  p.vy = stopped ? 0 : speed - gravity * dt;
}

export function fits(p: Player, x: number, z: number, others = empty) {
  if (Math.abs(x) > 49 || Math.abs(z) > 44) return false;
  const feet = p.y ?? 0;
  const head = feet + (models[p.form]?.size[1] ?? 1.72);
  const radius = footprintRadius(p);
  if (near(x, z).some(o =>
    o.y + o.h > feet + contactEpsilon && o.y - o.h < head - contactEpsilon &&
    overlapsFootprint(x, z, radius, o))) return false;
  return !overlapsHider(p, x, feet, z, others);
}
export function direction(yaw: number, pitch: number) {
  return [
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ];
}
export function intersect(origin: number[], dir: number[], o: Bounds, margin = 0) {
  const c = o.cosine,
    s = o.sine,
    x = origin[0] - o.x,
    z = origin[2] - o.z;
  const pos = [x * c - z * s, origin[1] - o.y, x * s + z * c];
  const ray = [dir[0] * c - dir[2] * s, dir[1], dir[0] * s + dir[2] * c],
    half = [o.w + margin, o.h + margin, o.d + margin];
  let near = 0,
    far = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ray[i]) < 1e-8) {
      if (Math.abs(pos[i]) > half[i]) return Infinity;
      continue;
    }
    const a = (-half[i] - pos[i]) / ray[i],
      b = (half[i] - pos[i]) / ray[i];
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (far < near) return Infinity;
  }
  return near;
}
export function target(p: Player, players: Player[] = [], range = Infinity) {
  const at = [p.x, eye(p), p.z],
    dir = direction(p.yaw, p.pitch);
  let distance = Infinity,
    prop = -1,
    id = "";
  for (const o of range <= copyRange ? near(p.x, p.z) : obstacles) {
    const d = intersect(at, dir, o);
    if (d <= range && d < distance) {
      distance = d;
      prop = o.prop;
    }
  }
  for (const other of players) {
    // A found disguise is still visible and blocks shots at scenery behind it.
    if (other.id === p.id || other.hunter) continue;
    const d = intersect(at, dir, body(other));
    if (d <= range && d < distance) {
      distance = d;
      id = other.id;
      prop = -1;
    }
  }
  return { distance, prop, id };
}
