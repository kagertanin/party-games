import office from "./office.json" with { type: "json" };
import catalogue from "./models.json" with { type: "json" };

export { office };
export const models: Record<string, typeof catalogue.food_mug> = catalogue;
export type Phase = "lobby" | "hide" | "hunt" | "results";
export interface Player {
  id: string;
  name: string;
  hunter: boolean;
  alive: boolean;
  online: boolean;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  facing: number;
  form: string;
  ammo: number;
}
export interface Snapshot {
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
// Pads each cell by the longest nearby query: the third-person camera boom.
// One lookup then covers both the boom and the player's (smaller) collision radius.
const cellSize = 4;
export const cameraBoom = 2.8;
const cameraMargin = 0.08;
const padding = cameraBoom + cameraMargin;
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
    distance = Math.min(distance, intersect(at, dir, o) - cameraMargin);
  return Math.max(0.01, distance);
}
export function body(p: Player) {
  const s = models[p.form]?.size ?? [0.52, 1.72, 0.52];
  return bounds([p.x, s[1] / 2, p.z], s, p.facing, -2);
}
export function eye(p: Player) {
  return Math.max(0.23, (models[p.form]?.size[1] ?? 1.72) * 0.875);
}
export function walk(p: Player, input: Input, seconds: number) {
  p.yaw = input.yaw;
  p.pitch = input.pitch;
  if (!p.form) p.facing = p.yaw;
  const speed =
    (4.6 * seconds) / Math.max(1, Math.hypot(input.side, input.forward));
  const dx =
    (Math.cos(p.yaw) * input.side - Math.sin(p.yaw) * input.forward) * speed;
  const dz =
    (-Math.sin(p.yaw) * input.side - Math.cos(p.yaw) * input.forward) * speed;
  if (!dx && !dz) return;
  if (fits(p, p.x + dx, p.z)) p.x += dx;
  if (fits(p, p.x, p.z + dz)) p.z += dz;
}
export function fits(p: Player, x: number, z: number) {
  if (Math.abs(x) > 49 || Math.abs(z) > 44) return false;
  const b = body(p);
  const radius = Math.max(0.09, Math.min(0.75, Math.max(b.w, b.d) * 0.85));
  return !near(x, z).some((o) => {
    if (o.y + o.h < 0.075 || o.y - o.h >= 2 * b.h - 0.02) return false;
    const dx = x - o.x,
      dz = z - o.z,
      c = o.cosine,
      s = o.sine;
    return (
      Math.hypot(
        Math.max(0, Math.abs(dx * c - dz * s) - o.w),
        Math.max(0, Math.abs(dx * s + dz * c) - o.d),
      ) < radius
    );
  });
}
export function direction(yaw: number, pitch: number) {
  return [
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ];
}
export function intersect(origin: number[], dir: number[], o: Bounds) {
  const c = o.cosine,
    s = o.sine,
    x = origin[0] - o.x,
    z = origin[2] - o.z;
  const pos = [x * c - z * s, origin[1] - o.y, x * s + z * c];
  const ray = [dir[0] * c - dir[2] * s, dir[1], dir[0] * s + dir[2] * c],
    half = [o.w, o.h, o.d];
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
export function target(p: Player, players: Player[] = []) {
  const at = [p.x, eye(p), p.z],
    dir = direction(p.yaw, p.pitch);
  let distance = Infinity,
    prop = -1,
    id = "";
  for (const o of obstacles) {
    const d = intersect(at, dir, o);
    if (d < distance) {
      distance = d;
      prop = o.prop;
    }
  }
  for (const other of players) {
    if (other.id === p.id || other.hunter || !other.alive) continue;
    const d = intersect(at, dir, body(other));
    if (d < distance) {
      distance = d;
      id = other.id;
      prop = -1;
    }
  }
  return { distance, prop, id };
}
