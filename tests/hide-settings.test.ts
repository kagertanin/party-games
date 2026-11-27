import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "colyseus.js";
import { startServer } from "../server/index.js";
import { defaultHideSettings } from "../shared/hide/settings.js";
import { eye, models, office, target, type Snapshot } from "../shared/hide/world.js";
import type { Shot } from "../shared/hide/shot.js";

test("hunters keep their lives when shooting scenery and lose one for a copyable prop", { timeout: 10000 }, async (t) => {
  const server = await startServer(0);
  const address = server.transport.server!.address();
  assert.ok(address && typeof address !== "string");
  const api = new Client("http://127.0.0.1:" + address.port);
  const clients: Room[] = [];
  const views = new Map<Room, Snapshot>();
  const shots = new Map<Room, Shot[]>();
  t.after(async () => {
    await Promise.allSettled(clients.map(r => r.leave()));
    await server.gracefullyShutdown(false);
  });
  function watch(r: Room) {
    clients.push(r);
    r.onMessage("view", (view: Snapshot) => views.set(r, view));
    r.onMessage("feedback", () => {});
    const events: Shot[] = [];
    shots.set(r, events);
    r.onMessage("shot", (shot: Shot) => events.push(shot));
    r.send("sync");
    return r;
  }
  async function until(room: Room, check: (view: Snapshot) => boolean) {
    for (let i = 0; i < 180; i++) {
      const view = views.get(room);
      if (view && check(view)) return view;
      await wait(20);
    }
    assert.fail("Expected settings, phase or hunter lives not received");
  }

  const host = watch(await api.create("hide"));
  const hunter = watch(await api.joinById(host.roomId));
  const hider = watch(await api.joinById(host.roomId));
  const lobby = await until(host, v => v.players.length === 3);
  assert.deepEqual(lobby.settings, defaultHideSettings);

  // A subsequent valid update is the ordering barrier for rejected edits on the same connection.
  hunter.send("settings", { key: "shotsPerHunter", value: 91 });
  hunter.send("role", { id: hunter.sessionId, hunter: true });
  const roles = await until(host, v => v.players.filter(p => p.hunter).length === 2);
  assert.equal(roles.settings.shotsPerHunter, 6);
  host.send("settings", { key: "huntSeconds", value: 3601 });
  host.send("settings", { key: "shotsPerHunter", value: 0 });
  host.send("settings", { key: "hideSeconds", value: 1 });
  const edited = await until(hider, v => v.settings.hideSeconds === 1);
  assert.equal(edited.settings.huntSeconds, 300);
  assert.equal(edited.settings.shotsPerHunter, 6);
  host.send("settings", { key: "huntSeconds", value: 45 });
  host.send("settings", { key: "shotsPerHunter", value: 1 });
  host.send("start");
  const hiding = await until(hider, v => v.phase === "hide");
  assert.ok(hiding.until - hiding.now > 0 && hiding.until - hiding.now <= 1000);
  assert.ok(hiding.players.filter(p => p.hunter).every(p => p.ammo === 1));
  host.send("settings", { key: "huntSeconds", value: 17 });
  const hunting = await until(host, v => v.phase === "hunt");
  assert.equal(hunting.settings.huntSeconds, 45);
  assert.ok(hunting.until - hunting.now > 44000 && hunting.until - hunting.now <= 45000);

  // A shot at open sky and another at the office wall both produce a visible
  // shot for the other clients without using up the hunter's last life.
  host.send("use", { aim: { forward: 0, side: 0, yaw: 0, pitch: 1.45 } });
  await until(hider, () => shots.get(hider)!.length === 1);
  assert.equal(shots.get(hider)![0].impact, false);
  await wait(260);
  host.send("use", { aim: { forward: 0, side: 0, yaw: Math.PI, pitch: 0 } });
  const afterWall = await until(hider, () => shots.get(hider)!.length === 2);
  assert.equal(shots.get(hider)![1].impact, true);
  assert.equal(afterWall.players.find(p => p.id === host.sessionId)?.ammo, 1);

  const bench = office.props.find(p => p.id === "furniture_bench" && p.at[0] === -6 && p.at[2] === -20)!;
  function aimAtBench(r: Room) {
    const p = hunting.players.find(p => p.id === r.sessionId)!;
    const dx = bench.at[0] - p.x, dz = bench.at[2] - p.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(bench.at[1] + models[bench.id].size[1] / 2 - eye(p), Math.hypot(dx, dz));
    assert.equal(office.props[target({ ...p, yaw, pitch }).prop], bench);
    return { forward: 0, side: 0, yaw, pitch };
  }
  await wait(260);
  host.send("use", { aim: aimAtBench(host) });
  const afterMiss = await until(hider, v => v.players.find(p => p.id === host.sessionId)?.ammo === 0);
  assert.equal(afterMiss.phase, "hunt");
  assert.equal(afterMiss.players.find(p => p.id === hunter.sessionId)?.ammo, 1);
  hunter.send("use", { aim: aimAtBench(hunter) });
  const done = await until(hider, v => v.phase === "results");
  assert.equal(done.winner, "Прячущиеся");
  assert.ok(done.players.filter(p => p.hunter).every(p => p.ammo === 0));
  host.send("again");
  const next = await until(host, v => v.phase === "lobby");
  assert.deepEqual(next.settings, { hideSeconds: 1, huntSeconds: 45, shotsPerHunter: 1 });
  host.send("start");
  const nextRound = await until(hider, v => v.phase === "hide");
  assert.ok(nextRound.players.filter(p => p.hunter).every(p => p.ammo === 1));

  // Expire on a non-broadcast tick. Once the room is in results the simulation
  // stops, so every connected client needs to see the terminal snapshot now.
  await until(host, v => v.phase === "hunt");
  const game = matchMaker.getLocalRoomById(host.roomId) as unknown as { until: number; ticks: number };
  game.ticks = 0;
  game.until = Date.now();
  for (const client of clients) {
    const result = await until(client, v => v.phase === "results");
    assert.equal(result.winner, "Прячущиеся");
    assert.equal(result.until, 0);
  }
});
