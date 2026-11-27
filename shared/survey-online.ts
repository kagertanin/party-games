import type { TurnResult } from "../src/survey/survey";

export const SURVEY_ROOM = "survey";
export const SURVEY_CODE = /^S[0-9A-F]{6}$/;
export const SURVEY_KICKED_CODE = 4010;
export const SURVEY_TEAM_COUNTS = [2, 3] as const;
export const SURVEY_TEAM_SIZES = [2, 3, 4, 5] as const;
export const SURVEY_MIN_TEAM_SIZE = SURVEY_TEAM_SIZES[0];
export const SURVEY_MAX_TEAM_SIZE = SURVEY_TEAM_SIZES[3];
export const SURVEY_DEFAULT_TEAM_CAPACITY = 4;
export const SURVEY_RESOLUTION_MS = 2_000;
export const SURVEY_PACK_IDS = ["classic", "adult"] as const;

export type SurveyPackId = typeof SURVEY_PACK_IDS[number];
export type SurveyPackPreview = {
  id: SurveyPackId;
  name: string;
  prompts: string[];
  categories?: readonly string[];
  scoring: "survey" | "editorial";
};
export type SurveyMember = { id: string; name: string; connected: boolean };
export type SurveyTeamView = {
  name: string;
  score: number;
  players: SurveyMember[];
  seats?: (SurveyMember | null)[];
  capacity?: number;
  fruitIndex?: number;
};
export type SurveyMatchPhase = "ballot" | "ready" | "turn" | "resolution" | "reveal" | "results";

export type SurveyMatchView = {
  phase: SurveyMatchPhase;
  phaseId: number;
  deadline: number;
  questionIndex: number;
  questionLimit: number;
  turnIndex: number;
  activeTeam: number;
  question: {
    prompt: string;
    answers: ({ label: string; points: number } | null)[];
  } | null;
  ballot: {
    choices: { id: number; prompt: string; votes: number }[];
    selected: number | null;
  } | null;
  proposals: { id: number; text: string }[];
  votes: [playerIndex: number, proposalId: number][];
  opened: [answerIndex: number, teamIndex: number][];
  ready: number[];
  submitted: boolean;
  confirmationId: number | null;
  resolution: TurnResult | null;
  turnHistory: TurnResult[];
};

export type SurveyRoomView = {
  code: string;
  you: string;
  owner: string;
  teamCount: number;
  teamSize: number;
  teams: SurveyTeamView[];
  questionPack: SurveyPackId;
  questionPacks?: SurveyPackPreview[];
  unassigned: SurveyMember[];
  serverNow: number;
  match: SurveyMatchView | null;
};

export function canStartSurvey(
  teams: readonly { players: readonly SurveyMember[] }[],
  unassigned: readonly SurveyMember[],
): boolean {
  return unassigned.every(({ connected }) => !connected) && teams.every(({ players }) =>
    players.filter(({ connected }) => connected).length >= SURVEY_MIN_TEAM_SIZE);
}

export type SurveyOnlineAction =
  | { type: "start" }
  | { type: "add-team" }
  | { type: "remove-team"; team: number }
  | { type: "resize-team"; team: number; delta: -1 | 1 }
  | { type: "take-seat"; team: number; seat: number }
  | { type: "move-player"; memberId: string; team: number; seat: number }
  | { type: "kick-player"; memberId: string }
  | { type: "shuffle-teams" }
  | { type: "select-pack"; packId: SurveyPackId }
  | ({ phaseId: number } & (
      | { type: "question"; id: number }
      | { type: "ready" }
      | { type: "propose"; text: string }
      | { type: "vote"; id: number }
      | { type: "confirm"; id: number }
      | { type: "award-answer"; answerIndex: number; team: number }
      | { type: "next" }
      | { type: "replay" }
    ));
