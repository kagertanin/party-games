import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { SURVEY_PACK_IDS, type SurveyMatchPhase, type SurveyOnlineAction } from "../shared/survey-online.js";

export type SurveyMetricEvent =
  | "room_created"
  | "player_joined"
  | "player_left"
  | "player_reconnected"
  | "room_disposed"
  | "action"
  | "phase_changed"
  | "turn_resolved"
  | "result_view";

const gameplayActions = [
  "start", "add-team", "remove-team", "resize-team", "take-seat", "move-player", "kick-player", "shuffle-teams",
  "select-pack", "question", "ready", "propose", "vote", "confirm", "award-answer", "next", "replay",
] as const satisfies readonly SurveyOnlineAction["type"][];
const resultActions = ["open-team", "close-team", "open-title", "close-title"] as const;
const phases = ["lobby", "ballot", "ready", "turn", "resolution", "reveal", "results"] as const satisfies
  readonly (SurveyMatchPhase | "lobby")[];
const inputTypes = ["mouse", "touch", "pen", "keyboard", "pointer"] as const;
const outcomes = ["hit", "miss", "repeat", "pass", "leave", "disconnect"] as const;
const initiators = ["manual", "timer", "complete"] as const;
const titles = ["ideas", "bullseye", "confirmations"] as const;

export function isSurveyMetricAction(action: unknown): action is typeof gameplayActions[number] {
  return allowed(gameplayActions, action) !== undefined;
}

type SurveyMetricContext = {
  at?: number;
  player?: string;
  action?: unknown;
  accepted?: boolean;
  phase?: SurveyMatchPhase | "lobby";
  phaseId?: number;
  match?: number;
  round?: number;
  turn?: number;
  team?: number;
  targetTeam?: number;
  seat?: number;
  questionId?: number;
  optionId?: number;
  answerIndex?: number;
  points?: number;
  remainingMs?: number;
  connectedPlayers?: number;
  pack?: unknown;
  input?: unknown;
  outcome?: unknown;
  initiator?: unknown;
  title?: unknown;
};

const directory = process.env.SURVEY_METRICS_DIR?.trim() ??
  (process.env.NODE_ENV === "production" ? "/data/survey-metrics" : "");
const mirrorToLogs = !!directory && process.env.NODE_ENV === "production";
const retentionDays = 30;
const daysInMs = 24 * 60 * 60 * 1_000;
const maxDayBytes = 8 * 1024 * 1024;
const maxQueuedEntries = 2_048;
const batchSize = 128;
const fileName = /^survey-(\d{4}-\d{2}-\d{2})\.jsonl$/;

type Entry = { day: string; line: string };
const queue: Entry[] = [];
let writing = false;
let stdoutReady = true;
let nextWriteAttempt = 0;
let currentDay = "";
let dayBytes = 0;
let reportedReady = false;

function allowed<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return values.find((candidate) => candidate === value);
}

function counter(value: unknown, max = 1_000_000): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max
    ? value
    : undefined;
}

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,20}$/.test(code) ? code : "unknown";
}

async function removeExpired(day: string): Promise<void> {
  const cutoff = Date.parse(day) - retentionDays * daysInMs;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const date = fileName.exec(entry.name)?.[1];
    if (date && entry.isFile() && Date.parse(date) <= cutoff) await unlink(join(directory, entry.name));
  }
}

async function prepareDay(day: string, path: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  try {
    dayBytes = (await stat(path)).size;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    dayBytes = 0;
  }
  currentDay = day;
  try {
    await removeExpired(day);
  } catch (error) {
    console.warn("survey-metrics: old files could not be pruned", errorCode(error));
  }
}

async function writePending(): Promise<void> {
  writing = true;
  try {
    while (queue.length > 0) {
      const { day } = queue[0];
      const path = join(directory, `survey-${day}.jsonl`);
      if (day !== currentDay) await prepareDay(day, path);
      const batch = [];
      let bytes = 0;
      for (let i = 0; i < batchSize && queue[0]?.day === day; i++) {
        const { line } = queue.shift()!;
        const lineBytes = Buffer.byteLength(line);
        if (dayBytes + bytes + lineBytes > maxDayBytes) continue;
        batch.push(line);
        bytes += lineBytes;
      }
      if (batch.length === 0) continue;
      await appendFile(path, batch.join(""), "utf8");
      dayBytes += bytes;
      if (!reportedReady && mirrorToLogs) {
        console.info("survey-metrics: journal file ready");
        reportedReady = true;
      }
    }
  } catch (error) {
    // Keep the game responsive during storage failures. The sanitized runtime log remains available.
    queue.length = 0;
    currentDay = "";
    nextWriteAttempt = Date.now() + 30_000;
    console.warn("survey-metrics: journal write failed", errorCode(error));
  } finally {
    writing = false;
  }
}

function emit(day: string, line: string): void {
  if (mirrorToLogs && stdoutReady && !process.stdout.write(`survey-metrics ${line}`)) {
    stdoutReady = false;
    process.stdout.once("drain", () => { stdoutReady = true; });
  }
  if (queue.length >= maxQueuedEntries || Date.now() < nextWriteAttempt) return;
  queue.push({ day, line });
  if (!writing) void writePending();
}

export class SurveyMetrics {
  private readonly room = randomUUID();
  private readonly playerSalt = randomBytes(32);

  record(event: SurveyMetricEvent, context: SurveyMetricContext = {}): void {
    if (!directory) return;
    const action = event === "result_view"
      ? allowed(resultActions, context.action)
      : allowed(gameplayActions, context.action);
    if ((event === "action" || event === "result_view") && !action) return;
    const at = new Date(counter(context.at, 8_640_000_000_000_000) ?? Date.now()).toISOString();
    const player = context.player
      ? createHmac("sha256", this.playerSalt).update(context.player).digest("hex").slice(0, 24)
      : undefined;

    const entry = {
      v: 1,
      game: "survey",
      at,
      room: this.room,
      player,
      event,
      action,
      accepted: typeof context.accepted === "boolean" ? context.accepted : undefined,
      phase: allowed(phases, context.phase),
      phaseId: counter(context.phaseId),
      match: counter(context.match),
      round: counter(context.round),
      turn: counter(context.turn),
      team: counter(context.team, 2),
      targetTeam: counter(context.targetTeam, 2),
      seat: counter(context.seat, 4),
      questionId: counter(context.questionId),
      optionId: counter(context.optionId),
      answerIndex: counter(context.answerIndex, 5),
      points: counter(context.points),
      remainingMs: counter(context.remainingMs),
      connectedPlayers: counter(context.connectedPlayers, 15),
      pack: allowed(SURVEY_PACK_IDS, context.pack),
      input: allowed(inputTypes, context.input),
      outcome: allowed(outcomes, context.outcome),
      initiator: allowed(initiators, context.initiator),
      title: allowed(titles, context.title),
    };
    emit(at.slice(0, 10), `${JSON.stringify(entry)}\n`);
  }
}
