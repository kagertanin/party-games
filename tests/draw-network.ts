import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { Client, type Room } from "colyseus.js";
import { DRAW_ROOM, type DrawView } from "../shared/draw";

const endpoint = process.env.TEST_SERVER_URL || "http://localhost:2567";
const sdk = new Client(endpoint);
const rooms: Room[] = [];
const latest = new Map<string, DrawView>();
const failures: string[] = [];
const view = (r: Room) => latest.get(r.sessionId)!;
function watch(room: Room) {
  room.onMessage<DrawView>("view", (v) => latest.set(room.sessionId, v));
  room.onMessage<string>("problem", (msg) => failures.push(msg));
  room.send("sync");
  return room;
}
async function until(check: () => boolean, label: string, limit = 18000) {
  const end = Date.now() + limit;
  while (!check()) {
    if (Date.now() > end) throw Error(label + ": " + failures.join(", "));
    await wait(25);
  }
}
const allAt = (phase: string, turn?: number) =>
  rooms.every(
    (r) =>
      view(r)?.phase === phase && (turn === undefined || view(r).turn === turn),
  );
function act(r: Room, type: string, data: Record<string, unknown> = {}) {
  r.send("play", { epoch: view(r).epoch, type, ...data });
}
async function reconnect(index: number) {
  const previous = rooms[index];
  const { sessionId, reconnectionToken } = previous;
  previous.connection.close();
  await until(
    () =>
      view(rooms[0]).players.find((p) => p.id === sessionId)?.connected ===
      false,
    "seat reserved",
  );
  latest.delete(sessionId);
  rooms[index] = watch(await sdk.reconnect(reconnectionToken));
}
try {
  rooms.push(watch(await sdk.create(DRAW_ROOM, { name: "Проверка 1" })));
  const extra = watch(
    await sdk.joinById(rooms[0].roomId, { name: "Запасной" }),
  );
  const guest = watch(
    await sdk.joinById(rooms[0].roomId, { name: "Проверка 2" }),
  );
  rooms.push(guest);
  await until(() => view(guest)?.players.length === 3, "initial lobby");
  act(guest, "kick", { member: extra.sessionId });
  await until(() => view(extra)?.players.length === 3, "guest cannot remove");
  const removed = new Promise<number>((resolve) => extra.onLeave(resolve));
  act(rooms[0], "kick", { member: extra.sessionId });
  assert.equal(await removed, 4005);
  for (let i = 2; i < 12; i++)
    rooms.push(
      watch(
        await sdk.joinById(rooms[0].roomId, { name: "Проверка " + (i + 1) }),
      ),
    );
  await until(
    () => rooms.every((r) => view(r)?.players.length === 12),
    "lobby",
  );
  act(rooms[0], "start");
  await until(() => allAt("drawing"), "drawing");
  const prompts = new Map(rooms.map((r) => [r.sessionId, view(r).prompt!]));
  assert.equal(new Set(prompts.values()).size, 12);
  const png = await readFile(
    new URL("./fixtures/drawn-stroke.png", import.meta.url),
  );
  await Promise.all(
    rooms.map(async (r) => {
      const uploaded = await fetch(endpoint + view(r).upload + "?v=1", {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: new Uint8Array(png),
      });
      assert.equal(uploaded.status, 204);
      act(r, "ready");
    }),
  );
  const seen = new Set<string>();
  const expected = new Map(
    rooms.map((r) => [r.sessionId, { points: 0, streak: 0, likes: 0 }]),
  );
  for (let i = 0; i < 12; i++) {
    await until(() => allAt("captions", i), "captions " + i);
    const screen = view(rooms[0]);
    const artist = screen.artist!;
    assert.ok(!seen.has(artist));
    seen.add(artist);
    assert.deepEqual(
      Buffer.from(await (await fetch(endpoint + screen.picture)).arrayBuffer()),
      png,
    );
    const guessers = rooms.filter((r) => r.sessionId !== artist);
    for (const r of guessers) {
      assert.equal(view(r).prompt, undefined);
      act(r, "caption", { text: "Моя версия " + r.sessionId });
    }
    await until(() => allAt("vote", i), "vote " + i);
    if (i === 0) {
      await reconnect(11);
      await until(() => allAt("vote", 0), "reconnect");
    }
    const options = view(rooms[0]).choices!;
    assert.equal(options.length, 12);
    assert.ok(options.every((o) => !("author" in o) && !("truth" in o)));
    const truth = options.find((o) => o.text === prompts.get(artist))!;
    const voters = rooms.filter((r) => r.sessionId !== artist);
    const fake = options.find((o) => o.text.endsWith(voters[0].sessionId))!;
    act(rooms.find((r) => r.sessionId === artist)!, "like", {
      choice: fake.id,
      likes: true,
    });
    // Early hearts must not count; the same choice is liked during the review window below.
    for (const [n, r] of voters.entries()) {
      const p = expected.get(r.sessionId)!;
      if (n === 1) {
        p.streak = 0;
        expected.get(voters[0].sessionId)!.points += 500;
      } else {
        p.points += 1000 + 100 * p.streak++;
        expected.get(artist)!.points += 1000;
      }
      act(r, "vote", { choice: n === 1 ? fake.id : truth.id });
      act(r, "vote", { choice: truth.id });
    }
    await until(() => allAt("reveal", i), "reveal " + i);
    assert.ok(
      rooms.every(
        (r) =>
          view(r).revealed?.length === 0 && view(r).reveal?.kind === "opening",
      ),
    );
    await until(
      () => rooms.every((r) => view(r).reveal?.kind === "ballots"),
      "ballots",
    );
    assert.ok(
      rooms.every(
        (r) =>
          view(r).reveal!.titles[0].author === undefined &&
          !view(r).reveal!.awards.length,
      ),
    );
    await until(
      () => rooms.every((r) => view(r).reveal?.kind === "tally"),
      "all votes displayed",
      65000,
    );
    const board = view(rooms[0]).revealed!;
    assert.equal(board.length, 12);
    assert.ok(
      board.every(
        (f) => f.kind === "ballots" && f.titles[0].author === undefined,
      ),
    );
    for (const r of rooms) assert.deepEqual(view(r).revealed, board);
    if (i === 0) {
      await reconnect(5);
      await until(
        () => Boolean(view(rooms[5])?.revealed),
        "reconnect during reveal",
      );
      assert.deepEqual(view(rooms[5]).revealed, board);
    }
    await until(
      () => rooms.every((r) => view(r).reveal?.kind === "favorites"),
      "all awards settled",
      55000,
    );
    const author = rooms.find((r) => r.sessionId === artist)!;
    act(author, "like", { choice: fake.id, likes: true });
    act(author, "like", { choice: fake.id, likes: true });
    await until(
      () => rooms.every((r) => view(r).heartCounts?.[fake.id] === 1),
      "shared hearts",
    );
    expected.get(voters[0].sessionId)!.likes++;
    for (const p of view(rooms[0]).players) {
      assert.equal(p.points, expected.get(p.id)!.points);
      assert.equal(p.likes, expected.get(p.id)!.likes);
    }
  }
  await until(() => allAt("results"), "results");
  assert.equal(seen.size, 12);
  assert.deepEqual(failures, []);
  act(rooms[0], "again");
  await until(() => allAt("lobby"), "rematch");
  console.log(
    "12 players, 12 drawings, 132 captions and votes, images, reconnection, all scores and rematch verified.",
  );
} finally {
  await Promise.allSettled(rooms.map((r) => r.leave()));
}
