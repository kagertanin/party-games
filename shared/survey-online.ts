import type { TurnResult } from "../src/survey/survey";

export const SURVEY_ROOM = "survey";
export const SURVEY_CODE = /^S[0-9A-F]{6}$/;
export const SURVEY_TEAM_COUNTS = [2, 3] as const;
export const SURVEY_TEAM_SIZES = [2, 3, 4, 5] as const;

export type SurveyMember = { id: string; name: string; connected: boolean };
export type SurveyTeamView = { name: string; score: number; players: SurveyMember[] };
export type SurveyMatchPhase = "ballot" | "ready" | "turn" | "reveal" | "results";

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
  turnHistory: TurnResult[];
};

export type SurveyRoomView = {
  code: string;
  you: string;
  owner: string;
  teamCount: number;
  teamSize: number;
  teams: SurveyTeamView[];
  serverNow: number;
  match: SurveyMatchView | null;
};

export type SurveyOnlineAction =
  | { type: "start" }
  | ({ phaseId: number } & (
      | { type: "question"; id: number }
      | { type: "ready" }
      | { type: "propose"; text: string }
      | { type: "vote"; id: number }
      | { type: "confirm"; id: number }
      | { type: "next" }
      | { type: "replay" }
    ));
