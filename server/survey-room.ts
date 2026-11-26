import { randomBytes } from "node:crypto";
import { ErrorCode, Room, ServerError, type Client } from "@colyseus/core";
import {
  SURVEY_TEAM_COUNTS,
  SURVEY_TEAM_SIZES,
  type SurveyMatchView,
  type SurveyMember,
  type SurveyOnlineAction,
  type SurveyRoomView,
} from "../shared/survey-online.js";
import {
  QuestionBallot,
  QUESTION_BALLOT_MS,
  QUESTIONS_PER_MATCH,
} from "../src/survey/question-ballot.js";
import { questions } from "../src/survey/questions.js";
import { SurveyGame, SURVEY_TEAM_NAMES, TurnReadiness } from "../src/survey/survey.js";
import { getTurnTiming, READINESS_MS } from "../src/survey/turn-timing.js";

const activeCodes = new Set<string>();
const RECONNECT_SECONDS = 90;

type Stage =
  | { phase: "ballot"; deadline: number; ballot: QuestionBallot }
  | { phase: "ready"; deadline: number; readiness: TurnReadiness }
  | { phase: "turn"; deadline: number; clockVisible: boolean }
  | { phase: "reveal" | "results"; deadline: 0 };

type Match = { game: SurveyGame; stage: Stage; usedQuestions: Set<number> };

function playerName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 24 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw new ServerError(ErrorCode.AUTH_FAILED, "Введите имя длиной от 1 до 24 символов.");
  }
  return name;
}

function turnTiming({ game }: Match) {
  return getTurnTiming(game.questionIndex, game.turnIndex, game.teams.length);
}

export class SurveyRoom extends Room {
  private teams: SurveyMember[][] = [];
  private teamSize = 0;
  private owner = "";
  private phaseId = 0;
  private match: Match | undefined;
  private retired = new Set<string>();

  onCreate(options: { name?: unknown; teamCount?: unknown; teamSize?: unknown }) {
    playerName(options.name);
    const { teamCount, teamSize } = options;
    if (typeof teamCount !== "number" || !SURVEY_TEAM_COUNTS.some((count) => count === teamCount) ||
        typeof teamSize !== "number" || !SURVEY_TEAM_SIZES.some((size) => size === teamSize)) {
      throw new ServerError(ErrorCode.MATCHMAKE_INVALID_CRITERIA, "Выберите 2 или 3 команды по 2–5 игроков.");
    }
    let code: string;
    do {
      code = `S${randomBytes(3).toString("hex").toUpperCase()}`;
    } while (activeCodes.has(code));
    this.roomId = code;
    activeCodes.add(code);
    this.teams = Array.from({ length: teamCount }, () => []);
    this.teamSize = teamSize;
    this.maxClients = teamCount * teamSize;
    this.patchRate = 0;
    void this.setPrivate();
    this.onMessage("sync", (client) => this.sendView(client, Date.now()));
    this.onMessage("action", (client, payload: unknown) => this.onAction(client, payload));
    this.setSimulationInterval(() => {
      const now = Date.now();
      if (this.advance(now)) this.sendAll(now);
    }, 100);
  }

  onAuth(_client: Client, options: { name?: unknown }) {
    if (this.match) {
      throw new ServerError(ErrorCode.AUTH_FAILED, "Партия уже началась.");
    }
    return playerName(options.name);
  }

  onJoin(client: Client, _options: unknown, name: string) {
    const shortest = this.teams.reduce((smallest, team) =>
      team.length < smallest.length ? team : smallest);
    if (this.match || shortest.length >= this.teamSize) {
      throw new ServerError(ErrorCode.AUTH_FAILED, "Нет свободных мест в лобби.");
    }
    shortest.push({ id: client.sessionId, name, connected: true });
    this.updateOwner();
    this.sendAll(Date.now());
  }

  async onLeave(client: Client, consented: boolean) {
    const member = this.teams.flat().find(({ id }) => id === client.sessionId);
    if (!member) return;
    member.connected = false;
    this.updateOwner();
    if (!consented) {
      this.sendAll(Date.now());
      try {
        await this.allowReconnection(client, RECONNECT_SECONDS);
        member.connected = true;
        this.updateOwner();
        this.sendAll(Date.now());
        return;
      } catch {
        // An expired reservation no longer occupies a seat in the lobby.
      }
    }
    if (this.match) {
      this.retired.add(member.id);
    } else {
      this.teams = this.teams.map((team) => team.filter(({ id }) => id !== member.id));
      this.updateOwner();
    }
    this.sendAll(Date.now());
  }

