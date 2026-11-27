import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { Client, type Room } from "colyseus.js";
import { matchMaker } from "@colyseus/core";
import { startServer } from "../server/index.js";
import { Footsteps, SoundWalls } from "../src/hide/acoustics.js";
import type { Point } from "../shared/hide/shot.js";
import type { Player, Snapshot } from "../shared/hide/world.js";

test("sound travels through the opening, and loses high frequencies behind walls", () => {
  const walls = new SoundWalls([
    { at: [0, 1.5, 0], size: [4, 3, .2] },
    { at: [0, 1.5, 5], size: [4, 3, .2] },
    { at: [0, 1.5, -1], size: [6, 3, .1], solid: false },
  ]);
  assert.equal(walls.between([0, 1, -2], [0, 1, 3], 5), 1);
  assert.equal(walls.between([0, 1, -2], [0, 1, 6], 8), 2);
  assert.equal(walls.between([3, 1, -2], [3, 1, 6], 8), 0);
  assert.equal(walls.between([0, 1, -2], [0, 1, -.1], 1.9), 0);
});

test("only actual ground travel produces steps; one jump press produces one launch cue", () => {
  const p: Player = { id: "moving", hunter: false, name: "", alive: true, online: true,
    x: 0, z: 0, y: 0, yaw: 0, pitch: 0, facing: 0, form: "", ammo: 6 };
  const stride = new Footsteps();
  assert.equal(stride.sample(p, 0), undefined);
  assert.equal(stride.sample(p, 100), undefined);
  for (let i = 1; i <= 3; i++) { p.x += .4; assert.equal(stride.sample(p, 100 + i * 100), undefined); }
  p.x += .4;
  assert.equal(stride.sample(p, 500), "stepB");
  p.lastJump = 1; p.vy = 2;
  assert.equal(stride.sample(p, 600), "jump");
  for (let i = 1; i <= 5; i++) { p.x += .4; assert.equal(stride.sample(p, 600 + 100 * i), undefined); }
  p.vy = 0; p.x = 32;
  assert.equal(stride.sample(p, 1200), undefined);
  p.alive = false; p.lastJump++;
  assert.equal(stride.sample(p, 1300), undefined);
});

test("taunts use the hider's server position, respect concealment and reject repeats", { timeout: 10000 }, async t => {
  const server = await startServer(0);
  const address = server.transport.server!.address();
  assert.ok(address && typeof address !== "string");
  const net = new Client("http://127.0.0.1:" + address.port);
  const rooms: Room[] = [];
  t.after(async () => {
    await Promise.allSettled(rooms.map(r => r.leave()));
    await server.gracefullyShutdown(false);
  });
  function follow(room: Room) {
    rooms.push(room);
    const cries: Point[] = [];
    let view: Snapshot | undefined;
    room.onMessage("view", (v: Snapshot) => { view = v; });
    room.onMessage("taunt", (point: Point) => cries.push(point));
    room.send("sync");
    return { room, cries, view: () => view };
  }
  async function until(check: () => unknown) {
    for (let i = 0; i < 250; i++) {
      if (check()) return;
      await wait(8);
    }
    assert.fail("Missing expected room event");
  }
  const hunter = follow(await net.create("hide"));
  const first = follow(await net.joinById(hunter.room.roomId));
  const second = follow(await net.joinById(hunter.room.roomId));
  await until(() => second.view()?.phase === "lobby");
  first.room.send("taunt");
  hunter.room.send("start");
  await until(() => first.view()?.phase === "hide");
  first.room.send("taunt", [999, 999, 999]);
  first.room.send("taunt");
  await until(() => second.cries.length);
  const actor = first.view()!.players.find(p => p.id === first.room.sessionId)!;
  assert.equal(second.cries[0][0], actor.x);
  assert.equal(second.cries[0][2], actor.z);
  assert.ok(second.cries[0][1] < 3 && second.cries[0][1] > 0);
  assert.deepEqual(first.cries, second.cries);
  assert.equal(hunter.cries.length, 0);
  const live = matchMaker.getLocalRoomById(hunter.room.roomId) as unknown as {
    until: number; players: Map<string, Player>; tauntAt: Map<string, number>;
  };
  live.until = Date.now();
  await until(() => hunter.view()?.phase === "hunt");
  hunter.room.send("taunt");
  second.room.send("taunt");
  await until(() => first.cries.length === 2 && hunter.cries.length === 1);
  // A caught player cannot continue guiding a hunter to their previous spot.
  live.players.get(first.room.sessionId)!.alive = false;
  live.tauntAt.delete(first.room.sessionId);
  const stamp = hunter.view()!.now;
  first.room.send("taunt");
  await until(() => (hunter.view()?.now ?? 0) > stamp + 150);
  assert.equal(first.cries.length, 2);
  assert.equal(second.cries.length, 2);
  assert.equal(hunter.cries.length, 1);
});
