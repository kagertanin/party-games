import assert from "node:assert/strict";
import { test } from "node:test";
import { SurveyGame, type Question } from "../src/survey/survey";
import { renderTurnSpiral } from "../src/survey/turn-spiral";

const question: Question = {
  prompt: "Что берут с собой на пикник?",
  answers: [
    { label: "Еда", points: 25, aliases: ["бутерброды"] },
    { label: "Плед", points: 20, aliases: ["одеяло"] },
    { label: "Вода", points: 15, aliases: [] },
    { label: "Посуда", points: 10, aliases: [] },
    { label: "Мяч", points: 8, aliases: [] },
    { label: "Салфетки", points: 4, aliases: [] },
  ],
};

function playAnswer(game: SurveyGame, answer: string): void {
  game.propose(0, answer);
  game.vote(0, game.proposals[0].id);
  game.finishTurn();
}

test("10–12 players are evenly assigned to three teams", () => {
  assert.deepEqual(new SurveyGame([question], 10).teams.map((t) => t.players.length), [4, 3, 3]);
  assert.deepEqual(new SurveyGame([question], 11).teams.map((t) => t.players.length), [4, 4, 3]);
  assert.deepEqual(new SurveyGame([question], 12).teams.map((t) => t.players.length), [4, 4, 4]);
  assert.throws(() => new SurveyGame([question], 13));
});

test("six different hits complete the board in two circuits, with each answer credited to its team", () => {
  const game = new SurveyGame([question], 12);
  const order = [];
  for (const answer of question.answers) {
    order.push(game.activeTeam);
    playAnswer(game, answer.label);
  }
  assert.deepEqual(order, [0, 1, 2, 0, 1, 2]);
  assert.equal(game.phase, "reveal");
  assert.deepEqual([...game.opened.entries()], [[0, 0], [1, 1], [2, 2], [3, 0], [4, 1], [5, 2]]);
  assert.deepEqual(game.teams.map((t) => t.score), [35, 28, 19]);
});

test("three circuits end the question and unopened rows award no points", () => {
  const game = new SurveyGame([question], 12);
  playAnswer(game, "Бутерброды!");
  for (let turn = 1; turn < 9; turn++) {
    assert.equal(game.phase, "turn");
    assert.equal(game.turnIndex, turn);
    playAnswer(game, "Пылесос");
  }
  assert.equal(game.phase, "reveal");
  assert.equal(game.opened.size, 1);
  assert.deepEqual(game.teams.map((t) => t.score), [25, 0, 0]);
  game.finishTurn();
  assert.deepEqual(game.teams.map((t) => t.score), [25, 0, 0]);
});

test("each team starts one question; final reveal is followed by results", () => {
  const game = new SurveyGame([question, question, question], 12);
  for (let questionIndex = 0; questionIndex < 3; questionIndex++) {
    assert.equal(game.activeTeam, questionIndex);
    assert.deepEqual([0, 1, 2].map((turn) => game.teamForTurn(turn)), [
      questionIndex, (questionIndex + 1) % 3, (questionIndex + 2) % 3,
    ]);
    assert.equal(game.turnIndex, 0);
    assert.equal(game.opened.size, 0);
    playAnswer(game, "Еда");
    for (let turn = 1; turn < 9; turn++) game.finishTurn();
    assert.equal(game.phase, "reveal");
    game.nextQuestion();
  }
  assert.equal(game.phase, "results");
  assert.deepEqual(game.teams.map((t) => t.score), [25, 25, 25]);
});

test("the spiral follows turn order and ends at its last checkpoint", () => {
  const spiral = renderTurnSpiral([1, 2, 0], 3, 4, true);
  const nodes = Array.from(spiral.matchAll(/survey-spiral-node survey-team-(\d)([^"]*)/g));
  assert.deepEqual(nodes.map(([, team]) => Number(team)), [1, 2, 0, 1, 2, 0, 1, 2, 0]);
  assert.deepEqual(nodes.map(([, , state]) => state.trim()), [
    "is-played", "is-played", "is-played", "is-played", "is-current", "", "", "", "",
  ]);
  const path = spiral.match(/class="survey-spiral-track" d="([^"]+)"/)![1];
  const lastDot = Array.from(spiral.matchAll(/class="survey-spiral-dot" cx="([^"]+)" cy="([^"]+)"/g)).at(-1)!;
  assert.equal(path.split(" L").at(-1), `${lastDot[1]} ${lastDot[2]}`);

  const revealed = renderTurnSpiral([1, 2, 0], 3, 6, false);
  assert.equal(Array.from(revealed.matchAll(/is-played/g)).length, 6);
  assert.doesNotMatch(revealed, /is-current/);
});

test("proposals and votes are separate; members can switch their single vote", () => {
  const game = new SurveyGame([question], 10, () => 0);
  game.propose(0, "Бутерброды");
  game.propose(1, "  бутерброды!  ");
  game.propose(2, "Мяч");
  assert.equal(game.proposals.length, 2);
  assert.equal(game.votes.size, 0);
  assert.equal(game.hasProposed(1), true);
  assert.throws(() => game.propose(1, "Вода"));
  game.vote(0, game.proposals[0].id);
  game.vote(1, game.proposals[0].id);
  game.vote(2, game.proposals[1].id);
  game.vote(0, game.proposals[1].id);
  assert.equal(game.votes.size, 3);
  game.finishTurn();
  assert.deepEqual(game.lastAnswer, { team: 0, text: "Мяч", points: 8, kind: "hit" });
  assert.equal(game.proposals.length, 0);
  assert.equal(game.votes.size, 0);
  assert.equal(game.hasProposed(0), false);
  assert.equal(game.activeTeam, 1);
});

test("a tied vote selects from tied leaders; blank votes pass and previously opened aliases give no points", () => {
  const game = new SurveyGame([question], 10, () => 0.9);
  game.propose(0, "Мяч");
  game.propose(1, "Еда");
  game.propose(2, "Плед");
  game.vote(0, game.proposals[0].id);
  game.vote(1, game.proposals[1].id);
  game.finishTurn();
  assert.equal(game.lastAnswer?.text, "Еда");
  playAnswer(game, "бутерброды");
  assert.equal(game.lastAnswer?.kind, "repeat");
  assert.equal(game.teams[1].score, 0);
  game.propose(0, "Плед");
  game.finishTurn();
  assert.equal(game.lastAnswer?.kind, "pass");
  assert.equal(game.teams[2].score, 0);
  assert.equal(game.opened.size, 1);
});
