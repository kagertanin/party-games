import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalMotion, RemoteMotion } from "../src/hide/motion.js";
import { STEP_SECONDS } from "../shared/hide/movement.js";
import { walk, type Input, type Player, type Snapshot } from "../shared/hide/world.js";

const forward: Input = { side: 0, forward: 1, yaw: 0, pitch: 0 };
const idle: Input = { ...forward, forward: 0 };

function player(): Player {
  return { id: "hider", name: "Hider", alive: true, online: true, hunter: false,
    x: 0, z: -32, yaw: 0, pitch: 0, facing: 0, form: "", ammo: 6 };
}

function snapshot(p: Player, now: number): Snapshot {
  return { players: [{ ...p }], now, ack: 0, phase: "hunt", host: "", remaining: 1,
    until: 500000, winner: "" };
}

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
}

test("delayed acknowledgements never reverse predicted walking or restart it after release", () => {
  const server = player();
  const motion = new LocalMotion(server);
  const history = [{ ...server }];
  let previousZ = server.z;
  let next = 1;
  for (let tick = 1; tick <= 60; tick++) {
    const input = tick <= 30 ? forward : idle;
    motion.advance(input, STEP_SECONDS);
    walk(server, input, STEP_SECONDS);
    history.push({ ...server });
    if (tick % 3 === 0) {
      const batch = motion.takeBatch()!;
      assert.equal(batch.first, next);
      assert.equal(batch.inputs.length, 3);
      next += 3;
    }
    // Server snapshots lag the local simulation by 200 ms and do not
    // arrive at even intervals. An authoritative correction to raw x/z
    // would drag the camera backwards throughout the first 30 ticks.
    if (tick >= 12 && (tick % 5 === 0 || tick % 7 === 0)) {
      const ack = tick - 12;
      motion.reconcile(history[ack], ack);
      motion.reconcile(history[Math.max(0, ack - 2)], Math.max(0, ack - 2));
    }
    const pose = motion.pose(input);
    close(pose.z, server.z);
    assert.ok(pose.z <= previousZ + 1e-10);
    if (tick > 30) close(pose.z, previousZ);
    previousZ = pose.z;
  }
  close(server.z, -34.3);
});

test("first frame moves before a complete tick and reconnect starts at the server acknowledgement", () => {
  const state = player();
  const motion = new LocalMotion(state, 87);
  motion.advance(forward, STEP_SECONDS / 2);
  close(motion.pose(forward).z, state.z - 4.6 * STEP_SECONDS / 2);
  assert.equal(motion.takeBatch(), undefined);
  motion.advance(forward, STEP_SECONDS / 2);
  assert.equal(motion.takeBatch()!.first, 88);
  walk(state, forward, STEP_SECONDS);
  motion.reconcile(state, 88);
  motion.advance(idle, STEP_SECONDS);
  close(motion.pose(idle).z, state.z);
  assert.equal(motion.takeBatch()!.first, 89);
});

test("remote players move between unevenly delivered snapshots and the playhead never rewinds", () => {
  const buffer = new RemoteMotion();
  const p = player();
  const stamp = 8000;
  const arrival = [0, 110, 185, 320, 395, 510, 585, 720, 795, 912, 1000];
  let received = 0;
  let lastZ = p.z;
  let lastTime = -Infinity;
  for (let now = 0; now <= 1000; now += 10) {
    while (received < arrival.length && arrival[received] <= now) {
      p.z = -32 - 0.46 * received;
      buffer.push(snapshot(p, stamp + 100 * received), now);
      received++;
    }
    const time = buffer.at(now);
    const pose = buffer.pose(p, time);
    assert.ok(time >= lastTime);
    assert.ok(pose.z <= lastZ + 1e-10);
    if (now >= 200) {
      // Render frames move even if no packet arrived. A new batch of packets
      // cannot cause an entire snapshot's displacement on one frame.
      assert.ok(lastZ - pose.z > 0.035 && lastZ - pose.z < 0.055);
    }
    lastZ = pose.z;
    lastTime = time;
  }
  close(buffer.pose(p, buffer.at(2500)).z, p.z);
});

test("releasing WASD partway through a tick at 144 Hz never moves the camera backward", () => {
  const start = player();
  const motion = new LocalMotion(start);
  let lastZ = start.z;
  for (let frame = 1; frame <= 24; frame++) {
    const input = frame <= 3 ? forward : idle;
    motion.advance(input, 1 / 144);
    const { z } = motion.pose(input);
    assert.ok(z <= lastZ + 1e-10);
    lastZ = z;
  }
  close(lastZ, start.z - 2 * STEP_SECONDS * 4.6);
});

test("holding WASD against a boundary does not alternate between two camera positions", () => {
  const start = { ...player(), z: -43.96 };
  const motion = new LocalMotion(start);
  for (let frame = 0; frame < 60; frame++) {
    motion.advance(forward, 1 / 144);
    close(motion.pose(forward).z, start.z);
  }
});

test("a burst of old snapshots after a stalled tab does not add a second of playback lag", () => {
  const remote = new RemoteMotion();
  const p = player();
  const start = 8000;
  remote.push(snapshot(p, start), 0);
  remote.at(1000);
  // Main thread rendered before socket callbacks drained a 900 ms backlog.
  for (let n = 1; n <= 9; n++) {
    p.x = n * 0.46;
    remote.push(snapshot(p, start + 100 * n), 1000);
  }
  const time = remote.at(1010);
  assert.ok(time >= start + 900 - 125);
  const shown = remote.pose(p, time);
  assert.ok(p.x - shown.x < 0.6);
});
