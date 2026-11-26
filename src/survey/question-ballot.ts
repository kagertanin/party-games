export const QUESTION_BALLOT_MS = 20_000;
export const QUESTION_BALLOT_CLOCK_MS = 10_000;
export const QUESTIONS_PER_MATCH = 3;

export class QuestionBallot {
  readonly candidateIds: readonly number[];
  private readonly playerVotes = new Map<number, number>();
  private winner: number | undefined;

  constructor(
    candidateIds: readonly number[],
    private readonly playerCount: number,
    private readonly startedAt: number,
    private readonly random: () => number = Math.random,
  ) {
    if (!candidateIds.length || new Set(candidateIds).size !== candidateIds.length ||
        candidateIds.some((id) => !Number.isSafeInteger(id))) {
      throw new RangeError("Темы голосования должны быть уникальными.");
    }
    if (!Number.isSafeInteger(playerCount) || playerCount < 1) {
      throw new RangeError("В голосовании должен быть хотя бы один игрок.");
    }
    if (!Number.isFinite(startedAt)) throw new RangeError("Неверное время начала голосования.");
    this.candidateIds = Object.freeze([...candidateIds]);
  }

  get votes(): ReadonlyMap<number, number> {
    return this.playerVotes;
  }

  choose(player: number, candidateId: number, now: number): void {
    if (this.finish(now) !== undefined) return;
    if (!Number.isInteger(player) || player < 0 || player >= this.playerCount) {
      throw new RangeError("Игрок не участвует в голосовании.");
    }
    if (!this.candidateIds.includes(candidateId)) throw new RangeError("Выберите тему из списка.");
    this.playerVotes.set(player, candidateId);
    this.finish(now);
  }

  count(candidateId: number): number {
    let count = 0;
    for (const vote of this.playerVotes.values()) {
      if (vote === candidateId) count++;
    }
    return count;
  }

  remaining(now: number): number {
    if (!Number.isFinite(now)) throw new RangeError("Неверное время.");
    if (this.winner !== undefined) return 0;
    const elapsed = Math.max(0, now - this.startedAt);
    return Math.max(0, QUESTION_BALLOT_MS - elapsed);
  }

  shouldFinish(now: number): boolean {
    return this.remaining(now) === 0 || this.playerVotes.size === this.playerCount;
  }

  finish(now: number): number | undefined {
    if (this.winner !== undefined || !this.shouldFinish(now)) return this.winner;
    const totals = this.candidateIds.map((id) => ({ id, count: this.count(id) }));
    const mostVotes = Math.max(...totals.map(({ count }) => count));
    const leaders = totals.filter(({ count }) => count === mostVotes);
    const index = leaders.length === 1 ? 0 : Math.floor(this.random() * leaders.length);
    this.winner = leaders[index].id;
    return this.winner;
  }
}
