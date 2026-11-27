import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { Client, type Room } from "colyseus.js";
import { startServer } from "../server/index.js";
import {
  SURVEY_CODE, SURVEY_KICKED_CODE, SURVEY_RESOLUTION_MS, SURVEY_ROOM,
  type SurveyOnlineAction, type SurveyRoomView,
} from "../shared/survey-online.js";
import { questionPacks } from "../src/survey/question-packs.js";

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

  async function viewWhen(room: Room, predicate: (view: SurveyRoomView) => boolean, timeout = 1_500) {
    const until = Date.now() + timeout;
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
  const choice = ballot.ballot!.choices[0];
  const question = questionPacks.classic.questions[choice.id];
  const { label, points } = question.answers[0];
  assert.equal(choice.prompt, question.prompt);
  for (const room of clients) {
    room.send("action", { type: "question", phaseId: ballot.phaseId, id: choice.id });
  }
  const ready = (await viewWhen(host, (view) => view.match?.phase === "ready")).match!;
  assert.equal(ready.question?.prompt, choice.prompt);
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
  host.send("action", { type: "propose", phaseId: turn.phaseId, text: label });
  await viewWhen(spectator, (view) => view.match?.proposals[0]?.text === label);
  for (const room of [host, teammate]) {
    room.send("action", { type: "vote", phaseId: turn.phaseId, id: 0 });
  }
  await viewWhen(host, (view) => view.match?.confirmationId === 0 && view.match.votes.length === 2);
  host.send("action", { type: "confirm", phaseId: turn.phaseId, id: 0 });
  const scored = await viewWhen(spectator, (view) => view.match?.phase === "resolution");
  const resolution = scored.match!;
  assert.equal(resolution.turnIndex, 0);
  assert.equal(resolution.activeTeam, 0);
  assert.equal(resolution.deadline - scored.serverNow, SURVEY_RESOLUTION_MS);
  assert.equal(resolution.resultsStats, undefined);
  assert.deepEqual(resolution.resolution, {
    team: 0, text: label, points, kind: "hit", answerIndex: 0,
  });
  assert.equal(scored.teams[0].score, points);
  assert.deepEqual(resolution.opened, [[0, 0]]);
  assert.deepEqual(resolution.question?.answers, [
    { label, points }, null, null, null, null, null,
  ]);
  send(spectator, { type: "ready", phaseId: resolution.phaseId });
  await expectRejected(spectator);
  const handoff = await viewWhen(spectator, (view) =>
    view.match?.phase === "ready" && view.match.turnIndex === 1, SURVEY_RESOLUTION_MS + 1_000);
  assert.ok(handoff.serverNow >= resolution.deadline);
  assert.equal(handoff.match?.activeTeam, 1);

  const token = teammate.reconnectionToken;
  teammate.connection.close();
  await viewWhen(host, (view) => view.teams[0].players[1].connected === false);
  const resumed = await resume(token);
  assert.equal(resumed.sessionId, teammate.sessionId);
  await viewWhen(host, (view) => view.teams[0].players[1].connected === true);
  const resumedView = await viewWhen(resumed, (view) => view.match?.turnIndex === 1);
  assert.equal(resumedView.teams[0].score, points);
});

