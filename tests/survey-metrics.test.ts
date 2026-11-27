import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";

test("survey journals preserve event order and omit raw player data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "survey-metrics-"));
  const previousDirectory = process.env.SURVEY_METRICS_DIR;
  process.env.SURVEY_METRICS_DIR = directory;
  t.after(async () => {
    if (previousDirectory === undefined) delete process.env.SURVEY_METRICS_DIR;
    else process.env.SURVEY_METRICS_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  });

  const { SurveyMetrics } = await import("../server/survey-metrics.js");
  const firstRoom = new SurveyMetrics();
  const secondRoom = new SurveyMetrics();
  const at = Date.UTC(2026, 6, 7, 18, 30);
  const player = "raw-player-key";
  const proposal = {
    at,
    player,
    phase: "turn" as const,
    action: "propose",
    accepted: true,
    round: 0,
    turn: 2,
    optionId: 0,
    input: "keyboard",
    text: "raw-proposal-text",
    name: "raw-player-name",
    resumeId: "raw-resume-key",
  };
  firstRoom.record("action", proposal);
  firstRoom.record("action", { at: at + 1, player, action: "confirm", input: "raw-input", outcome: "raw-outcome" });
  firstRoom.record("action", { at: at + 2, player, action: "raw-action" });
  secondRoom.record("action", { ...proposal, at: at + 3 });

  const path = join(directory, "survey-2026-07-07.jsonl");
  let journal = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      journal = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (journal.includes(new Date(at + 3).toISOString()) && journal.endsWith("\n")) break;
    await setTimeout(10);
  }
  assert.ok(journal.endsWith("\n"), "the journal should contain complete lines");
  assert.doesNotMatch(journal, /raw-/);
  const entries = journal.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(entries.map(({ action, at }) => [action, at]), [
    ["propose", new Date(at).toISOString()],
    ["confirm", new Date(at + 1).toISOString()],
    ["propose", new Date(at + 3).toISOString()],
  ]);
  const [first, second, other] = entries;
  assert.deepEqual(first, {
    v: 1,
    game: "survey",
    at: new Date(at).toISOString(),
    room: first.room,
    player: first.player,
    event: "action",
    action: "propose",
    accepted: true,
    phase: "turn",
    round: 0,
    turn: 2,
    optionId: 0,
    input: "keyboard",
  });
  assert.match(first.player, /^[a-f0-9]{24}$/);
  assert.equal(first.player, second.player);
  assert.equal(first.room, second.room);
  assert.notEqual(first.room, other.room);
  assert.notEqual(first.player, other.player);
  assert.equal(second.input, undefined);
  assert.equal(second.outcome, undefined);
});
