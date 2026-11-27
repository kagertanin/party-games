import assert from "node:assert/strict";
import { test } from "node:test";
import { QuestionDeck } from "../src/survey/question-deck";

test("draws three choices per ballot and visits the entire pack before repeating", () => {
  for (const size of [9, 10, 27, 30]) {
    const deck = new QuestionDeck(size, () => 0.6);
    const draws = Array.from({ length: 50 }, () => {
      const ballot = deck.draw();
      assert.equal(ballot.length, 3);
      return ballot;
    }).flat();

    assert.equal(new Set(draws.slice(0, size)).size, size);
    for (let start = 0; start + 9 <= draws.length; start++) {
      assert.equal(new Set(draws.slice(start, start + 9)).size, 9, `size ${size}, draw ${start}`);
    }
  }
});

test("uses the shuffle order and allocates an independent deck for each instance", () => {
  const first = new QuestionDeck(10, () => 0);
  const other = new QuestionDeck(10, () => 0.99);
  assert.notDeepEqual(first.draw(), other.draw());
  assert.throws(() => new QuestionDeck(8));
});