  onDispose() {
    activeCodes.delete(this.roomId);
  }

  private onAction(client: Client, payload: unknown) {
    const now = Date.now();
    if (this.advance(now)) this.sendAll(now);
    try {
      this.applyAction(client.sessionId, payload, now);
      this.advance(now);
      this.sendAll(now);
    } catch (error) {
      client.send("rejected", error instanceof Error ? error.message : "Действие не удалось.");
    }
  }

  private applyAction(actor: string, payload: unknown, now: number) {
    if (!payload || typeof payload !== "object" || !("type" in payload)) {
      throw new Error("Некорректная команда.");
    }
    const action = payload as SurveyOnlineAction;
    const match = this.match;
    if (action.type === "start") {
      this.requireOwner(actor);
      if (match) throw new Error("Партия уже началась.");
      if (!this.teams.every((team) => team.length === this.teamSize && team.every(({ connected }) => connected))) {
        throw new Error("Дождитесь, пока все места в командах будут заняты.");
      }
      const roster = this.teams.map((team) => team.map(({ name }) => name));
      const game = new SurveyGame(questions, this.maxClients, Math.random, QUESTIONS_PER_MATCH, this.teams.length, roster);
      const usedQuestions = new Set<number>();
      this.match = { game, usedQuestions, stage: this.questionStage(usedQuestions, now) };
      this.phaseId++;
      return;
    }
    if (!match || action.phaseId !== this.phaseId) throw new Error("Этот этап уже завершился.");
    const { game, stage } = match;
    if (action.type === "question" && stage.phase === "ballot") {
      stage.ballot.choose(this.teams.flat().findIndex(({ id }) => id === actor), action.id, now);
    } else if (action.type === "ready" && stage.phase === "ready") {
      stage.readiness.confirm(this.requireActivePlayer(match, actor), now);
    } else if (action.type === "propose" && stage.phase === "turn") {
      if (typeof action.text !== "string" || stage.deadline - now <= turnTiming(match).voteOnlyMs) {
        throw new Error("Предложить вариант сейчас нельзя.");
      }
      game.propose(this.requireActivePlayer(match, actor), action.text);
    } else if (action.type === "vote" && stage.phase === "turn") {
      game.vote(this.requireActivePlayer(match, actor), action.id);
    } else if (action.type === "confirm" && stage.phase === "turn") {
      this.requireActivePlayer(match, actor);
      const candidate = game.confirmationCandidate(stage.clockVisible);
      if (!candidate || candidate.id !== action.id) throw new Error("Этот ответ пока нельзя подтвердить.");
      this.finishTurn(match, now, candidate.id);
    } else if (action.type === "next" && stage.phase === "reveal") {
      this.requireOwner(actor);
      game.nextQuestion();
      this.setStage(match, game.phase === "results"
        ? { phase: "results", deadline: 0 }
        : this.questionStage(match.usedQuestions, now));
    } else if (action.type === "replay" && stage.phase === "results") {
      this.requireOwner(actor);
      this.match = undefined;
      this.teams = this.teams.map((team) => team.filter(({ id }) => !this.retired.has(id)));
      this.retired.clear();
    } else {
      throw new Error("Это действие сейчас недоступно.");
    }
  }

  private advance(now: number): boolean {
    const match = this.match;
    if (!match) return false;
    const { game, stage } = match;
    if (stage.phase === "ballot") {
      const selected = stage.ballot.finish(now);
      if (selected === undefined) return false;
      game.selectQuestion(selected);
      match.usedQuestions.add(selected);
      this.prepareTurn(match, now);
      return true;
    }
    if (stage.phase === "ready" && stage.readiness.shouldStart(now)) {
      const { durationMs, showClockAtMs } = turnTiming(match);
      this.setStage(match, {
        phase: "turn",
        deadline: now + durationMs,
        clockVisible: showClockAtMs === 0,
      });
      return true;
    }
    if (stage.phase === "turn") {
      if (now >= stage.deadline) {
        this.finishTurn(match, now);
        return true;
      }
      const { durationMs, showClockAtMs } = turnTiming(match);
      if (!stage.clockVisible && now >= stage.deadline - durationMs + showClockAtMs) {
        stage.clockVisible = true;
        return true;
      }
    }
    return false;
  }

