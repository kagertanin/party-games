import { QUESTIONS_PER_MATCH } from "./question-ballot";

const BALLOT_SIZE = 3;
const MATCH_SIZE = BALLOT_SIZE * QUESTIONS_PER_MATCH;

export class QuestionDeck {
  private remaining: number[] = [];
  private readonly recent: number[] = [];

  constructor(private readonly size: number, private readonly random = Math.random) {
    if (!Number.isSafeInteger(size) || size < MATCH_SIZE) {
      throw new RangeError(`В наборе должно быть хотя бы ${MATCH_SIZE} вопросов.`);
    }
  }

  draw(): number[] {
    const ballot: number[] = [];
    for (let i = 0; i < BALLOT_SIZE; i++) {
      if (!this.remaining.length) this.shuffle();
      // On a reshuffle, preserve the previous eight draws to avoid repeats
      // even when a three-round match crosses the end of a deck.
      const next = this.remaining.findIndex((id) => !this.recent.includes(id));
      const [id] = this.remaining.splice(next, 1);
      ballot.push(id);
      this.recent.push(id);
      if (this.recent.length === MATCH_SIZE) this.recent.shift();
    }
    return ballot;
  }

  private shuffle(): void {
    this.remaining = Array.from({ length: this.size }, (_, id) => id);
    for (let i = this.remaining.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [this.remaining[i], this.remaining[j]] = [this.remaining[j], this.remaining[i]];
    }
  }
}
