export const DRAW_ROOM = "risovach";
export const DRAW_MIN = 3;
export const DRAW_MAX = 12;
export const DRAW_KICKED = 4005;
// Includes fading out the previous screen, lettering in, the hold and lettering out.
export function drawIntro(phase: Phase) {
  return phase === "drawing" ? 8000 : phase === "lobby" ? 0 : 2700;
}
export const DRAW_TIMES = {
  drawing: 120000,
  captions: 30000,
  vote: 40000,
  reveal: 0,
};
export type Phase = "lobby" | keyof typeof DRAW_TIMES | "results";
export interface DrawPlayer {
  id: string;
  name: string;
  connected: boolean;
  points: number;
  guesses: number;
  fooled: number;
  likes: number;
  streak: number;
}
export interface Choice {
  id: string;
  text: string;
  mine: boolean;
}
export interface RevealTitle {
  id: string;
  text: string;
  voters: string[];
  author?: string;
}
export interface RevealAward {
  voter: string;
  player: string;
  amount: number;
  reason: "fooled" | "guessed" | "artist";
  bonus?: number;
}
export interface RevealFrame {
  step: number;
  total: number;
  kind: "opening" | "ballots" | "tally" | "false" | "truth" | "favorites";
  titles: RevealTitle[];
  awards: RevealAward[];
}
export interface DrawView {
  phase: Phase;
  turn: number;
  total: number;
  epoch: number;
  code: string;
  you: string;
  host: string;
  players: DrawPlayer[];
  deadline: number;
  now: number;
  ready: number;
  expected: number;
  done: boolean;
  prompt?: string;
  upload?: string;
  picture?: string;
  artist?: string;
  choices?: Choice[];
  liked?: string[];
  heartCounts?: Record<string, number>;
  reveal?: RevealFrame;
  revealed?: RevealFrame[];
  votedFor?: string;
  startedAt: number;
}
