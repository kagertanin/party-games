const FIRST_CIRCUIT_TURN_MS = 180_000;
const FIRST_CIRCUIT_COUNTDOWN_MS = 30_000;
const STANDARD_TURN_MS = 60_000;
const VOTE_ONLY_MS = 10_000;

export function getTurnTiming(
  questionIndex: number,
  turnIndex: number,
  teamCount: number,
): { durationMs: number; showClockAtMs: number; voteOnlyMs: number } {
  const isFirstCircuit = questionIndex === 0 && turnIndex < teamCount;
  return {
    durationMs: isFirstCircuit ? FIRST_CIRCUIT_TURN_MS : STANDARD_TURN_MS,
    showClockAtMs: isFirstCircuit ? FIRST_CIRCUIT_TURN_MS - FIRST_CIRCUIT_COUNTDOWN_MS : 0,
    voteOnlyMs: VOTE_ONLY_MS,
  };
}
