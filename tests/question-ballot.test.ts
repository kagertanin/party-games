import assert from "node:assert/strict";
import { test } from "node:test";
import { QuestionBallot, QUESTION_BALLOT_CLOCK_MS, QUESTION_BALLOT_MS } from "../src/survey/question-ballot";

test("each player can replace their vote until everybody has voted", () => {
  const ballot = new QuestionBallot([0, 4, 9], 3, 1_000);
  ballot.choose(0, 4, 1_010);
  ballot.choose(0, 4, 1_015);
  ballot.choose(1, 0, 1_020);
  ballot.choose(0, 0, 1_030);
  assert.equal(ballot.count(0), 2);
  assert.equal(ballot.count(4), 0);
  assert.deepEqual([...ballot.votes], [[0, 0], [1, 0]]);
  assert.equal(ballot.shouldFinish(1_040), false);
  assert.equal(ballot.finish(1_040), undefined);

  ballot.choose(2, 0, 1_050);
  assert.equal(ballot.shouldFinish(1_050), true);
  assert.equal(ballot.remaining(1_050), 0);
  assert.equal(ballot.finish(1_050), 0);
  ballot.choose(0, 4, 1_060);
  assert.equal(ballot.votes.get(0), 0);
  assert.equal(ballot.finish(1_070), 0);
});

test("the ballot closes at twenty seconds and ignores votes at the deadline", () => {
  const ballot = new QuestionBallot([2, 3, 4], 3, 50_000);
  assert.equal(QUESTION_BALLOT_MS, 20_000);
  assert.equal(QUESTION_BALLOT_CLOCK_MS, 10_000);
  assert.equal(ballot.remaining(49_999), 20_000);
  assert.equal(ballot.remaining(59_999), 10_001);
  assert.equal(ballot.remaining(60_000), QUESTION_BALLOT_CLOCK_MS);
  ballot.choose(0, 3, 69_999);
  assert.equal(ballot.remaining(69_999), 1);
  assert.equal(ballot.finish(69_999), undefined);
  assert.equal(ballot.shouldFinish(70_000), true);

  ballot.choose(0, 2, 70_000);
  ballot.choose(1, 2, 70_001);
  assert.equal(ballot.finish(70_001), 3);
  assert.deepEqual([...ballot.votes], [[0, 3]]);
});

test("ties randomly select a leader once, including when all candidates have zero votes", () => {
  let draws = 0;
  const draw = () => { draws++; return 0.9; };
  const ballot = new QuestionBallot([6, 7, 8, 9], 3, 0, draw);
  ballot.choose(0, 6, 10);
  ballot.choose(1, 8, 11);
  assert.equal(ballot.finish(20_000), 8);
  assert.equal(ballot.finish(40_000), 8);
  assert.equal(draws, 1);

  const emptyBallot = new QuestionBallot([2, 3, 4], 4, 0, draw);
  assert.equal(emptyBallot.finish(20_000), 4);
  assert.equal(emptyBallot.votes.size, 0);
  assert.equal(draws, 2);
});

test("a ballot checks candidate and player identity before accepting a vote", () => {
  assert.throws(() => new QuestionBallot([], 3, 0), RangeError);
  assert.throws(() => new QuestionBallot([1, 1], 3, 0), RangeError);
  assert.throws(() => new QuestionBallot([1], 0, 0), RangeError);
  assert.throws(() => new QuestionBallot([1], 1, Number.NaN), RangeError);

  const candidates = [2, 3];
  const ballot = new QuestionBallot(candidates, 3, 0);
  candidates.push(4);
  assert.deepEqual(ballot.candidateIds, [2, 3]);
  assert.throws(() => ballot.choose(3, 2, 0), RangeError);
  assert.throws(() => ballot.choose(1, 4, 0), RangeError);
  assert.deepEqual([...ballot.votes], []);
});
