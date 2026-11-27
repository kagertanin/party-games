import assert from "node:assert/strict";
import { test } from "node:test";
import { SurveyGame, type Question } from "../src/survey/survey";

const questions: readonly Question[] = [
  {
    prompt: "Что есть в комнате?",
    answers: [
      { label: "Лампа", points: 40, aliases: ["светильник"] },
      { label: "Стол", points: 25, aliases: [] },
      { label: "Стул", points: 15, aliases: [] },
      { label: "Зеркало", points: 10, aliases: [] },
      { label: "Ковёр", points: 6, aliases: [] },
      { label: "Часы", points: 4, aliases: [] },
    ],
  },
  {
    prompt: "На чём ездят по городу?",
    answers: [
      { label: "Автобус", points: 40, aliases: [] },
      { label: "Метро", points: 35, aliases: [] },
      { label: "Такси", points: 10, aliases: [] },
      { label: "Трамвай", points: 7, aliases: [] },
      { label: "Велосипед", points: 5, aliases: [] },
      { label: "Самокат", points: 3, aliases: [] },
    ],
  },
];
const roster = [["Дима", "Маша"], ["Лера", "Саша"]];

test("recap preserves both questions and awards titles for unique leaders and the best single answer", () => {
  const game = new SurveyGame(questions, 4, Math.random, 2, 2, roster);
  game.selectQuestion(0);

  game.propose(1, "Лампа");
  game.propose(0, "  лампа! ");
  assert.equal(game.proposals.length, 1);
  game.vote(0, 0);
  game.vote(1, 0);
  game.finishTurn(0, 0);

  game.propose(0, "Стол");
  game.propose(1, "Пуговица");
  game.vote(0, 0);
  game.finishTurn();

  game.propose(1, "Стул");
  game.finishTurn(0, 0);

  game.propose(0, "Лампа");
  game.vote(0, 0);
  game.finishTurn();

  game.awardAnswer(3, 0);
  game.nextQuestion();
  game.selectQuestion(1);

  game.propose(0, "Метро");
  game.vote(0, 0);
  game.finishTurn();

  game.propose(1, "НЛО");
  game.finishTurn(0, 0);

  game.finishTurn();

  game.propose(1, "метро!");
  game.vote(1, 0);
  game.finishTurn();
  game.nextQuestion();

  assert.equal(game.phase, "results");
  assert.deepEqual(game.teams.map(({ score }) => score), [65, 60]);
  const { teams, titles } = game.resultsStats;
  assert.deepEqual(teams.map(({ team, answers }) =>
    [team, answers.map(({ questionIndex, text, points, kind }) => [questionIndex, text, points, kind])]), [
    [0, [
      [0, "Лампа", 40, "hit"],
      [0, "Стул", 15, "hit"],
      [0, "Зеркало", 10, "awarded"],
      [1, "НЛО", 0, "miss"],
      [1, "метро!", 0, "repeat"],
    ]],
    [1, [
      [0, "Стол", 25, "hit"],
      [0, "Лампа", 0, "repeat"],
      [1, "Метро", 35, "hit"],
      [1, "", 0, "pass"],
    ]],
  ]);
  for (const row of teams.flatMap(({ answers }) => answers)) {
    assert.equal(row.prompt, questions[row.questionIndex].prompt);
  }
  assert.deepEqual(titles.map(({ id, name, value }) => ({ id, name, value })), [
    { id: "ideas", name: "Маша", value: 4 },
    { id: "bullseye", name: "Маша", value: 40 },
    { id: "confirmations", name: "Дима", value: 3 },
  ]);
  assert.deepEqual(titles.find(({ id }) => id === "ideas")?.evidence.map(({ text }) => text),
    ["Лампа", "Стул", "НЛО", "метро!"]);
  assert.deepEqual(titles.find(({ id }) => id === "bullseye")?.evidence, [
    { questionIndex: 0, prompt: questions[0].prompt, text: "Лампа", points: 40, kind: "hit" },
  ]);
  assert.deepEqual(titles.find(({ id }) => id === "confirmations")?.evidence.map(({ text, kind }) => [text, kind]),
    [["Лампа", "hit"], ["Стул", "hit"], ["НЛО", "miss"]]);
});

test("tied or zero metrics have no title, and invalid manual confirmations leave the turn intact", () => {
  const question = {
    ...questions[0],
    answers: questions[0].answers.map((answer, index) => index === 1 ? { ...answer, points: 40 } : answer),
  };
  const game = new SurveyGame([question], 4, Math.random, 1, 2, roster);
  assert.deepEqual(game.resultsStats.titles, []);

  game.propose(0, "Лампа");
  assert.throws(() => game.finishTurn(0, 2));
  assert.throws(() => game.finishTurn(undefined, 0));
  assert.equal(game.activeTeam, 0);
  assert.equal(game.proposals.length, 1);
  assert.deepEqual(game.teams.map(({ score }) => score), [0, 0]);
  game.finishTurn(0, 0);

  game.propose(0, "Стол");
  game.finishTurn(0, 0);
  game.finishTurn();
  game.finishTurn();
  game.nextQuestion();

  assert.equal(game.phase, "results");
  assert.deepEqual(game.teams.map(({ score }) => score), [40, 40]);
  assert.deepEqual(game.resultsStats.titles, []);
  const nextGame = new SurveyGame([question], 4, Math.random, 1, 2, roster);
  assert.deepEqual(nextGame.resultsStats, { teams: [{ team: 0, answers: [] }, { team: 1, answers: [] }], titles: [] });
});
