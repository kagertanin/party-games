import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { FoundEffect, ShotEffects, foundView, pistolArm } from "../src/hide/shots";
import { revealDuration, type Shot } from "../shared/hide/shot";
import { target, type Player } from "../shared/hide/world";

test("the caught bottle on the kitchen table stays in a clear, centered shot", () => {
  const bottle: Player = { id: "bottle", name: "", hunter: false, alive: false, online: true,
    x: 7.7, y: 0.843, z: 11.88, form: "food_soda_bottle", facing: 0, yaw: 0, pitch: -0.285, ammo: 0 };
  const { position, focus } = foundView(bottle, bottle.yaw);
  const ray = focus.clone().sub(position);
  const distance = ray.length();
  assert.ok(distance > 1);
  ray.normalize();
  const observer = { ...bottle, id: "observer", form: "", x: position.x, y: position.y - 1.72 * 0.875,
    z: position.z, yaw: Math.atan2(-ray.x, -ray.z), pitch: Math.asin(ray.y) };
  assert.equal(target(observer, [{ ...bottle, alive: true }]).id, bottle.id);
});

test("a shot travels from the animated muzzle and removes its mesh after impact", () => {
  const scene = new T.Scene();
  const { arm, muzzle } = pistolArm();
  arm.position.set(2, 1.22, 3);
  arm.rotation.set(0.28, -0.6, 0, "YXZ");
  scene.add(arm);
  const event: Shot = { shooter: "hunter", hit: "", origin: [2, 1.5, 3], end: [4, 2, -2], impact: true };
  const effects = new ShotEffects(scene);
  effects.show(event, muzzle, 100);
  effects.update(100);
  assert.deepEqual(scene.getObjectByName("muzzle-flash")!.position.toArray(), muzzle.getWorldPosition(new T.Vector3()).toArray());
  const tracer = scene.getObjectByName("shot-tracer")!;
  assert.equal(tracer.visible, true);
  const initial = tracer.position.clone();
  effects.update(180);
  assert.ok(tracer.position.distanceTo(initial) > 1);
  assert.equal(tracer.visible, true);
  effects.update(350);
  assert.deepEqual(scene.children, [arm]);
});

test("each found model emits for 3.5 seconds, then pulses without changing identical scenery", () => {
  const material = new T.MeshBasicMaterial({ color: 0x227733 });
  const original = new T.Mesh(new T.BoxGeometry(), material);
  const victim = original.clone();
  const model = new T.Group().add(victim);
  const effect = new FoundEffect(model, 1);
  effect.update(1500);
  const drops = model.getObjectByName("hit-droplets")!;
  assert.equal(drops.visible, true);
  assert.equal(victim.material, material);
  effect.update(revealDuration);
  assert.equal(drops.visible, false);
  assert.notEqual(victim.material, material);
  assert.equal(original.material, material);
  effect.update(revealDuration + 400);
  assert.equal(victim.material, material);
  effect.dispose();
  assert.deepEqual(model.children, [victim]);
});
