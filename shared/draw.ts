export const DRAW_ROOM = "risovach";
export const DRAW_MIN = 3;
export const DRAW_MAX = 12;
export const DRAW_TIMES = {
  drawing: 120000,
  captions: 40000,
  vote: 40000,
  reveal: 7000,
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
export interface RevealedChoice extends Choice {
  author: string;
  truth: boolean;
  voters: string[];
  likes: number;
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
  reveal?: RevealedChoice[];
  gains?: Record<string, number>;
}
