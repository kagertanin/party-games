import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "colyseus.js";
import { startServer } from "../server/index.js";
import { defaultHideSettings } from "../shared/hide/settings.js";
import type { Snapshot } from "../shared/hide/world.js";

test("host configures both timers and a finite per-hunter shot allowance", { timeout: 10000 }, async (t) => {
  const server = await startServer(0);
  const address = server.transport.server!.address();
  assert.ok(address && typeof address !== "string");
  const api = new Client("http://127.0.0.1:" + address.port);
  const clients: Room[] = [];
  const views = new Map<Room, Snapshot>();
  t.after(async () => {
    await Promise.allSettled(clients.map(r => r.leave()));
    await server.gracefullyShutdown(false);
  });
  function watch(r: Room) {
    clients.push(r);
    r.onMessage("view", (view: Snapshot) => views.set(r, view));
    r.onMessage("feedback", () => {});
    r.onMessage("shot", () => {});
    r.send("sync");
    return r;
  }
  async function until(room: Room, check: (view: Snapshot) => boolean) {
    for (let i = 0; i < 180; i++) {
      const view = views.get(room);
      if (view && check(view)) return view;
      await wait(20);
    }
    assert.fail("Expected settings, phase or shot allowance not received");
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

  const aim = { forward: 0, side: 0, yaw: 0, pitch: 1.45 };
  host.send("use", { aim });
  const afterMiss = await until(hider, v => v.players.find(p => p.id === host.sessionId)?.ammo === 0);
  assert.equal(afterMiss.phase, "hunt");
  assert.equal(afterMiss.players.find(p => p.id === hunter.sessionId)?.ammo, 1);
  hunter.send("use", { aim });
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
