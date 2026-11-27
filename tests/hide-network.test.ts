import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "colyseus.js";
import { startServer } from "../server/index.js";
import type { Snapshot } from "../shared/hide/world.js";

test("two clients agree on a completed walk when input is delayed and repeated", { timeout: 10000 }, async (t) => {
  const server = await startServer(0);
  const address = server.transport.server!.address();
  assert.ok(address && typeof address !== "string");
  const client = new Client("http://127.0.0.1:" + address.port);
  const rooms: Room[] = [];
  t.after(async () => {
    await Promise.allSettled(rooms.map(room => room.leave()));
    await server.gracefullyShutdown(false);
  });

  function observe(room: Room) {
    rooms.push(room);
    let latest: Snapshot | undefined;
    room.onMessage("view", (view: Snapshot) => { latest = view; });
    room.send("sync");
    return async (matches: (s: Snapshot) => boolean) => {
      for (let i = 0; i < 200; i++) {
        if (latest && matches(latest)) return latest;
        await wait(10);
      }
      return assert.fail("Timed out waiting for the expected movement snapshot");
    };
  }

  const hunter = await client.create("hide");
  const hunterView = observe(hunter);
  const hider = await client.joinById(hunter.roomId);
  const hiderView = observe(hider);
  await hunterView(v => v.players.length === 2);
  hunter.send("start");
  await hunterView(v => v.phase === "hide");
  // Skip the two-minute hiding period in this test server only.
  const game = matchMaker.getLocalRoomById(hunter.roomId) as unknown as { until: number };
  game.until = Date.now();
  const start = await hunterView(v => v.phase === "hunt");
  const player = (s: Snapshot) => s.players.find(p => p.id === hunter.sessionId)!;
  const command = { forward: 1, side: 0, yaw: player(start).yaw, pitch: 0 };
  const walk = { first: 1, inputs: Array(6).fill(command) };
  const stop = { ...command, forward: 0 };

  await wait(120);
  hunter.send("move", walk);
  hunter.send("move", walk);
  await wait(60);
  hunter.send("move", { first: 7, inputs: [stop] });
  const done = await hunterView(v => v.ack === 7);
  const distance = Math.hypot(player(done).x - player(start).x, player(done).z - player(start).z);
  assert.ok(Math.abs(distance - 0.46) < 1e-5, "six simulated steps at 4.6 m/s");
  const observed = await hiderView(v => v.now >= done.now + 200);
  assert.equal(player(observed).x, player(done).x);
  assert.equal(player(observed).z, player(done).z);
  assert.equal(observed.ack, 0, "each player receives only their own acknowledgement");
});
