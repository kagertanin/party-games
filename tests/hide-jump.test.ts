import assert from "node:assert/strict";
import { test } from "node:test";
import { walk, eye, target, models, cameraDistance, type Player, type Input } from "../shared/hide/world.js";
import { STEP_SECONDS } from "../shared/hide/movement.js";
import { LocalMotion } from "../src/hide/motion.js";

const idle: Input = { forward: 0, side: 0, pitch: 0, yaw: 0 };

function player(x: number, z: number): Player {
  return { id: "hider", name: "Hider", hunter: false, alive: true, online: true,
    x, z, yaw: 0, pitch: 0, facing: 0, form: "", ammo: 6 };
}

test("holding space produces one modest jump, and hunters stay grounded", () => {
  const hider = player(0, -32), hunter = { ...hider, hunter: true };
  let peak = 0;
  for (let i = 0; i < 100; i++) {
    walk(hider, { ...idle, jump: 1 }, STEP_SECONDS);
    walk(hunter, { ...idle, jump: 1 }, STEP_SECONDS);
    peak = Math.max(peak, hider.y ?? 0);
  }
  assert.ok(peak > 0.75 && peak < 0.85);
  assert.equal(hider.y, 0);
  assert.equal(hunter.y ?? 0, 0);
});

test("a bottle chains jumps to land on a real desk, then walks off and falls", () => {
  const p = { ...player(-1.55, -9.45), form: "food_soda_bottle" };
  const prediction = new LocalMotion(p);
  const history = [{ ...p }];
  for (let tick = 1; tick <= 100; tick++) {
    const input = { ...idle, jump: tick < 19 ? 1 : 2, forward: tick >= 21 && tick <= 41 ? 1 : 0 };
    walk(p, input, STEP_SECONDS);
    prediction.advance(input, STEP_SECONDS);
    if (tick % 3 === 0) prediction.takeBatch();
    history.push({ ...p });
    if (tick > 12 && tick % 6 === 0) prediction.reconcile(history[tick - 12], tick - 12);
    assert.ok(Math.abs((p.y ?? 0) - (prediction.pose(input).y ?? 0)) < 1e-7);
  }
  assert.equal(p.y, models.furniture_desk.size[1]);
  assert.ok(Math.abs(p.z + 11.06) < 0.001);
  for (let i = 0; i < 90; i++) walk(p, { ...idle, forward: i < 22 ? -1 : 0 }, STEP_SECONDS);
  assert.equal(p.y, 0);
});

test("new presses can boost a hider repeatedly outdoors, solid office ceilings block the head", () => {
  const inside = player(-14, 6);
  const outside = player(0, -32);
  let highest = 0;
  for (let i = 0; i < 86; i++) {
    const input = { ...idle, jump: Math.floor(i / 8) + 1 };
    walk(inside, input, STEP_SECONDS);
    walk(outside, input, STEP_SECONDS);
    highest = Math.max(highest, inside.y ?? 0);
  }
  assert.ok(Math.abs(highest + 1.72 - 3.2) < 1e-6);
  assert.ok((outside.y ?? 0) > 5);
  const hunter = { ...player(0, -30), hunter: true, id: "hunter" };
  assert.equal(target(hunter, [outside]).id, "");
  hunter.pitch = Math.atan2(eye(outside) - eye(hunter), 2);
  assert.equal(target(hunter, [outside]).id, outside.id);
});

test("camera collision clears the near plane below the office ceiling", () => {
  const clearance = cameraDistance([-14, 2.7, 6], [0, 1, 0]);
  assert.ok(clearance > 0.35 && clearance < 0.41);
});
