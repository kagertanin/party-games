import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { Client, type Room } from "colyseus.js";
import { startServer } from "../server/index.js";
import {
  SURVEY_CODE, SURVEY_KICKED_CODE, SURVEY_ROOM,
  type SurveyOnlineAction, type SurveyRoomView,
} from "../shared/survey-online.js";

function getSeat(view: SurveyRoomView, team: number, seat: number) {
  return view.teams.find(({ fruitIndex }) => fruitIndex === team)?.seats?.[seat];
}

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
  const expulsions = new Map<Room, string>();
  const departures = new Map<Room, number>();

  function follow(room: Room) {
    connections.add(room);
    const messages: string[] = [];
    errors.set(room, messages);
    room.onMessage("view", (view: SurveyRoomView) => latest.set(room, view));
    room.onMessage("rejected", (message: string) => messages.push(message));
    room.onMessage("kicked", (message: string) => expulsions.set(room, message));
    room.onLeave((code) => {
      connections.delete(room);
      departures.set(room, code);
    });
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

  async function expectRejected(room: Room, message?: RegExp) {
    const until = Date.now() + 1_500;
    do {
      const error = errors.get(room)?.shift();
      if (error) {
        if (message) assert.match(error, message);
        return;
      }
      await wait(10);
    } while (Date.now() < until);
    assert.fail(`Action was not rejected for ${room.sessionId}`);
  }

  const create = async (teamCount = 2, teamSize = 2) => follow(
    await new Client(endpoint).create(SURVEY_ROOM, { name: "  Ведущий  ", teamCount, teamSize }),
  );
  const join = async (host: Room, name: string) => follow(
    await new Client(endpoint).joinById(host.roomId, { name }),
  );
  const resume = async (token: string) => follow(await new Client(endpoint).reconnect(token));
  function send(room: Room, action: SurveyOnlineAction) { room.send("action", action); }

  async function takeSeat(room: Room, team: number, seat: number) {
    send(room, { type: "take-seat", team, seat });
    return viewWhen(room, (view) => getSeat(view, team, seat)?.id === room.sessionId);
  }

  return { create, join, resume, send, takeSeat, viewWhen, expectRejected, departures, expulsions };
}

test("survey rooms share a private lobby and authoritative play across clients", { timeout: 10_000 }, async (t) => {
  const { create, join, resume, send, takeSeat, viewWhen, expectRejected } = await openSurveyServer(t);
  const host = await create();
  assert.match(host.roomId, SURVEY_CODE);
  const lobby = await viewWhen(host, (view) => view.owner === host.sessionId);
  assert.equal(lobby.match, null);
  assert.equal(lobby.unassigned[0].name, "Ведущий");
  assert.deepEqual(lobby.teams.map(({ seats }) => seats), [[null, null], [null, null]]);
  assert.equal(lobby.teamSize, 2);

  host.send("action", { type: "start" });
  await expectRejected(host);
  const guests: Room[] = [];
  for (const name of ["Аня", "Макс", "Маша"]) {
    guests.push(await join(host, name));
  }
  const [spectator, teammate, lastGuest] = guests;
  await viewWhen(host, (view) => view.unassigned.length === 4);
  await assert.rejects(join(host, "Лишний игрок"));
  await takeSeat(host, 0, 0);
  await takeSeat(spectator, 0, 1);
  const moved = await takeSeat(spectator, 1, 0);
  assert.equal(getSeat(moved, 0, 1), null);
  send(spectator, { type: "take-seat", team: 0, seat: 0 });
  await expectRejected(spectator, /занято/);
  const keptSeat = await viewWhen(spectator, (view) => getSeat(view, 1, 0)?.id === spectator.sessionId);
  assert.equal(getSeat(keptSeat, 0, 0)?.id, host.sessionId);
  send(spectator, { type: "take-seat", team: 0, seat: -1 });
  await expectRejected(spectator);
  send(spectator, { type: "move-player", memberId: teammate.sessionId, team: 1, seat: 1 });
  await expectRejected(spectator, /ведущему/);
  send(spectator, { type: "kick-player", memberId: teammate.sessionId });
  await expectRejected(spectator, /ведущему/);
  send(spectator, { type: "shuffle-teams" });
  await expectRejected(spectator, /ведущему/);

  send(host, { type: "move-player", memberId: teammate.sessionId, team: 0, seat: 1 });
  await viewWhen(teammate, (view) => getSeat(view, 0, 1)?.id === teammate.sessionId);
  await takeSeat(lastGuest, 1, 1);
  const full = await viewWhen(host, (view) => view.teams.every(({ players }) => players.length === 2));
  assert.deepEqual(full.unassigned, []);
  assert.deepEqual(full.teams.map(({ players }) => players.map(({ name }) => name)), [
    ["Ведущий", "Макс"], ["Аня", "Маша"],
  ]);
  spectator.send("action", { type: "start" });
  await expectRejected(spectator, /ведущему/);

  host.send("action", { type: "start" });
  const clients = [host, ...guests];
  const ballot = (await viewWhen(host, (view) => view.match?.phase === "ballot")).match!;
  send(host, { type: "shuffle-teams" });
  await expectRejected(host);
  send(host, { type: "move-player", memberId: teammate.sessionId, team: 1, seat: 0 });
  await expectRejected(host);
  send(host, { type: "kick-player", memberId: teammate.sessionId });
  await expectRejected(host);
  send(teammate, { type: "take-seat", team: 1, seat: 0 });
  await expectRejected(teammate);
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

  const token = teammate.reconnectionToken;
  teammate.connection.close();
  await viewWhen(host, (view) => view.teams[0].players[1].connected === false);
  const resumed = await resume(token);
  assert.equal(resumed.sessionId, teammate.sessionId);
  await viewWhen(host, (view) => view.teams[0].players[1].connected === true);
  const resumedView = await viewWhen(resumed, (view) => view.match?.turnIndex === 1);
  assert.equal(resumedView.teams[0].score, 30);
});

