import { test } from "node:test";
import assert from "node:assert/strict";
import {
  act,
  addPlayer,
  createGame,
  speaker,
  tick,
  view,
  type Game,
} from "../shared/game";
function prepared(count = 12) {
  const g = createGame("p0");
  for (let i = 0; i < count; i++) addPlayer(g, "p" + i, "Игрок " + i);
  act(g, "p0", { type: "start" }, 0);
  g.players.forEach((p, i) =>
    act(
      g,
      p.id,
      {
        type: "words",
        words: Array.from({ length: 5 }, (_, j) => `Слово ${i}-${j}`),
      },
      0,
      () => 0.4,
    ),
  );
  return g;
}
function begin(g: Game, at = 0) {
  act(g, speaker(g)!.id, { type: "begin" }, at);
}
function correct(g: Game, at = 1) {
  act(g, speaker(g)!.id, { type: "correct" }, at);
}
function secondRound() {
  const g = prepared();
  for (let i = 0; i < g.teams.length; i++) {
    begin(g);
    for (let j = 0; j < 4; j++) correct(g);
    tick(g, 60_000);
  }
  act(g, "p0", { type: "round2" }, 60_001, () => 0.4);
  return g;
}
test("balanced teams never exceed four at 4..15 players", () => {
  for (let n = 4; n <= 15; n++) {
    const g = prepared(n);
    assert.ok(
      g.teams.every((_, i) => {
        const size = g.players.filter((p) => p.team === i).length;
        return size >= 2 && size <= 4;
      }),
    );
  }
});
test("only guessed first-round cards enter the second round", () => {
  const g = secondRound();
  assert.equal(g.deck.length, 12);
  assert.equal(g.guessed.length, 12);
  assert.equal(g.round, 2);
});
test("server views hide all secret cards and other submitted words", () => {
  const g = prepared();
  begin(g);
  const other = g.players.find((p) => p.id !== speaker(g)!.id)!;
  const v = view(g, other.id, 1);
  assert.equal(v.currentWord, null);
  assert.ok(!("deck" in v));
  assert.ok(!("guessed" in v));
  assert.ok(!("words" in v.players[0]));
  assert.ok(view(g, speaker(g)!.id, 1).currentWord);
});
test("failed card and its hint survive transfer and explainer remains fixed on return", () => {
  const g = secondRound();
  begin(g);
  const card = g.current!.id,
    first = speaker(g)!.id;
  act(g, first, { type: "hint", text: "Пример" }, 1);
  tick(g, g.deadline);
  assert.equal(g.current!.id, card);
  assert.equal(g.hints[0].text, "Пример");
  for (let i = 1; i < g.teams.length; i++) {
    begin(g, 100_000 * i);
    tick(g, g.deadline);
  }
  assert.equal(speaker(g)!.id, first);
  assert.equal(g.current!.id, card);
});
test("three correct cards pass the next card to the next team", () => {
  const g = secondRound();
  const first = g.activeTeam;
  for (let i = 0; i < 3; i++) {
    begin(g);
    act(g, speaker(g)!.id, { type: "hint", text: "Подсказка" }, 1);
    correct(g, 2);
  }
  assert.notEqual(g.activeTeam, first);
  assert.equal(g.streak, 0);
  assert.equal(g.teams[first].score2, 3);
});
test("same hint and multi-word hints are rejected without points", () => {
  const g = secondRound();
  begin(g);
  assert.throws(() =>
    act(g, speaker(g)!.id, { type: "hint", text: "Два слова" }, 1),
  );
  act(g, speaker(g)!.id, { type: "hint", text: "Один" }, 1);
  tick(g, g.deadline);
  begin(g);
  assert.throws(() =>
    act(g, speaker(g)!.id, { type: "hint", text: "один" }, 1),
  );
  assert.throws(() => correct(g));
});
test("deadline is processed before a late correct command", () => {
  const g = prepared();
  begin(g);
  assert.throws(() => correct(g, 60_000));
  assert.equal(g.teams[0].score1, 0);
});
test("unresolved card is discarded after two full cycles", () => {
  const g = secondRound();
  const word = g.deck[0].word;
  for (let i = 0; i < 6; i++) {
    begin(g, i * 30_000);
    tick(g, g.deadline);
  }
  assert.equal(g.current, null);
  assert.deepEqual(g.unresolved, [word]);
});
test("full game finishes and replay retains room members with a fresh pool", () => {
  const g = secondRound();
  let now = 100_000;
  while (g.phase !== "results") {
    begin(g, now);
    act(g, speaker(g)!.id, { type: "hint", text: "Пример" }, now + 1);
    correct(g, now + 2);
    now += 100;
  }
  assert.equal(
    g.teams.reduce((sum, t) => sum + t.score2, 0),
    12,
  );
  const rev = g.revision;
  act(g, "p0", { type: "replay" }, now);
  assert.equal(g.phase, "lobby");
  assert.equal(g.players.length, 12);
  assert.ok(g.revision > rev);
  assert.equal(g.deck.length, 0);
});
