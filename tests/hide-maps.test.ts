import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { Client, type Room } from "colyseus.js";
import { startServer } from "../server/index.js";
import { roomWorld, roundSpawn } from "../server/hide-worlds.js";
import { isMapId, mapNames } from "../shared/hide/maps.js";
import type { Player, Snapshot } from "../shared/hide/world.js";

const player = (id: string, hunter: boolean): Player => ({
  id, name: id, hunter, alive: true, online: true, x: 0, y: 0, z: 0,
  yaw: 0, pitch: 0, facing: 0, form: "", ammo: 6,
});

test("all four maps have space for eleven players on either side and a clear way out", () => {
  for (const id of Object.keys(mapNames)) {
    assert.ok(isMapId(id));
    const world = roomWorld(id);
    for (const hunter of [false, true]) {
      const placed: Player[] = [];
      for (let i = 0; i < 11; i++) {
        const p = player(String(i), hunter);
        Object.assign(p, roundSpawn(world, p, i, placed));
        assert.ok(world.fits(p, p.x, p.z, world.hiderColliders(p, placed)));
        const canLeave = Array.from({ length: 8 }, (_, n) => {
          const next = { ...p };
          const input = { yaw: n * Math.PI / 4, pitch: 0, forward: 1, side: 0 };
          for (let tick = 0; tick < 12; tick++) world.walk(next, input, 1 / 60);
          return Math.hypot(next.x - p.x, next.z - p.z) > 0.4;
        }).some(Boolean);
        assert.ok(canLeave, `${id} spawn ${i}`);
        placed.push(p);
      }
    }
    assert.ok(world.level.props.every(p => world.models[p.id]));
  }
});

test("hunters cross the house deck and return to ground without a jump", () => {
  const world = roomWorld("house"), p = player("hunter", true);
  p.x = -7; p.z = 11;
  const right = { forward: 0, side: 1, yaw: 0, pitch: 0 };
  for (let i = 0; i < 30; i++) world.walk(p, right, 1 / 60);
  assert.ok(p.x > -5.8);
  assert.ok((p.y ?? 0) > 0.14);
  for (let i = 0; i < 50; i++) world.walk(p, { ...right, side: -1 }, 1 / 60);
  assert.equal(p.y, 0);
});

test("map selection is independent per room, host-only, and locked during a round", { timeout: 12000 }, async t => {
  const server = await startServer(0);
  const address = server.transport.server!.address();
  assert.ok(address && typeof address !== "string");
  const api = new Client("http://127.0.0.1:" + address.port);
  const states = new Map<Room, Snapshot>();
  const clients: Room[] = [];
  function listen(r: Room) {
    clients.push(r);
    r.onMessage("view", (v: Snapshot) => states.set(r, v));
    r.send("sync");
    return r;
  }
  async function until(r: Room, condition: (s: Snapshot) => boolean) {
    for (let i = 0; i < 150; i++) {
      const view = states.get(r);
      if (view && condition(view)) return view;
      await wait(20);
    }
    assert.fail("Missing room state");
  }
  t.after(async () => {
    await Promise.allSettled(clients.map(r => r.leave()));
    await server.gracefullyShutdown(false);
  });
  const school = listen(await api.create("hide"));
  const house = listen(await api.create("hide"));
  const guest = listen(await api.joinById(school.roomId));
  await until(school, v => v.players.length === 2);
  guest.send("map", { id: "woods" });
  guest.send("role", { id: guest.sessionId, hunter: true });
  const afterGuestEdit = await until(school, v => v.players.every(p => p.hunter));
  assert.equal(afterGuestEdit.mapId, "office");
  guest.send("role", { id: guest.sessionId, hunter: false });
  school.send("map", { id: "school" });
  house.send("map", { id: "house" });
  await until(guest, v => v.mapId === "school");
  await until(house, v => v.mapId === "house");
  school.send("settings", { key: "hideSeconds", value: 1 });
  school.send("settings", { key: "huntSeconds", value: 1 });
  school.send("start");
  const hiding = await until(guest, v => v.phase === "hide");
  const p = hiding.players.find(p => !p.hunter)!;
  const spawn = roomWorld("school").level.spawns.props[0];
  assert.deepEqual([p.x, p.z], [spawn.at[0], spawn.at[2]]);
  school.send("map", { id: "woods" });
  assert.equal((await until(guest, v => v.phase === "hunt")).mapId, "school");
  await until(school, v => v.phase === "results");
  school.send("again");
  assert.equal((await until(school, v => v.phase === "lobby")).mapId, "school");
  school.send("map", { id: "woods" });
  await until(guest, v => v.mapId === "woods");
  assert.equal(states.get(house)?.mapId, "house");
});