test("the chosen question pack supplies fresh ballots, with misses and host awards resolved normally", { timeout: 40_000 }, async (t) => {
  const { create, join, send, takeSeat, viewWhen, expectRejected } = await openSurveyServer(t);
  const host = await create();
  const apples = [host, await join(host, "Юля")];
  const oranges = [await join(host, "Маша"), await join(host, "Саша")];
  const players = [...apples, ...oranges];
  const waiting = await viewWhen(host, (view) => view.unassigned.length === players.length);
  const previews = waiting.questionPacks!;
  assert.equal(waiting.questionPack, "classic");
  assert.deepEqual(previews.map(({ id }) => id), ["classic", "adult"]);
  for (const preview of previews) {
    const pack = questionPacks[preview.id];
    assert.equal(preview.name, pack.name);
    assert.equal(preview.scoring, pack.scoring);
    assert.deepEqual(preview.prompts, pack.questions.map(({ prompt }) => prompt));
    assert.deepEqual(preview.categories, pack.questionCategories);
    assert.deepEqual(Object.keys(preview).sort(), [
      ...(preview.categories ? ["categories"] : []), "id", "name", "prompts", "scoring",
    ]);
  }
  const guestLobby = await viewWhen(oranges[0], (view) => view.unassigned.length === players.length);
  assert.equal(guestLobby.questionPacks, undefined);
  send(oranges[0], { type: "select-pack", packId: "adult" });
  await expectRejected(oranges[0], /ведущему/);
  host.send("action", { type: "select-pack", packId: "unknown" });
  await expectRejected(host, /набора вопросов нет/);
  send(host, { type: "select-pack", packId: "adult" });
  assert.equal((await viewWhen(oranges[0], (view) => view.questionPack === "adult")).questionPacks, undefined);
  await Promise.all(players.map((player, index) => takeSeat(player, Math.floor(index / 2), index % 2)));
  send(host, { type: "start" });
  const seen = new Set<number>();
  const adult = questionPacks.adult.questions;

  async function voteForQuestion(questionIndex: number) {
    const view = await viewWhen(host, ({ match }) => match?.phase === "ballot" && match.questionIndex === questionIndex);
    const match = view.match!;
    const { choices } = match.ballot!;
    assert.equal(view.questionPack, "adult");
    assert.equal(view.questionPacks, undefined);
    assert.equal(match.question, null);
    assert.equal(match.resultsStats, undefined);
    assert.equal(choices.length, 3);
    const guest = await viewWhen(oranges[0], (state) => state.match?.phaseId === match.phaseId);
    assert.deepEqual(guest.match?.ballot?.choices, choices);
    for (const { id, prompt } of choices) {
      assert.equal(seen.has(id), false, `Question ${id} repeated between ballots`);
      assert.equal(adult[id].prompt, prompt);
      seen.add(id);
    }
    for (const player of players) {
      send(player, { type: "question", phaseId: match.phaseId, id: choices[0].id });
    }
    return adult[choices[0].id];
  }

  async function playTurn(questionIndex: number, turnIndex: number, text: string) {
    const ready = (await viewWhen(host, (view) =>
      view.match?.phase === "ready" && view.match.questionIndex === questionIndex &&
      view.match.turnIndex === turnIndex, SURVEY_RESOLUTION_MS + 1_000)).match!;
    const team = ready.activeTeam === 0 ? apples : oranges;
    for (const player of team) send(player, { type: "ready", phaseId: ready.phaseId });
    const turn = (await viewWhen(host, (view) => view.match?.phase === "turn")).match!;
    send(team[0], { type: "propose", phaseId: turn.phaseId, text });
    await viewWhen(host, (view) => view.match?.proposals[0]?.text === text);
    for (const player of team) send(player, { type: "vote", phaseId: turn.phaseId, id: 0 });
    await viewWhen(team[0], (view) => view.match?.confirmationId === 0 && view.match.votes.length === team.length);
    const confirmer = questionIndex === 0 && turnIndex === 0 ? team[1] : team[0];
    send(confirmer, { type: "confirm", phaseId: turn.phaseId, id: 0 });
    return viewWhen(host, (view) =>
      view.match?.phase === "resolution" && view.match.turnIndex === turnIndex);
  }

  const first = await voteForQuestion(0);
  send(host, { type: "select-pack", packId: "classic" });
  await expectRejected(host, /только в комнате ожидания/);
  const [unclaimed, orangesHit, applesHit, orangesLastHit] = first.answers;
  const miss = "Совершенно неизвестный вариант";
  const results = [
    { text: miss, kind: "miss" },
    { text: orangesHit.label, kind: "hit" },
    { text: applesHit.label, kind: "hit" },
    { text: orangesLastHit.label, kind: "hit" },
  ] as const;
  for (const [turnIndex, { text, kind }] of results.entries()) {
    const resolved = await playTurn(0, turnIndex, text);
    assert.equal(resolved.match?.resolution?.kind, kind);
    assert.equal(resolved.match?.question?.answers[0], null);
    if (kind === "miss") {
      assert.deepEqual(resolved.match?.resolution, { team: 0, text, points: 0, kind: "miss" });
      assert.deepEqual(resolved.match?.question?.answers, Array(6).fill(null));
      assert.deepEqual(resolved.teams.map(({ score }) => score), [0, 0]);
      send(host, { type: "award-answer", phaseId: resolved.match!.phaseId, answerIndex: 0, team: 0 });
      await expectRejected(host);
    }
  }

  const revealed = await viewWhen(host, (view) => view.match?.phase === "reveal", SURVEY_RESOLUTION_MS + 1_000);
  const match = revealed.match!;
  const credit = { type: "award-answer", phaseId: match.phaseId, answerIndex: 0, team: 0 } as const;
  const applesScore = applesHit.points;
  const orangesScore = orangesHit.points + orangesLastHit.points;
  assert.deepEqual(match.question?.answers[0], { label: unclaimed.label, points: unclaimed.points });
  assert.deepEqual(revealed.teams.map(({ score }) => score), [applesScore, orangesScore]);
  await viewWhen(apples[1], (view) => view.match?.phase === "reveal" && view.match.phaseId === match.phaseId);
  send(apples[1], credit);
  await expectRejected(apples[1], /ведущему/);
  send(host, { ...credit, team: 2 });
  await expectRejected(host);
  send(host, { ...credit, answerIndex: 6 });
  await expectRejected(host);
  send(host, credit);
  const awarded = await viewWhen(oranges[0], (view) => view.match?.opened.some(([answer]) => answer === 0) === true);
  const expectedScores = [applesScore + unclaimed.points, orangesScore];
  assert.deepEqual(awarded.teams.map(({ score }) => score), expectedScores);
  assert.ok(awarded.match?.opened.some(([answer, team]) => answer === 0 && team === 0));
  assert.deepEqual(awarded.match?.turnHistory, match.turnHistory);
  assert.equal(awarded.match?.resultsStats, undefined);
  send(host, { ...credit, team: 1 });
  await expectRejected(host);
  send(host, { ...credit, answerIndex: 1 });
  await expectRejected(host);

  send(host, { type: "next", phaseId: match.phaseId });
  const next = await viewWhen(host, (view) => view.match?.phase === "ballot" && view.match.questionIndex === 1);
  assert.deepEqual(next.teams.map(({ score }) => score), expectedScores);
  assert.deepEqual(next.match?.opened, []);
  for (const questionIndex of [1, 2]) {
    await voteForQuestion(questionIndex);
    for (let turnIndex = 0; turnIndex < 4; turnIndex++) {
      const resolved = await playTurn(questionIndex, turnIndex, miss);
      assert.equal(resolved.match?.resolution?.kind, "miss");
    }
    const recap = await viewWhen(host, ({ match }) =>
      match?.phase === "reveal" && match.questionIndex === questionIndex, SURVEY_RESOLUTION_MS + 1_000);
    send(host, { type: "next", phaseId: recap.match!.phaseId });
  }

  assert.equal(seen.size, 9);
  const finished = await viewWhen(host, ({ match }) => match?.phase === "results");
  assert.deepEqual(finished.teams.map(({ score }) => score), expectedScores);
  const recapStats = finished.match?.resultsStats;
  assert.ok(recapStats);
  assert.deepEqual(recapStats.teams.map(({ answers }) => answers.reduce((sum, { points }) => sum + points, 0)), expectedScores);
  assert.deepEqual(recapStats.teams[0].answers.find(({ kind }) => kind === "awarded"), {
    questionIndex: 0, prompt: first.prompt, text: unclaimed.label, points: unclaimed.points, kind: "awarded",
  });
  assert.deepEqual(recapStats.teams[1].answers.map(({ questionIndex }) => questionIndex), [0, 0, 1, 1, 2, 2]);
  assert.equal(recapStats.titles.some(({ id }) => id === "ideas"), false);
  assert.equal(recapStats.titles.find(({ id }) => id === "confirmations")?.name, "Маша");
  assert.equal(recapStats.titles.find(({ id }) => id === "confirmations")?.value, 6);
  const guestResults = await viewWhen(oranges[1], ({ match }) => match?.phase === "results");
  assert.deepEqual(guestResults.match?.resultsStats, recapStats);
  send(host, { type: "replay", phaseId: finished.match!.phaseId });
  const restartedLobby = await viewWhen(host, ({ match }) => match === null);
  assert.equal(restartedLobby.questionPack, "adult");
  assert.deepEqual(restartedLobby.questionPacks, previews);
  if (adult.length >= 12) {
    send(host, { type: "start" });
    await voteForQuestion(0);
    assert.equal(seen.size, 12);
  }
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
  for (const player of players) send(player, {
    type: "question", phaseId: ballot.phaseId, id: ballot.ballot!.choices[0].id,
  });
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
