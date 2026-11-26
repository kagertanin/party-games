import type { SurveyMatchView, SurveyRoomView } from "../../shared/survey-online";
import type { SurveyGame } from "./survey";

export type SurveyDisplay = Pick<SurveyGame,
  "teams" | "phase" | "questionIndex" | "questionLimit" | "turnIndex" | "activeTeam" |
  "opened" | "votes" | "turnHistory" | "teamForTurn" | "lastAnswer" | "proposals" |
  "hasProposed" | "confirmationCandidate"
> & {
  question: { prompt: string; answers: readonly ({ label: string; points: number } | null)[] };
};

export function displayOnlineMatch(room: SurveyRoomView, match: SurveyMatchView): SurveyDisplay {
  return {
    teams: room.teams.map(({ name, score, players }) => ({ name, score, players: players.map((player) => player.name) })),
    phase: match.phase === "reveal" || match.phase === "results" ? match.phase : "turn",
    questionIndex: match.questionIndex,
    questionLimit: match.questionLimit,
    turnIndex: match.turnIndex,
    activeTeam: match.activeTeam,
    question: match.question ?? { prompt: "", answers: [] },
    opened: new Map(match.opened),
    votes: new Map(match.votes),
    turnHistory: match.turnHistory,
    teamForTurn: (turn) => (match.questionIndex + turn) % room.teamCount,
    lastAnswer: match.turnHistory.at(-1) ?? null,
    proposals: match.proposals,
    hasProposed: () => match.submitted,
    confirmationCandidate: () => match.proposals.find(({ id }) => id === match.confirmationId),
  };
}
