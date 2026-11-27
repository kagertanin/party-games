import assert from "node:assert/strict";
import test from "node:test";
import { drawIntro, DRAW_TIMES } from "../shared/draw";
import { DrawDemo } from "../src/draw/demo";
import { demoExamples } from "../src/draw/demo-examples";

test("solo player draws, captions, likes and votes without waiting for other players", () => {
  const game = new DrawDemo();
  const drawing = [
    {
      color: "#3466bb",
      width: 9,
      erase: false,
      points: [[22, 33] as [number, number]],
    },
  ];
  game.drawings.set(game.you, drawing);
  game.act("ready");
  let view = game.snapshot();
  assert.equal(view.phase, "captions");
  assert.notEqual(view.you, view.artist);
  assert.ok(game.drawings.get(view.artist!)!.length);
  assert.equal(game.drawings.get(view.you), drawing);
  game.act("caption", { text: "Кот решил уйти в отпуск" });
  view = game.snapshot();
  assert.equal(view.phase, "vote");
  const own = view.choices!.find((c) => c.mine)!;
  const artistIndex = game.players.findIndex((p) => p.id === view.artist);
  const truth = view.choices!.find(
    (c) => c.text === demoExamples[artistIndex].prompt,
  )!;
  game.act("vote", { choice: own.id });
  assert.equal(game.phase, "vote");
  game.act("like", { choice: truth.id, likes: true });
  assert.equal(game.snapshot().liked, undefined);
  game.act("vote", { choice: truth.id });
  assert.equal(game.phase, "reveal");
  while (game.snapshot().reveal?.kind !== "favorites") game.next();
  assert.equal(game.deadline - game.snapshot().startedAt, 10000);
  const before = game.snapshot().heartCounts?.[truth.id] ?? 0;
  for (const likes of [true, true, false, true])
    game.act("like", { choice: truth.id, likes });
  assert.deepEqual(game.snapshot().liked, [truth.id]);
  assert.equal(game.snapshot().heartCounts?.[truth.id], before + 1);
  game.act("like", { choice: own.id, likes: true });
  assert.deepEqual(game.snapshot().liked, [truth.id]);
  game.finish();
  assert.equal(game.phase, "results");
  assert.ok(game.players[0].guesses >= 1);
  assert.ok(game.players.every((p) => p.points > 0));
  assert.ok(game.players.some((p) => p.likes > 0));
  assert.ok(game.players.some((p) => p.fooled > 0));
  const scores = structuredClone(game.players);
  game.finish();
  assert.deepEqual(game.players, scores);
});

test("fixed perspectives keep individual drafts and the artist cannot submit a caption or vote", () => {
  const game = new DrawDemo();
  game.perspective = game.players[2].id;
  game.act("ready");
  assert.equal(game.phase, "drawing");
  game.perspective = game.players[0].id;
  assert.equal(game.snapshot().done, false);
  game.next();
  const { artist } = game.snapshot();
  game.perspective = artist!;
  game.act("caption", { text: "Своя подпись" });
  assert.equal(game.snapshot().ready, 0);
  game.perspective = game.players[0].id;
  game.act("caption", { text: "Моя версия" });
  game.perspective = game.players[2].id;
  assert.throws(() => game.act("caption", { text: "моя версия" }));
  game.captionDrafts.set(game.you, "Ещё пишу");
  game.perspective = game.players[0].id;
  assert.equal(game.snapshot().done, true);
  game.perspective = game.players[2].id;
  assert.equal(game.captionDrafts.get(game.you), "Ещё пишу");
  game.next();
  game.perspective = artist!;
  game.act("vote", {
    choice: game.snapshot().choices!.find((c) => !c.mine)!.id,
  });
  assert.equal(game.snapshot().ready, 0);
  game.finish();
  assert.equal(game.snapshot().phase, "results");
});

test("jumping to the finale settles every award once from every stage, including a partial reveal", () => {
  for (const phase of [
    "drawing",
    "captions",
    "vote",
    "ballots",
    "tally",
    "favorites",
    "false",
    "truth",
  ]) {
    const game = new DrawDemo();
    while (
      game.phase !== "results" &&
      game.phase !== phase &&
      game.snapshot().reveal?.kind !== phase
    )
      game.next();
    assert.notEqual(game.phase, "results");
    const before = game.players.map((p) => p.points);
    game.finish();
    assert.equal(game.deadline, 0);
    assert.equal(game.snapshot().turn, game.players.length);
    assert.ok(game.players.every((p, i) => p.points >= before[i]));
    assert.equal(
      game.players.reduce((n, p) => n + p.guesses, 0),
      8,
    );
    assert.equal(
      game.players.reduce((n, p) => n + p.fooled, 0),
      4,
    );
  }
});

test("the drawing clock has a full two minutes after the five-second title and its fades", () => {
  const drawing = new DrawDemo().snapshot();
  assert.equal(drawIntro("drawing"), 8000);
  assert.equal(
    drawing.deadline - drawing.startedAt - drawIntro("drawing"),
    DRAW_TIMES.drawing,
  );
});

test("a popular bluff closes the cumulative board and no future answer leaks", () => {
  const game = new DrawDemo();
  game.next();
  game.next();
  const artist = game.snapshot().artist!;
  const voters = game.players.filter((p) => p.id !== artist);
  let bluff = "";
  for (const p of voters) {
    game.perspective = p.id;
    const options = game.snapshot().choices!;
    if (!bluff) bluff = options.find((o) => o.mine)!.id;
    const pick = options.find(
      (o) =>
        !o.mine &&
        (p === voters[0] ? o.id !== "answer-" + artist : o.id === bluff),
    )!;
    game.act("vote", { choice: pick.id });
  }
  assert.equal(game.snapshot().reveal!.kind, "opening");
  const steps: number[] = [];
  const scores: number[] = [];
  while (game.phase === "reveal") {
    const { reveal, revealed } = game.snapshot();
    const f = reveal!;
    if (f.kind === "ballots") {
      assert.equal(f.titles[0].author, undefined);
      assert.equal(f.awards.length, 0);
      assert.equal(
        game.players.reduce((sum, p) => sum + p.points, 0),
        0,
      );
      assert.deepEqual(
        revealed!.map((r) => r.step),
        steps,
      );
      steps.push(f.step);
    }
    if (f.kind === "truth" || f.kind === "false") {
      assert.equal(steps.length, 4);
      scores.push(f.step);
      assert.ok(f.titles[0].author);
      if (f.step === 3) {
        assert.equal(f.kind, "false");
        assert.equal(f.awards.length, 2);
        assert.ok(
          f.awards.every((a) => a.player === voters[0].id && a.amount === 500),
        );
        assert.deepEqual(
          f.awards.map((a) => a.voter),
          f.titles[0].voters,
        );
      }
    }
    if (f.kind === "favorites")
      assert.ok(revealed!.every((r) => r.titles[0].author));
    game.next();
  }
  assert.deepEqual(steps, [0, 1, 2, 3]);
  assert.deepEqual(scores, steps);
});
