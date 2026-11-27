import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import type { Shot } from "../shared/hide/shot";
import { Client, type Room } from "colyseus.js";
import { matchMaker } from "@colyseus/core";
import { startServer } from "../server/index.js";
import {
  office,
  models,
  copyRange,
  target,
  eye,
  type Snapshot,
  type Player,
} from "../shared/hide/world.js";

test("Brightline Offices has all models and a copyable object at the hider entrance", () => {
  for (const obj of office.props) assert.ok(models[obj.id]);
  const me: Player = {
    id: "a",
    name: "A",
    hunter: false,
    alive: true,
    online: true,
    x: -14,
    z: 6,
    yaw: 0,
    pitch: 0,
    facing: 0,
    form: "",
    ammo: 6,
  };
  const bin = office.props.find(
    (p) => p.at[0] === -12.5 && p.id === "furniture_trashcan",
  )!;
  const dx = bin.at[0] - me.x,
    dz = bin.at[2] - me.z;
  me.yaw = Math.atan2(-dx, -dz);
  me.pitch = Math.atan2(
    models[bin.id].size[1] / 2 - eye(me),
    Math.hypot(dx, dz),
  );
  assert.equal(office.props[target(me).prop].id, bin.id);
  // Both sides of the nearby grid-cell boundary must see the same prop as
  // a full-length ray; the reticle and copy action use this shorter query.
  for (const x of [-16.01, -15.99, -14]) {
    me.x = x;
    me.yaw = Math.atan2(me.x - bin.at[0], me.z - bin.at[2]);
    me.pitch = Math.atan2(models[bin.id].size[1] / 2 - eye(me), Math.hypot(me.x - bin.at[0], me.z - bin.at[2]));
    const full = target(me);
    assert.ok(full.distance <= copyRange);
    assert.deepEqual(target(me, [], copyRange), full);
  }
});
test(
  "twelve clients can play eleven against one, copy, shoot and replay",
  { timeout: 15000 },
  async (t) => {
    const server = await startServer(0),
      address = server.transport.server!.address()!;
    assert.ok(typeof address !== "string");
    const client = new Client("http://127.0.0.1:" + address.port);
    const rooms: Room[] = [],
      states = new Map<Room, Snapshot>();
    t.after(async () => {
      await Promise.allSettled(rooms.map((r) => r.leave()));
      await server.gracefullyShutdown(false);
    });
    const shots = new Map<Room, Shot[]>();
    function listen(r: Room) {
      const log: Shot[] = [];
      shots.set(r, log);
      r.onMessage("shot", (event: Shot) => log.push(event));
      rooms.push(r);
      r.onMessage("view", (v: Snapshot) => states.set(r, v));
      r.onMessage("feedback", () => {});
      r.send("sync");
      return r;
    }
    const host = listen(await client.create("hide", { name: "Ведущий" }));
    for (let i = 1; i < 12; i++)
      listen(await client.joinById(host.roomId, { name: "Участник " + i }));
    const hider = rooms[11];
    async function until(r: Room, f: (s: Snapshot) => boolean) {
      for (let i = 0; i < 120; i++) {
        const s = states.get(r);
        if (s && f(s)) return s;
        await wait(20);
      }
      assert.fail("Missing expected phase/action for " + r.sessionId);
    }
    for (const r of rooms.slice(1, 11))
      host.send("role", { id: r.sessionId, hunter: true });
    await until(host, (s) => s.players.filter((p) => p.hunter).length === 11);
    host.send("start");
    const hidden = await until(host, (s) => s.phase === "hide");
    assert.equal(hidden.players.length, 11);
    assert.ok(hidden.until - hidden.now > 59000 && hidden.until - hidden.now <= 60000);
    const me = (await until(hider, (s) => s.phase === "hide")).players.find(
      (p) => p.id === hider.sessionId,
    )!;
    const dx = -12.5 - me.x,
      dz = 6.8 - me.z;
    hider.send("input", {
      forward: 0,
      side: 0,
      yaw: Math.atan2(-dx, -dz),
      pitch: Math.atan2(
        models.furniture_trashcan.size[1] / 2 - eye(me),
        Math.hypot(dx, dz),
      ),
    });
    hider.send("use");
    await until(hider, (s) =>
      s.players.some((p) => p.form === "furniture_trashcan"),
    );
    // Shorten the wall clock and stage a clear line of sight in this test process only.
    const game = matchMaker.getLocalRoomById(host.roomId) as unknown as {
      until: number;
      players: Map<string, Player>;
    };
    game.until = Date.now();
    const hunt = await until(host, (s) => s.phase === "hunt");
    assert.ok(hunt.until - hunt.now > 299000);
    const hunter = game.players.get(host.sessionId)!,
      hiddenPlayer = game.players.get(hider.sessionId)!;
    hunter.x = 0;
    hunter.z = -32;
    hiddenPlayer.x = 0;
    hiddenPlayer.z = -35;
    host.send("input", { forward: 0, side: 0, yaw: Math.PI, pitch: 0 });
    host.send("use");
    await until(
      host,
      (s) => s.players.find((p) => p.id === host.sessionId)?.ammo === 5,
    );
    assert.equal(shots.get(host)!.length, 1);
    assert.deepEqual(shots.get(hider), shots.get(host));
    assert.equal(shots.get(host)![0].hit, "");
    await wait(350);
    host.send("input", {
      forward: 0,
      side: 0,
      yaw: 0,
      pitch: Math.atan2(models.furniture_trashcan.size[1] / 2 - eye(hunter), 3),
    });
    host.send("use");
    const result = await until(host, (s) => s.phase === "results");
    await until(hider, s => s.phase === "results");
    for (const participant of [hider, host]) {
      const log = shots.get(participant)!;
      assert.equal(log.length, 2);
      assert.equal(log[1].hit, hider.sessionId);
      assert.equal(log[1].shooter, host.sessionId);
      assert.equal(log[1].impact, true);
      assert.ok(log[1].end.every(Number.isFinite));
    }
    const found = result.players.find(p => p.id === hider.sessionId)!;
    assert.equal(found.alive, false);
    assert.equal(found.form, "furniture_trashcan");
    assert.ok(found.foundAt && result.now >= found.foundAt);
    assert.equal(result.winner, "Водящие");
    assert.equal(result.players.find((p) => p.id === host.sessionId)?.ammo, 4);
    host.send("again");
    await until(host, (s) => s.phase === "lobby");
  },
);

