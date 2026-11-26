import assert from "node:assert/strict";
import { test } from "node:test";
import { SurveyGame, TurnReadiness, type Question } from "../src/survey/survey";
import { renderTurnSpiral } from "../src/survey/turn-spiral";
import { getReadinessClockAtMs, getTurnTiming, READINESS_MS } from "../src/survey/turn-timing";

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
  assert.deepEqual(new SurveyGame([question], 10).teams.map((t) => t.name), ["Яблоки", "Апельсины", "Сливы"]);
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

test("two circuits end the question and unopened rows award no points", () => {
  const game = new SurveyGame([question], 12);
  playAnswer(game, "Бутерброды!");
  for (let turn = 1; turn < 6; turn++) {
    assert.equal(game.phase, "turn");
    assert.equal(game.turnIndex, turn);
    playAnswer(game, "Пылесос");
  }
  assert.equal(game.phase, "reveal");
  assert.deepEqual(game.turnHistory.map(({ team }) => team), [0, 1, 2, 0, 1, 2]);
  assert.equal(game.opened.size, 1);
  assert.deepEqual(game.teams.map((t) => t.score), [25, 0, 0]);
  game.finishTurn();
  assert.equal(game.turnHistory.length, 6);
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
    for (let turn = 1; turn < 6; turn++) game.finishTurn();
    assert.equal(game.phase, "reveal");
    game.nextQuestion();
  }
  assert.equal(game.phase, "results");
  assert.deepEqual(game.teams.map((t) => t.score), [25, 25, 25]);
});

test("voted question IDs select their own answers without changing round order or match length", () => {
  const pool = Array.from({length: 5}, (_, id) => ({
    ...question, prompt: `Вопрос ${id}`,
    answers: question.answers.map((answer) => ({...answer, points: answer.points + id})),
  }));
  const game = new SurveyGame(pool, 12, () => 0, 3);
  for (const [index, id] of [2, 4, 3].entries()) {
    game.selectQuestion(id);
    assert.equal(game.question.prompt, pool[id].prompt);
    assert.equal(game.questionId, id);
    assert.equal(game.activeTeam, index);
    assert.throws(() => game.selectQuestion(0));
    playAnswer(game, "Еда");
    assert.equal(game.lastAnswer?.points, 25 + id);
    for (let turn = 1; turn < 6; turn++) game.finishTurn();
    game.nextQuestion();
  }
  assert.equal(game.phase, "results");
  assert.deepEqual(game.teams.map(({score}) => score), [27, 29, 28]);
});

test("only the first circuit of the game has three minutes and a delayed countdown", () => {
  const openingTiming = { durationMs: 180_000, showClockAtMs: 150_000, voteOnlyMs: 10_000 };
  const standardTiming = { durationMs: 60_000, showClockAtMs: 0, voteOnlyMs: 10_000 };
  assert.deepEqual(getTurnTiming(0, 0, 3), openingTiming);
  assert.deepEqual(getTurnTiming(0, 1, 3), openingTiming);
  assert.deepEqual(getTurnTiming(0, 2, 3), openingTiming);
  assert.deepEqual(getTurnTiming(0, 3, 3), standardTiming);
  assert.deepEqual(getTurnTiming(0, 5, 3), standardTiming);
  assert.deepEqual(getTurnTiming(1, 0, 3), standardTiming);
  assert.deepEqual(getTurnTiming(2, 0, 3), standardTiming);
  assert.deepEqual(getTurnTiming(0, 2, 2), standardTiming);
});

test("only the opening readiness timer hides its first ten seconds", () => {
  assert.equal(READINESS_MS, 20_000);
  assert.equal(getReadinessClockAtMs(0, 0, 3), 10_000);
  assert.equal(getReadinessClockAtMs(0, 2, 3), 10_000);
  assert.equal(getReadinessClockAtMs(0, 3, 3), 0);
  assert.equal(getReadinessClockAtMs(0, 5, 3), 0);
  assert.equal(getReadinessClockAtMs(1, 0, 3), 0);
  assert.equal(getReadinessClockAtMs(2, 0, 3), 0);
});