test("the host can rearrange teams and start a lobby with empty seats", { timeout: 10_000 }, async (t) => {
  const { create, join, resume, takeSeat, viewWhen, expectRejected } = await openSurveyServer(t);
  const host = await create(2, 4);
  const initial = await viewWhen(host, (view) => view.owner === host.sessionId);
  assert.deepEqual(initial.teams.map(({ capacity }) => capacity), [4, 4]);

  const guests = [];
  for (const name of ["Аня", "Макс", "Маша", "Саша"]) guests.push(await join(host, name));
  guests[0].send("action", { type: "add-team" });
  await expectRejected(guests[0], /ведущему/);
  host.send("action", { type: "add-team" });
  const three = await viewWhen(host, (view) => view.teamCount === 3);
  assert.equal(three.unassigned.length, 5);
  assert.ok(three.teams.every(({ players }) => players.length === 0));
  await takeSeat(host, 0, 3);
  await takeSeat(guests[0], 0, 1);
  await takeSeat(guests[1], 1, 0);
  await takeSeat(guests[2], 1, 1);
  await takeSeat(guests[3], 2, 0);
  host.send("action", { type: "start" });
  await expectRejected(host, /хотя бы два/);
  host.send("action", { type: "add-team" });
  await expectRejected(host, /не больше трёх/);

  host.send("action", { type: "remove-team", team: 2 });
  const removed = await viewWhen(host, (view) => view.teamCount === 2);
  assert.deepEqual(removed.unassigned.map(({ id }) => id), [guests[3].sessionId]);
  guests.push(await join(host, "Коля"));
  host.send("action", { type: "add-team" });
  await viewWhen(host, (view) => view.teamCount === 3);
  await takeSeat(guests[3], 2, 0);
  await takeSeat(guests[4], 2, 1);

  host.send("action", { type: "remove-team", team: 1 });
  const two = await viewWhen(host, (view) => view.teamCount === 2);
  assert.deepEqual(two.teams.map(({ fruitIndex, name }) => [fruitIndex, name]), [[0, "Яблоки"], [2, "Сливы"]]);
  assert.deepEqual(two.teams.map(({ players }) => players.length), [2, 2]);
  assert.deepEqual(two.unassigned.map(({ id }) => id).sort(),
    [guests[1].sessionId, guests[2].sessionId].sort());
  host.send("action", { type: "remove-team", team: 2 });
  await expectRejected(host, /хотя бы две команды/);
  await takeSeat(guests[1], 0, 2);
  await takeSeat(guests[2], 2, 2);

  host.send("action", { type: "resize-team", team: 0, delta: -1 });
  await viewWhen(host, (view) => view.teams[0].capacity === 3);
  host.send("action", { type: "resize-team", team: 0, delta: -1 });
  await expectRejected(host, /свободное место/);
  const departing = guests[1];
  await departing.leave();
  await viewWhen(host, (view) => view.teams[0].players.length === 2);
  host.send("action", { type: "resize-team", team: 0, delta: -1 });
  await viewWhen(host, (view) => view.teams[0].capacity === 2);
  host.send("action", { type: "resize-team", team: 0, delta: -1 });
  await expectRejected(host, /от двух до пяти мест/);
  host.send("action", { type: "resize-team", team: 2, delta: -1 });
  await viewWhen(host, (view) => view.teams[1].capacity === 3);
  await assert.rejects(join(host, "Лишний игрок"));
  host.send("action", { type: "resize-team", team: 2, delta: 1 });
  const expanded = await viewWhen(host, (view) => view.teams[1].capacity === 4);
  const reserving = await join(host, "Вера");
  await takeSeat(reserving, 2, expanded.teams[1].seats!.indexOf(null));
  await viewWhen(host, (view) => view.teams[1].players.length === 4);

  const reservation = reserving.reconnectionToken;
  reserving.connection.close();
  const waiting = await viewWhen(host, (view) => view.teams[1].players.some(({ id, connected }) => id === reserving.sessionId && !connected));
  assert.equal(waiting.teams[1].players.length, 4);
  host.send("action", { type: "resize-team", team: 2, delta: -1 });
  await expectRejected(host, /свободное место/);
  host.send("action", { type: "start" });
  const started = await viewWhen(host, (view) => view.match?.phase === "ballot");
  assert.deepEqual(started.teams.map(({ players }) => players.length), [2, 3]);
  host.send("action", { type: "resize-team", team: 2, delta: 1 });
  await expectRejected(host, /только в комнате ожидания/);

  const spectator = await resume(reservation);
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

test("the host shuffles seated and unassigned players into balanced teams, then starts an uneven match", { timeout: 10_000 }, async (t) => {
  const { create, join, send, takeSeat, viewWhen, expectRejected } = await openSurveyServer(t);
  const host = await create(3, 3);
  const players = [host];
  for (let index = 1; index <= 6; index++) players.push(await join(host, `Игрок ${index}`));
  await viewWhen(host, (view) => view.unassigned.length === 7);
  await takeSeat(host, 0, 2);
  await takeSeat(players[1], 0, 1);
  send(host, { type: "start" });
  await expectRejected(host);

  send(host, { type: "shuffle-teams" });
  const balanced = await viewWhen(host, (view) => view.unassigned.length === 0 &&
    view.teams.every(({ players: members }) => members.length >= 2));
  assert.deepEqual(balanced.teams.map(({ players: members }) => members.length).sort(), [2, 2, 3]);
  assert.deepEqual(balanced.teams.flatMap(({ players: members }) => members.map(({ id }) => id)).sort(),
    players.map(({ sessionId }) => sessionId).sort());

  // Test readiness with two players even if the first team drew the extra player.
  if (balanced.teams[0].players.length === 3) {
    const targetTeam = balanced.teams.findIndex(({ players: members }) => members.length === 2);
    const targetSeat = balanced.teams[targetTeam].seats!.indexOf(null);
    send(host, { type: "move-player", memberId: balanced.teams[0].players[0].id, team: targetTeam, seat: targetSeat });
  }
  const seated = await viewWhen(host, (view) => view.teams[0].players.length === 2);
  const firstTeam = seated.teams[0].players.map(({ id }) => players.find((player) => player.sessionId === id)!);
  send(host, { type: "start" });
  const ballot = (await viewWhen(host, (view) => view.match?.phase === "ballot")).match!;
  for (const player of players) send(player, { type: "question", phaseId: ballot.phaseId, id: 0 });
  const ready = (await viewWhen(host, (view) => view.match?.phase === "ready")).match!;
  assert.equal(ready.activeTeam, 0);
  for (const player of firstTeam) send(player, { type: "ready", phaseId: ready.phaseId });
  await viewWhen(host, (view) => view.match?.phase === "turn");
});

test("kicking connected players and reserved seats removes their membership and reopens capacity", { timeout: 10_000 }, async (t) => {
  const { create, join, resume, send, takeSeat, viewWhen, expectRejected, departures, expulsions } = await openSurveyServer(t);
  const host = await create();
  const online = await join(host, "Аня");
  const disconnected = await join(host, "Илья");
  const otherGuest = await join(host, "Маша");
  await takeSeat(disconnected, 1, 1);
  const token = disconnected.reconnectionToken;
  disconnected.connection.close();
  await viewWhen(host, (view) => getSeat(view, 1, 1)?.connected === false);
  await assert.rejects(join(host, "Лишний игрок"));

  send(host, { type: "kick-player", memberId: host.sessionId });
  await expectRejected(host);
  send(host, { type: "kick-player", memberId: disconnected.sessionId });
  await viewWhen(host, (view) => getSeat(view, 1, 1) === null);
  await assert.rejects(resume(token));
  const replacement = await join(host, "Новый игрок");
  await takeSeat(replacement, 1, 1);

  send(host, { type: "kick-player", memberId: online.sessionId });
  await viewWhen(host, (view) => !view.unassigned.some(({ id }) => id === online.sessionId));
  await viewWhen(host, () => departures.has(online));
  assert.equal(departures.get(online), SURVEY_KICKED_CODE);
  assert.match(expulsions.get(online) ?? "", /исключ/i);

  const claim = { type: "take-seat", team: 0, seat: 1 } as const;
  send(replacement, claim);
  send(otherGuest, claim);
  const outcome = await viewWhen(host, (view) => !!getSeat(view, 0, 1));
  const loser = getSeat(outcome, 0, 1)?.id === replacement.sessionId ? otherGuest : replacement;
  await expectRejected(loser, /занято/);
});