test("movement resumes at the last acknowledgement after reconnecting mid-round", { timeout: 10000 }, async (t) => {
  const server = await startServer(0);
  const address = server.transport.server!.address()!;
  assert.ok(typeof address !== "string");
  const client = new Client("http://127.0.0.1:" + address.port);
  const rooms: Room[] = [];
  const states = new Map<Room, Snapshot>();
  t.after(async () => {
    await Promise.allSettled(rooms.map(room => room.leave()));
    await server.gracefullyShutdown(false);
  });
  function listen(room: Room) {
    rooms.push(room);
    room.onMessage("view", state => states.set(room, state));
    room.send("sync");
    return room;
  }
  async function viewWhen(room: Room, check: (state: Snapshot) => boolean) {
    for (let i = 0; i < 200; i++) {
      const state = states.get(room);
      if (state && check(state)) return state;
      await wait(10);
    }
    assert.fail("Timed out waiting for movement state");
  }

  const host = listen(await client.create("hide"));
  const guest = listen(await client.joinById(host.roomId));
  host.send("start");
  await viewWhen(guest, s => s.phase === "hide");
  const oneStep = { side: 1, forward: 0, yaw: 0, pitch: 0 };
  guest.send("move", { first: 1, inputs: [oneStep, oneStep, oneStep] });
  const before = await viewWhen(guest, s => s.ack === 3);
  const token = guest.reconnectionToken;
  const game = matchMaker.getLocalRoomById(host.roomId) as unknown as { until: number };
  game.until = Date.now();
  await viewWhen(host, s => s.phase === "hunt");
  guest.connection.close();
  await viewWhen(host, s => s.players.some(p => p.id === guest.sessionId && !p.online));
  rooms.splice(rooms.indexOf(guest), 1);
  const resumed = listen(await client.reconnect(token));
  assert.equal(resumed.sessionId, guest.sessionId);
  const after = await viewWhen(resumed, s => s.ack === 3);
  const x = (s: Snapshot) => s.players.find(p => p.id === resumed.sessionId)!.x;
  assert.equal(x(before), x(after));
  resumed.send("move", { first: 4, inputs: [oneStep] });
  const moved = await viewWhen(resumed, s => s.ack === 4);
  assert.ok(Math.abs(x(moved) - x(before) - 4.6 / 60) < 1e-8);
});