test("readiness starts the turn as soon as all teammates confirm", () => {
  const readiness = new TurnReadiness(3, 1_000);
  assert.equal(readiness.remaining(1_000), 20_000);
  assert.equal(readiness.confirm(0, 1_100), false);
  assert.equal(readiness.confirm(0, 1_200), false);
  assert.equal(readiness.count, 1);
  assert.equal(readiness.isReady(0), true);
  assert.equal(readiness.isReady(1), false);
  assert.equal(readiness.confirm(1, 1_300), false);
  assert.equal(readiness.confirm(2, 1_400), true);
  assert.equal(readiness.confirm(2, 1_500), true);
  assert.equal(readiness.shouldStart(1_500), true);
  assert.equal(readiness.count, 3);
  assert.throws(() => readiness.confirm(3, 1_500), RangeError);
});

test("readiness expires twenty seconds after it starts even when teammates wait", () => {
  const readiness = new TurnReadiness(3, 50_000);
  readiness.confirm(0, 51_000);
  assert.equal(readiness.remaining(60_000), 10_000);
  assert.equal(readiness.remaining(69_999), 1);
  assert.equal(readiness.shouldStart(69_999), false);
  assert.equal(readiness.shouldStart(70_000), true);
  assert.equal(readiness.remaining(80_000), 0);
  assert.equal(readiness.confirm(1, 70_001), true);
  assert.equal(readiness.isReady(1), false);
  assert.equal(readiness.count, 1);
  assert.throws(() => new TurnReadiness(0, 50_000), RangeError);
  assert.throws(() => new TurnReadiness(3, Number.NaN), RangeError);
});

test("turn history stores the outcome and opened row, then resets on the next question", () => {
  const game = new SurveyGame([question, question], 12);
  playAnswer(game, "одеяло");
  playAnswer(game, "Пылесос");
  playAnswer(game, "Плед");
  game.finishTurn();
  assert.deepEqual(game.turnHistory, [
    { team: 0, text: "одеяло", points: 20, kind: "hit", answerIndex: 1 },
    { team: 1, text: "Пылесос", points: 0, kind: "miss" },
    { team: 2, text: "Плед", points: 0, kind: "repeat" },
    { team: 0, text: "", points: 0, kind: "pass" },
  ]);
  assert.equal(game.lastAnswer, game.turnHistory[3]);
  while (game.phase === "turn") game.finishTurn();
  assert.equal(game.turnHistory.length, 6);
  game.nextQuestion();
  assert.deepEqual(game.turnHistory, []);
  assert.equal(game.lastAnswer, null);
  assert.equal(game.teams[0].score, 20);
});

