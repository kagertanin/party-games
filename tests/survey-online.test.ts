import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { Client, type Room } from "colyseus.js";
import { startServer } from "../server/index.js";
import { SURVEY_CODE, SURVEY_ROOM, type SurveyRoomView } from "../shared/survey-online.js";

async function openSurveyServer(t: TestContext) {
  const server = await startServer(0);
  const address = server.transport.server?.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const connections = new Set<Room>();
  t.after(async () => {
    await Promise.allSettled([...connections].map((room) => room.leave()));
    await server.gracefullyShutdown(false);
  });

  const latest = new Map<Room, SurveyRoomView>();
  const errors = new Map<Room, string[]>();
  function follow(room: Room) {
    connections.add(room);
    const messages: string[] = [];
    errors.set(room, messages);
    room.onMessage("view", (view: SurveyRoomView) => latest.set(room, view));
    room.onMessage("rejected", (message: string) => messages.push(message));
    room.send("sync");
    return room;
  }

  async function viewWhen(room: Room, predicate: (view: SurveyRoomView) => boolean) {
    const until = Date.now() + 1_500;
    do {
      const state = latest.get(room);
      if (state && predicate(state)) return state;
      await wait(10);
    } while (Date.now() < until);
    assert.fail(`View not received for ${room.sessionId}: ${JSON.stringify(latest.get(room))}`);
  }

  async function expectRejected(room: Room, message: RegExp) {
    const until = Date.now() + 1_500;
    do {
      const error = errors.get(room)?.shift();
      if (error) {
        assert.match(error, message);
        return;
      }
      await wait(10);
    } while (Date.now() < until);
    assert.fail(`Action was not rejected for ${room.sessionId}`);
  }

  return { endpoint, connections, follow, viewWhen, expectRejected };
}

test("survey rooms share a private lobby and authoritative play across clients", { timeout: 10_000 }, async (t) => {
  const { endpoint, connections, follow, viewWhen, expectRejected } = await openSurveyServer(t);
  const host = follow(await new Client(endpoint).create(SURVEY_ROOM, {
    name: "  Ведущий  ", teamCount: 2, teamSize: 2,
  }));
  assert.match(host.roomId, SURVEY_CODE);
  const lobby = await viewWhen(host, (view) => view.owner === host.sessionId);
  assert.equal(lobby.match, null);
  assert.equal(lobby.teams[0].players[0].name, "Ведущий");
  assert.equal(lobby.teamSize, 2);

  host.send("action", { type: "start" });
  await expectRejected(host, /Дождитесь/);
  const guests: Room[] = [];
  for (const name of ["Аня", "Макс", "Маша"]) {
    guests.push(follow(await new Client(endpoint).joinById(host.roomId, { name })));
  }
  const [spectator, teammate] = guests;
  const full = await viewWhen(host, (view) => view.teams.every(({ players }) => players.length === 2));
  assert.deepEqual(full.teams.map(({ players }) => players.map(({ name }) => name)), [
    ["Ведущий", "Макс"], ["Аня", "Маша"],
  ]);
  await assert.rejects(new Client(endpoint).joinById(host.roomId, { name: "Лишний игрок" }));
  spectator.send("action", { type: "start" });
  await expectRejected(spectator, /ведущему/);

  host.send("action", { type: "start" });
  const clients = [host, ...guests];
  const ballot = (await viewWhen(host, (view) => view.match?.phase === "ballot")).match!;
  assert.equal(ballot.question, null);
  assert.ok(ballot.ballot?.choices.length);
  for (const room of clients) {
    room.send("action", { type: "question", phaseId: ballot.phaseId, id: 0 });
  }
  const ready = (await viewWhen(host, (view) => view.match?.phase === "ready")).match!;
  assert.deepEqual(ready.question?.answers, Array(6).fill(null));
  assert.equal(ready.activeTeam, 0);
  assert.notEqual(ready.phaseId, ballot.phaseId);

  spectator.send("action", { type: "ready", phaseId: ready.phaseId });
  await expectRejected(spectator, /другая команда/);
  host.send("action", { type: "ready", phaseId: ready.phaseId });
  teammate.send("action", { type: "ready", phaseId: ready.phaseId });
  const turn = (await viewWhen(host, (view) => view.match?.phase === "turn")).match!;
  host.send("action", { type: "vote", phaseId: ready.phaseId, id: 0 });
  await expectRejected(host, /этап уже завершился/);
  host.send("action", { type: "propose", phaseId: turn.phaseId, text: "Завтракают" });
  await viewWhen(spectator, (view) => view.match?.proposals[0]?.text === "Завтракают");
  for (const room of [host, teammate]) {
    room.send("action", { type: "vote", phaseId: turn.phaseId, id: 0 });
  }
  await viewWhen(host, (view) => view.match?.confirmationId === 0);
  host.send("action", { type: "confirm", phaseId: turn.phaseId, id: 0 });
  const scored = await viewWhen(spectator, (view) => view.match?.turnIndex === 1);
  assert.equal(scored.teams[0].score, 30);
  assert.deepEqual(scored.match?.question?.answers, [
    null, { label: "Завтракают", points: 30 }, null, null, null, null,
  ]);

  connections.delete(teammate);
  const token = teammate.reconnectionToken;
  teammate.connection.close();
  await viewWhen(host, (view) => view.teams[0].players[1].connected === false);
  const resumed = follow(await new Client(endpoint).reconnect(token));
  assert.equal(resumed.sessionId, teammate.sessionId);
  await viewWhen(host, (view) => view.teams[0].players[1].connected === true);
  const resumedView = await viewWhen(resumed, (view) => view.match?.turnIndex === 1);
  assert.equal(resumedView.teams[0].score, 30);
});

