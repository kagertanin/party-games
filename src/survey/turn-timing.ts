const FIRST_CIRCUIT_TURN_MS = 180_000;
const FIRST_CIRCUIT_COUNTDOWN_MS = 30_000;
const STANDARD_TURN_MS = 60_000;
const VOTE_ONLY_MS = 10_000;
export const READINESS_MS = 20_000;
const FIRST_CIRCUIT_READINESS_COUNTDOWN_MS = 10_000;

function isOpeningCircuit(questionIndex: number, turnIndex: number, teamCount: number): boolean {
  return questionIndex === 0 && turnIndex < teamCount;
}

export function getTurnTiming(
  questionIndex: number,
  turnIndex: number,
  teamCount: number,
): { durationMs: number; showClockAtMs: number; voteOnlyMs: number } {
  const isFirstCircuit = isOpeningCircuit(questionIndex, turnIndex, teamCount);
  return {
    durationMs: isFirstCircuit ? FIRST_CIRCUIT_TURN_MS : STANDARD_TURN_MS,
    showClockAtMs: isFirstCircuit ? FIRST_CIRCUIT_TURN_MS - FIRST_CIRCUIT_COUNTDOWN_MS : 0,
    voteOnlyMs: VOTE_ONLY_MS,
  };
}

export function getReadinessClockAtMs(questionIndex: number, turnIndex: number, teamCount: number): number {
  return isOpeningCircuit(questionIndex, turnIndex, teamCount)
    ? READINESS_MS - FIRST_CIRCUIT_READINESS_COUNTDOWN_MS
    : 0;
}
