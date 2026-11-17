import { strict as assert } from "node:assert";
import { Client, type Room } from "colyseus.js";
import type { View } from "../shared/game";
const endpoint = process.env.TEST_SERVER_URL || "http://localhost:2567";
const rooms: Room[] = [];
const latest = new Map<Room, View>();
function subscribe(room: Room) {
  rooms.push(room);
  room.onMessage("view", (v: View) => latest.set(room, v));
  room.onMessage("rejected", (text: string) => {
    throw new Error(text);
  });
  room.send("sync");
  return room;
}
async function waitFor(predicate: () => boolean, description: string) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timeout: " + description);
    await new Promise((r) => setTimeout(r, 25));
  }
}
try {
  const host = subscribe(
    await new Client(endpoint).create("hat", { name: "Host" }),
  );
  for (let i = 1; i < 4; i++)
    subscribe(
      await new Client(endpoint).joinById(host.roomId, { name: "Player " + i }),
    );
  await waitFor(() => latest.get(host)?.players.length === 4, "four players");
  host.send("action", { id: "start", action: { type: "start" } });
  await waitFor(
    () => rooms.every((r) => latest.get(r)?.phase === "words"),
    "word phase",
  );
  rooms.forEach((r, i) =>
    r.send("action", {
      id: "words",
      action: {
        type: "words",
        words: Array.from({ length: 5 }, (_, j) => `Network ${i} ${j}`),
      },
    }),
  );
  await waitFor(
    () => rooms.every((r) => latest.get(r)?.phase === "ready"),
    "ready phase",
  );
  const speakerId = latest.get(host)!.speakerId;
  const explaining = rooms.find((r) => r.sessionId === speakerId)!;
  explaining.send("action", { id: "begin", action: { type: "begin" } });
  await waitFor(
    () => rooms.every((r) => latest.get(r)?.phase === "play"),
    "play phase",
  );
  assert.ok(latest.get(explaining)!.currentWord);
  rooms
    .filter((r) => r !== explaining)
    .forEach((r) => assert.equal(latest.get(r)!.currentWord, null));
  explaining.send("action", { id: "correct", action: { type: "correct" } });
  explaining.send("action", { id: "correct", action: { type: "correct" } });
  await waitFor(
    () => latest.get(host)!.teams[0].score1 === 1,
    "deduplicated answer",
  );
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(latest.get(host)!.teams[0].score1, 1);
  const old = rooms[1];
  const token = old.reconnectionToken;
  const id = old.sessionId;
  rooms.splice(rooms.indexOf(old), 1);
  old.connection.close();
  await waitFor(
    () =>
      latest.get(host)!.players.find((p) => p.id === id)?.connected === false,
    "disconnect",
  );
  const resumed = subscribe(await new Client(endpoint).reconnect(token));
  await waitFor(
    () =>
      latest.get(resumed)?.players.find((p) => p.id === id)?.connected === true,
    "resume",
  );
  assert.equal(resumed.sessionId, id);
  assert.equal(latest.get(resumed)!.players.length, 4);
  console.log(
    "PASS: room creation, joining, private cards, duplicate command, disconnect and resume",
  );
} finally {
  await Promise.allSettled(
    rooms.map(async (r) => {
      await Promise.race([
        r.leave(),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      r.connection.close();
    }),
  );
}