test("the host can rearrange teams and start a lobby with empty seats", { timeout: 10_000 }, async (t) => {
  const { endpoint, connections, follow, viewWhen, expectRejected } = await openSurveyServer(t);
  const host = follow(await new Client(endpoint).create(SURVEY_ROOM, { name: "Ведущий" }));
  const join = async (name: string) => follow(await new Client(endpoint).joinById(host.roomId, { name }));
  const initial = await viewWhen(host, (view) => view.owner === host.sessionId);
  assert.deepEqual(initial.teams.map(({ capacity }) => capacity), [4, 4]);

  const guests = [];
  for (const name of ["Аня", "Макс", "Маша", "Саша"]) guests.push(await join(name));
  guests[0].send("action", { type: "add-team" });
  await expectRejected(guests[0], /ведущему/);
  host.send("action", { type: "add-team" });
  const three = await viewWhen(host, (view) => view.teamCount === 3);
  assert.deepEqual(three.teams.map(({ players }) => players.length), [2, 2, 1]);
  host.send("action", { type: "start" });
  await expectRejected(host, /хотя бы два/);
  host.send("action", { type: "add-team" });
  await expectRejected(host, /не больше трёх/);

  host.send("action", { type: "remove-team", team: 2 });
  await viewWhen(host, (view) => view.teamCount === 2);
  guests.push(await join("Коля"));
  await viewWhen(host, (view) => view.teams.every(({ players }) => players.length === 3));
  host.send("action", { type: "add-team" });
  const rebalanced = await viewWhen(host, (view) => view.teamCount === 3);
  assert.deepEqual(rebalanced.teams.map(({ players }) => players.length), [2, 2, 2]);

  host.send("action", { type: "remove-team", team: 1 });
  const two = await viewWhen(host, (view) => view.teamCount === 2);
  assert.deepEqual(two.teams.map(({ fruitIndex, name }) => [fruitIndex, name]), [[0, "Яблоки"], [2, "Сливы"]]);
  assert.deepEqual(two.teams.map(({ players }) => players.length), [3, 3]);
  assert.deepEqual(two.teams.flatMap(({ players }) => players.map(({ id }) => id)).sort(),
    [host, ...guests].map(({ sessionId }) => sessionId).sort());
  host.send("action", { type: "remove-team", team: 2 });
  await expectRejected(host, /хотя бы две команды/);

  host.send("action", { type: "resize-team", team: 0, delta: -1 });
  await viewWhen(host, (view) => view.teams[0].capacity === 3);
  host.send("action", { type: "resize-team", team: 0, delta: -1 });
  await expectRejected(host, /свободное место/);
  const departing = guests.find((guest) => two.teams[0].players.some(({ id }) => id === guest.sessionId))!;
  await departing.leave();
  connections.delete(departing);
  await viewWhen(host, (view) => view.teams[0].players.length === 2);
  host.send("action", { type: "resize-team", team: 0, delta: -1 });
  await viewWhen(host, (view) => view.teams[0].capacity === 2);
  host.send("action", { type: "resize-team", team: 0, delta: -1 });
  await expectRejected(host, /от двух до пяти мест/);
  host.send("action", { type: "resize-team", team: 2, delta: -1 });
  await viewWhen(host, (view) => view.teams[1].capacity === 3);
  await assert.rejects(join("Лишний игрок"));
  host.send("action", { type: "resize-team", team: 2, delta: 1 });
  await viewWhen(host, (view) => view.teams[1].capacity === 4);
  const reserving = await join("Вера");
  await viewWhen(host, (view) => view.teams[1].players.length === 4);

  const reservation = reserving.reconnectionToken;
  reserving.connection.close();
  connections.delete(reserving);
  const waiting = await viewWhen(host, (view) => view.teams[1].players.some(({ id, connected }) => id === reserving.sessionId && !connected));
  assert.equal(waiting.teams[1].players.length, 4);
  host.send("action", { type: "resize-team", team: 2, delta: -1 });
  await expectRejected(host, /свободное место/);
  host.send("action", { type: "start" });
  const started = await viewWhen(host, (view) => view.match?.phase === "ballot");
  assert.deepEqual(started.teams.map(({ players }) => players.length), [2, 3]);
  host.send("action", { type: "resize-team", team: 2, delta: 1 });
  await expectRejected(host, /только в комнате ожидания/);

  const spectator = follow(await new Client(endpoint).reconnect(reservation));
  const spectating = await viewWhen(spectator, (view) => view.match?.phase === "ballot");
  assert.equal(spectator.sessionId, reserving.sessionId);
  assert.ok(!spectating.teams.some(({ players }) => players.some(({ id }) => id === spectator.sessionId)));
  const ballot = started.match!;
  const vote = { type: "question", phaseId: ballot.phaseId, id: ballot.ballot!.choices[0].id };
  spectator.send("action", vote);
  await expectRejected(spectator, /не участвует в голосовании/);
  const players = [host, ...guests.filter((guest) => guest !== departing)];
  for (const player of players) player.send("action", vote);
  const ready = (await viewWhen(host, (view) => view.match?.phase === "ready")).match!;
  for (const player of players.filter((player) => started.teams[0].players.some(({ id }) => id === player.sessionId))) {
    player.send("action", { type: "ready", phaseId: ready.phaseId });
  }
  await viewWhen(host, (view) => view.match?.phase === "turn");
});
