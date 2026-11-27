import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "colyseus.js";
import { startServer } from "../server/index.js";
import { STEP_SECONDS } from "../shared/hide/movement.js";
import { eye, fits, hiderColliders, models, walk, type Player, type Snapshot } from "../shared/hide/world.js";
import { LocalMotion } from "../src/hide/motion.js";

const idle = { side: 0, forward: 0, yaw: 0, pitch: 0 };
const right = { ...idle, side: 1 };

function chair(id: string, x: number): Player {
  return { id, name: id, x, z: -32, y: 0, yaw: 0, pitch: 0, facing: 0,
    alive: true, online: true, hunter: false, form: "furniture_lounge_chair", ammo: 6 };
}

test("two chairs stop side by side even under delayed server acknowledgements", () => {
  const mover = chair("mover", -2);
  const other = chair("other", 0);
  const peers = [mover, other];
  const prediction = new LocalMotion(mover, 0, peers);
  const states = [{ ...mover }];
  for (let tick = 1; tick <= 90; tick++) {
    walk(mover, right, STEP_SECONDS, hiderColliders(mover, peers));
    prediction.advance(right, STEP_SECONDS);
    states.push({ ...mover });
    if (tick % 3 === 0) prediction.takeBatch();
    if (tick >= 12 && tick % 6 === 0) prediction.reconcile(states[tick - 12], tick - 12, peers);
    assert.equal(prediction.pose(right).x, mover.x);
  }
  const width = models[mover.form].size[0];
  assert.ok(other.x - mover.x >= width && other.x - mover.x < width + 4.6 * STEP_SECONDS);
  const left = { ...idle, side: -1 };
  for (let i = 0; i < 60; i++) walk(other, left, STEP_SECONDS, hiderColliders(other, peers));
  assert.equal(other.x, 0);
});

test("a jumping chair lands on the other chair and falls after its support walks away", () => {
  const bottom = chair("bottom", 0);
  const top = chair("top", -1.2);
  const peers = [bottom, top];
  for (let i = 0; i < 120; i++) {
    const input = { ...idle, jump: i < 15 ? 1 : 2, side: i < 40 ? 1 : 0 };
    walk(top, input, STEP_SECONDS, hiderColliders(top, peers));
  }
  assert.ok(Math.abs(top.x - bottom.x) < models[bottom.form].size[0] / 2);
  assert.equal(top.y, models[bottom.form].size[1]);
  walk(bottom, { ...idle, jump: 1 }, STEP_SECONDS, hiderColliders(bottom, peers));
  assert.ok(Math.abs(bottom.y!) < 1e-8, "a player cannot jump through someone resting above them");
  for (let i = 0; i < 90; i++) {
    walk(bottom, right, STEP_SECONDS, hiderColliders(bottom, peers));
    walk(top, idle, STEP_SECONDS, hiderColliders(top, peers));
  }
  assert.equal(top.y, 0);
});

test("a correction does not visually slide back through a newly arrived chair", () => {
  const mover = chair("mover", -1.2);
  const prediction = new LocalMotion(mover);
  prediction.advance(right, 6 * STEP_SECONDS);
  prediction.takeBatch();
  assert.ok(prediction.pose(right).x > -1);
  prediction.reconcile(mover, 6, [mover, chair("arriving", 0)]);
  assert.equal(prediction.pose(right).x, mover.x);
});

test("disguise collision uses a rotated prop's full dimensions and stops tiny moving props", () => {
  const sofa = { ...chair("sofa", 0), form: "furniture_lounge_design_sofa", facing: Math.PI / 2 };
  const guest = { ...chair("guest", 0), form: "food_soda_bottle", z: -33.4 };
  const colliders = hiderColliders(guest, [sofa, guest]);
  assert.equal(fits(guest, guest.x, guest.z, colliders), true);
  assert.equal(fits({ ...guest, form: "furniture_lounge_chair" }, guest.x, guest.z, colliders), false);
  assert.equal(fits(guest, 0.6, sofa.z, colliders), true);
  assert.equal(hiderColliders({ ...guest, hunter: true }, [sofa]).length, 0);
  const bottle = { ...guest, id: "other-bottle", x: -0.2 };
  walk(bottle, right, 0.1, hiderColliders(bottle, [guest]));
  assert.ok(bottle.x < guest.x && guest.x - bottle.x >= models[guest.form].size[0]);
});

test("office clients cannot walk or copy a larger disguise through another hider", { timeout: 10000 }, async t => {
  const server = await startServer(0);
  const address = server.transport.server!.address();
  assert.ok(address && typeof address !== "string");
  const api = new Client("http://127.0.0.1:" + address.port);
  const rooms: Room[] = [];
  t.after(async () => {
    await Promise.allSettled(rooms.map(room => room.leave()));
    await server.gracefullyShutdown(false);
  });
  const views = new Map<Room, Snapshot>();
  function watch(room: Room) {
    rooms.push(room);
    room.onMessage("view", view => views.set(room, view));
    room.send("sync");
    return room;
  }
  async function until(done: () => boolean) {
    for (let i = 0; i < 200; i++) {
      if (done()) return;
      await wait(10);
    }
    assert.fail("Expected hider contact update");
  }
  const host = watch(await api.create("hide"));
  const guest = watch(await api.joinById(host.roomId));
  const neighbour = watch(await api.joinById(host.roomId));
  const feedback: string[] = [];
  guest.onMessage("feedback", text => feedback.push(text));
  host.send("start");
  await until(() => views.get(guest)?.phase === "hide");
  const room = matchMaker.getLocalRoomById(host.roomId) as unknown as { players: Map<string, Player> };
  const mover = room.players.get(guest.sessionId)!;
  const blocker = room.players.get(neighbour.sessionId)!;
  // Put two bottles next to the existing office chair for repeatable aim.
  Object.assign(mover, { x: -0.2, z: -8.5, form: "food_soda_bottle" });
  Object.assign(blocker, { x: 0.1, z: -8.5, form: "food_soda_bottle" });
  const aim = { ...idle, pitch: Math.atan2(models.furniture_chair_desk.size[1] / 2 - eye(mover), 1.5) };
  guest.send("use", { aim });
  await until(() => feedback.length === 1);
  assert.equal(mover.form, "food_soda_bottle");
  guest.send("move", { first: 1, inputs: Array(12).fill(right) });
  await until(() => views.get(guest)?.ack === 12);
  const seen = () => views.get(neighbour)?.players.find(p => p.id === mover.id);
  await until(() => seen()?.x === mover.x);
  assert.ok(mover.x > -0.2 && blocker.x - mover.x >= models.food_soda_bottle.size[0]);
  neighbour.send("move", { first: 1, inputs: Array(12).fill(right) });
  await until(() => views.get(neighbour)?.ack === 12);
  guest.send("use", { aim });
  await until(() => seen()?.form === "furniture_chair_desk");
});