test("the spiral follows team order and ends at its last fruit checkpoint", () => {
  const history = [
    { text: "Еда", kind: "hit" },
    { text: 'Вариант <с кавычками> "&"', kind: "miss" },
    { text: "Плед", kind: "repeat" },
    { text: "", kind: "pass" },
  ] as const;
  const spiral = renderTurnSpiral([1, 2, 0], 2, history.length, true, history);
  const nodes = Array.from(spiral.matchAll(
    /survey-spiral-node survey-team-(\d)([^"]*)" transform="translate\(([^)]+)\)"/g,
  ));
  assert.deepEqual(nodes.map(([, team]) => Number(team)), [1, 2, 0, 1, 2, 0]);
  assert.deepEqual(nodes.map(([, , state]) => state.trim()), [
    "is-played", "is-played", "is-played", "is-played", "is-current", "",
  ]);
  assert.equal(Array.from(spiral.matchAll(/class="survey-fruit survey-spiral-fruit"/g)).length, 6);
  const path = spiral.match(/class="survey-spiral-track" d="([^"]+)"/)![1];
  assert.equal(path.split(" L").at(-1), nodes.at(-1)![3]);
  const connectors = Array.from(spiral.matchAll(/survey-spiral-connector" d="M([^L]+) L/g));
  assert.deepEqual(connectors.map(([, from]) => from), nodes.slice(0, 4).map((node) => node[3]));
  assert.deepEqual(Array.from(spiral.matchAll(/survey-spiral-label is-(\w+)/g), ([, kind]) => kind), [
    "hit", "miss", "repeat", "pass",
  ]);
  assert.match(spiral, /title="Вариант &lt;с кавычками&gt; &quot;&amp;&quot;\. Ответа нет на табло"/);
  assert.match(spiral, /class="survey-spiral-answer" aria-hidden="true">Пропуск</);

  const revealed = renderTurnSpiral([1, 2, 0], 2, 6, false);
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
  assert.deepEqual(game.lastAnswer, { team: 0, text: "Мяч", points: 8, kind: "hit", answerIndex: 4 });
  assert.equal(game.proposals.length, 0);
  assert.equal(game.votes.size, 0);
  assert.equal(game.hasProposed(0), false);
  assert.equal(game.activeTeam, 1);
});

test("confirmation uses a stable eligible proposal until all votes or the leaders change", () => {
  let draws = 0;
  const game = new SurveyGame([question], 10, () => ++draws === 2 ? 0 : 0.9);
  assert.equal(game.confirmationCandidate(true), undefined);

  game.propose(0, "Еда");
  game.propose(1, "Плед");
  game.propose(2, "Мяч");
  assert.equal(game.confirmationCandidate(false), undefined);
  const partialCandidate = game.confirmationCandidate(true);
  assert.equal(partialCandidate?.text, "Мяч");
  assert.equal(game.confirmationCandidate(true), partialCandidate);
  assert.equal(draws, 1);

  game.vote(0, 0);
  game.vote(1, 1);
  game.vote(2, 0);
  assert.equal(game.confirmationCandidate(false), undefined);
  assert.equal(game.confirmationCandidate(true), partialCandidate);
  assert.equal(draws, 1);

  game.vote(3, 1);
  const tiedLeader = game.confirmationCandidate(false);
  assert.equal(tiedLeader?.text, "Еда");
  assert.equal(game.confirmationCandidate(true), tiedLeader);
  assert.equal(draws, 2);

  game.vote(3, 2);
  assert.equal(game.confirmationCandidate(true), tiedLeader);
  assert.equal(draws, 2);
  game.vote(0, 1);
  assert.equal(game.confirmationCandidate(true)?.text, "Плед");
  game.vote(2, 2);
  assert.equal(game.confirmationCandidate(true)?.text, "Мяч");
  assert.equal(draws, 3);
});

test("manual confirmation submits the exact proposal while timeout still uses the votes", () => {
  const game = new SurveyGame([question], 10, () => 0.9);
  game.propose(0, "Еда");
  game.propose(1, "Плед");
  game.vote(0, 0);
  const candidate = game.confirmationCandidate(true);
  assert.equal(candidate?.text, "Плед");
  assert.throws(() => game.finishTurn(100));
  assert.equal(game.lastAnswer, null);
  assert.equal(game.confirmationCandidate(true), candidate);
  game.finishTurn(candidate!.id);
  assert.deepEqual(game.lastAnswer, { team: 0, text: "Плед", points: 20, kind: "hit", answerIndex: 1 });
  assert.equal(game.confirmationCandidate(true), undefined);

  game.propose(0, "Еда");
  game.propose(1, "Вода");
  game.vote(0, 0);
  assert.equal(game.confirmationCandidate(true)?.text, "Вода");
  game.finishTurn();
  assert.deepEqual(game.lastAnswer, { team: 1, text: "Еда", points: 25, kind: "hit", answerIndex: 0 });
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