  private questionStage(used: Set<number>, now: number): Stage {
    const candidates = questions.map((_, id) => id).filter((id) => !used.has(id)).slice(0, 3);
    return {
      phase: "ballot",
      deadline: now + QUESTION_BALLOT_MS,
      ballot: new QuestionBallot(candidates, this.maxClients, now),
    };
  }

  private prepareTurn(match: Match, now: number) {
    this.setStage(match, {
      phase: "ready",
      deadline: now + READINESS_MS,
      readiness: new TurnReadiness(this.teamSize, now),
    });
  }

  private finishTurn(match: Match, now: number, proposalId?: number) {
    match.game.finishTurn(proposalId);
    if (match.game.phase === "reveal") {
      this.setStage(match, { phase: "reveal", deadline: 0 });
    } else {
      this.prepareTurn(match, now);
    }
  }

  private setStage(match: Match, stage: Stage) {
    match.stage = stage;
    this.phaseId++;
  }

  private updateOwner() {
    const connected = this.teams.flat().filter((member) => member.connected);
    if (!connected.some(({ id }) => id === this.owner)) this.owner = connected[0]?.id ?? "";
  }

  private requireOwner(actor: string) {
    if (actor !== this.owner) throw new Error("Это действие доступно только ведущему комнаты.");
  }

  private requireActivePlayer({ game }: Match, actor: string) {
    const index = this.teams[game.activeTeam].findIndex(({ id, connected }) => id === actor && connected);
    if (index === -1) throw new Error("Сейчас отвечает другая команда.");
    return index;
  }

  private sendAll(now: number) {
    for (const client of this.clients) this.sendView(client, now);
  }

  private sendView(client: Client, now: number) {
    const view: SurveyRoomView = {
      code: this.roomId,
      you: client.sessionId,
      owner: this.owner,
      teamCount: this.teams.length,
      teamSize: this.teamSize,
      teams: this.teams.map((players, index) => ({
        players,
        name: SURVEY_TEAM_NAMES[index],
        score: this.match?.game.teams[index].score ?? 0,
      })),
      serverNow: now,
      match: this.match ? this.matchView(this.match, client.sessionId) : null,
    };
    client.send("view", view);
  }

  private matchView({ game, stage }: Match, actor: string): SurveyMatchView {
    const stagePlayer = this.teams[game.activeTeam].findIndex(({ id }) => id === actor);
    const ballotPlayer = this.teams.flat().findIndex(({ id }) => id === actor);
    const showAllAnswers = stage.phase === "reveal" || stage.phase === "results";
    return {
      phase: stage.phase,
      phaseId: this.phaseId,
      deadline: stage.deadline,
      questionIndex: game.questionIndex,
      questionLimit: game.questionLimit,
      turnIndex: game.turnIndex,
      activeTeam: game.activeTeam,
      question: stage.phase === "ballot" ? null : {
        prompt: game.question.prompt,
        answers: game.question.answers.map(({ label, points }, index) =>
          showAllAnswers || game.opened.has(index) ? { label, points } : null),
      },
      ballot: stage.phase !== "ballot" ? null : {
        choices: stage.ballot.candidateIds.map((id) => ({
          id,
          prompt: questions[id].prompt,
          votes: stage.ballot.count(id),
        })),
        selected: stage.ballot.votes.get(ballotPlayer) ?? null,
      },
      proposals: [...game.proposals],
      votes: [...game.votes],
      opened: [...game.opened],
      ready: stage.phase === "ready"
        ? this.teams[game.activeTeam].flatMap((_, i) => stage.readiness.isReady(i) ? [i] : [])
        : [],
      submitted: stagePlayer >= 0 && game.hasProposed(stagePlayer),
      confirmationId: stage.phase === "turn" && stagePlayer >= 0
        ? game.confirmationCandidate(stage.clockVisible)?.id ?? null
        : null,
      turnHistory: [...game.turnHistory],
    };
  }
}
