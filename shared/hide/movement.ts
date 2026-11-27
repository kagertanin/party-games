import type { Input } from "./world.js";

export const STEP_SECONDS = 1 / 60;
export const MAX_BATCH_STEPS = 12;
export interface MoveBatch {
  first: number;
  inputs: Input[];
}
