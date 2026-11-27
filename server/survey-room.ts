import { randomBytes, randomInt } from "node:crypto";
import { ErrorCode, Room, ServerError, type Client } from "@colyseus/core";
import {
  SURVEY_DEFAULT_TEAM_CAPACITY,
  SURVEY_KICKED_CODE,
  SURVEY_MAX_TEAM_SIZE,
  SURVEY_MIN_TEAM_SIZE,
  SURVEY_TEAM_COUNTS,
  SURVEY_TEAM_SIZES,
  canStartSurvey,
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
const KICKED_MESSAGE = "Ведущий исключил вас из комнаты.";

type Stage =
  | { phase: "ballot"; deadline: number; ballot: QuestionBallot }
  | { phase: "ready"; deadline: number; readiness: TurnReadiness }
  | { phase: "turn"; deadline: number; clockVisible: boolean }
  | { phase: "reveal" | "results"; deadline: 0 };

type LobbyTeam = { fruitIndex: number; seats: (SurveyMember | null)[] };
type Match = { game: SurveyGame; stage: Stage; usedQuestions: Set<number>; roster: SurveyMember[][] };

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

function createLobbyTeam(fruitIndex: number, capacity: number): LobbyTeam {
  return { fruitIndex, seats: Array<null>(capacity).fill(null) };
}

function shuffled<T>(values: Iterable<T>): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export class SurveyRoom extends Room {
  private teams: LobbyTeam[] = [];
  private readonly members = new Map<string, SurveyMember>();
  private readonly reconnections = new Map<string, ReturnType<Room["allowReconnection"]>>();
  private owner = "";
  private phaseId = 0;
  private match: Match | undefined;
  private retired = new Set<string>();

  onCreate(options: { name?: unknown; teamCount?: unknown; teamSize?: unknown }) {
    playerName(options.name);
    const { teamCount = SURVEY_TEAM_COUNTS[0], teamSize = SURVEY_DEFAULT_TEAM_CAPACITY } = options;
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
    this.teams = Array.from({ length: teamCount }, (_, fruitIndex) => createLobbyTeam(fruitIndex, teamSize));
    this.updateCapacity();
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
    if (this.match || this.members.size >= this.maxClients) {
      throw new ServerError(ErrorCode.AUTH_FAILED, "Нет свободных мест в лобби.");
    }
    this.members.set(client.sessionId, { id: client.sessionId, name, connected: true });
    this.updateOwner();
    this.sendAll(Date.now());
  }

  async onLeave(client: Client, consented: boolean) {
    const member = this.members.get(client.sessionId);
    if (!member) return;
    member.connected = false;
    this.updateOwner();
    if (!consented) {
      this.sendAll(Date.now());
      const reservation = this.allowReconnection(client, "manual");
      this.reconnections.set(member.id, reservation);
      const expiry = setTimeout(() => reservation.reject(new Error("Время переподключения истекло.")),
        RECONNECT_SECONDS * 1000);
      try {
        await reservation;
        if (this.members.has(member.id)) {
          member.connected = true;
          this.updateOwner();
          this.sendAll(Date.now());
        }
        return;
      } catch {
        // An expired reservation no longer occupies a seat in the lobby.
        if (!this.members.has(member.id)) return;
      } finally {
        clearTimeout(expiry);
        if (this.reconnections.get(member.id) === reservation) this.reconnections.delete(member.id);
      }
    }
    if (this.match?.roster.some((team) => team.includes(member))) {
      this.retired.add(member.id);
    } else {
      this.removeMember(member);
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
    const member = this.members.get(actor);
    if (!member?.connected) throw new Error("Вы больше не в комнате.");
    const action = payload as SurveyOnlineAction;
    const match = this.match;
    if (!("phaseId" in action)) {
      if (match) {
        throw new Error(action.type === "start"
          ? "Партия уже началась."
          : "Менять команды можно только в комнате ожидания.");
      }
      this.applyLobbyAction(member, action, now);
      return;
    }
    if (!match || action.phaseId !== this.phaseId) throw new Error("Этот этап уже завершился.");
    const { game, stage } = match;
    if (action.type === "question" && stage.phase === "ballot") {
      stage.ballot.choose(match.roster.flat().findIndex(({ id }) => id === actor), action.id, now);
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
        : this.questionStage(match.usedQuestions, match.roster.flat().length, now));
    } else if (action.type === "replay" && stage.phase === "results") {
      this.requireOwner(actor);
      this.match = undefined;
      for (const id of this.retired) {
        const player = this.members.get(id);
        if (player) this.removeMember(player);
      }
      this.retired.clear();
      this.updateOwner();
    } else {
      throw new Error("Это действие сейчас недоступно.");
    }
  }

  private applyLobbyAction(
    member: SurveyMember,
    action: Exclude<SurveyOnlineAction, { phaseId: number }>,
    now: number,
  ) {
    if (action.type === "take-seat") {
      this.takeSeat(member, action.team, action.seat);
      return;
    }
    this.requireOwner(member.id);
    switch (action.type) {
      case "add-team": case "remove-team": case "resize-team":
        this.changeTeams(action);
        return;
      case "move-player":
        this.takeSeat(this.requireMember(action.memberId), action.team, action.seat);
        return;
      case "kick-player":
        this.kickPlayer(this.requireMember(action.memberId));
        return;
      case "shuffle-teams":
        this.shuffleTeams();
        return;
      case "start":
        this.startMatch(now);
        return;
      default:
        throw new Error("Это действие сейчас недоступно.");
    }
  }

  private lobbyRoster() {
    return this.teams.map(({ seats }) => seats.filter((member): member is SurveyMember => member !== null));
  }

  private unassignedMembers(roster: SurveyMember[][]) {
    const assigned = new Set(roster.flat());
    return [...this.members.values()].filter((member) => !assigned.has(member));
  }

  private startMatch(now: number) {
    const lobbyRoster = this.lobbyRoster();
    if (!canStartSurvey(lobbyRoster.map((players) => ({ players })), this.unassignedMembers(lobbyRoster))) {
      throw new Error("Все подключённые игроки должны выбрать команду. В каждой команде нужно хотя бы два подключённых игрока.");
    }
    // Reserved seats stay in the lobby. Returning players outside this roster can watch the match.
    const roster = lobbyRoster.map((team) => team.filter(({ connected }) => connected));
    const playerCount = roster.flat().length;
    const game = new SurveyGame(questions, playerCount, Math.random, QUESTIONS_PER_MATCH,
      this.teams.length, roster.map((team) => team.map(({ name }) => name)));
    const usedQuestions = new Set<number>();
    this.match = { game, roster, usedQuestions, stage: this.questionStage(usedQuestions, playerCount, now) };
    this.phaseId++;
  }

  private requireTeam(index: number) {
    const team = this.teams.find(({ fruitIndex }) => fruitIndex === index);
    if (!team) throw new Error("Такой команды нет в комнате.");
    return team;
  }

  private requireMember(id: string) {
    const member = this.members.get(id);
    if (!member) throw new Error("Этот игрок больше не в комнате.");
    return member;
  }

  private takeSeat(member: SurveyMember, teamIndex: number, seat: number) {
    const { seats } = this.requireTeam(teamIndex);
    if (!Number.isInteger(seat) || seat < 0 || seat >= seats.length) throw new Error("Такого места нет.");
    if (seats[seat] === member) return;
    if (seats[seat] !== null) throw new Error("Это место уже занято.");
    this.releaseSeat(member);
    seats[seat] = member;
  }

  private releaseSeat(member: SurveyMember) {
    for (const team of this.teams) {
      const seat = team.seats.indexOf(member);
      if (seat === -1) continue;
      team.seats[seat] = null;
      return;
    }
  }

  private removeMember(member: SurveyMember) {
    this.releaseSeat(member);
    this.members.delete(member.id);
  }

  private kickPlayer(member: SurveyMember) {
    if (member.id === this.owner) throw new Error("Ведущий может выйти из комнаты сам.");
    this.removeMember(member);
    this.reconnections.get(member.id)?.reject(new Error(KICKED_MESSAGE));
    const target = this.clients.getById(member.id);
    target?.send("kicked", KICKED_MESSAGE);
    target?.leave(SURVEY_KICKED_CODE, KICKED_MESSAGE);
  }

  private shuffleTeams() {
    const members = shuffled(this.members.values());
    const teams = shuffled(this.teams);
    for (const { seats } of teams) seats.fill(null);
    let memberIndex = 0;
    for (let seat = 0; seat < SURVEY_MAX_TEAM_SIZE && memberIndex < members.length; seat++) {
      for (const { seats } of teams) {
        if (seat < seats.length && memberIndex < members.length) seats[seat] = members[memberIndex++];
      }
    }
  }

  private changeTeams(action: Extract<SurveyOnlineAction, { type: "add-team" | "remove-team" | "resize-team" }>) {
    if (action.type === "add-team") {
      const fruitIndex = SURVEY_TEAM_NAMES.findIndex((_, index) => !this.teams.some((team) => team.fruitIndex === index));
      if (fruitIndex === -1) throw new Error("Можно создать не больше трёх команд.");
      this.teams.push(createLobbyTeam(fruitIndex, SURVEY_DEFAULT_TEAM_CAPACITY));
      this.teams.sort((first, second) => first.fruitIndex - second.fruitIndex);
    } else {
      const team = this.requireTeam(action.team);
      if (action.type === "remove-team") {
        if (this.teams.length <= SURVEY_TEAM_COUNTS[0]) throw new Error("В комнате должно быть хотя бы две команды.");
        if (this.maxClients - team.seats.length < this.members.size) throw new Error("В остальных командах не хватает мест.");
        this.teams = this.teams.filter((entry) => entry !== team);
      } else {
        if (action.delta !== -1 && action.delta !== 1) throw new Error("Места меняются по одному.");
        const capacity = team.seats.length + action.delta;
        if (capacity < SURVEY_MIN_TEAM_SIZE || capacity > SURVEY_MAX_TEAM_SIZE) {
          throw new Error("В команде может быть от двух до пяти мест.");
        }
        if (action.delta === 1) team.seats.push(null);
        else {
          const emptySeat = team.seats.lastIndexOf(null);
          if (emptySeat === -1 || this.maxClients <= this.members.size) {
            throw new Error("Можно убрать только свободное место.");
          }
          team.seats.splice(emptySeat, 1);
        }
      }
    }
    this.updateCapacity();
  }

  private updateCapacity() {
    this.maxClients = this.teams.reduce((sum, team) => sum + team.seats.length, 0);
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

  private questionStage(used: Set<number>, playerCount: number, now: number): Stage {
    const candidates = questions.map((_, id) => id).filter((id) => !used.has(id)).slice(0, 3);
    return {
      phase: "ballot",
      deadline: now + QUESTION_BALLOT_MS,
      ballot: new QuestionBallot(candidates, playerCount, now),
    };
  }

  private prepareTurn(match: Match, now: number) {
    this.setStage(match, {
      phase: "ready",
      deadline: now + READINESS_MS,
      readiness: new TurnReadiness(match.roster[match.game.activeTeam].length, now),
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
    const players = this.match?.roster.flat() ?? [...this.members.values()];
    const connected = players.filter((member) => member.connected);
    if (!connected.some(({ id }) => id === this.owner)) this.owner = connected[0]?.id ?? "";
  }

  private requireOwner(actor: string) {
    if (actor !== this.owner) throw new Error("Это действие доступно только ведущему комнаты.");
  }

  private requireActivePlayer({ game, roster }: Match, actor: string) {
    const index = roster[game.activeTeam].findIndex(({ id, connected }) => id === actor && connected);
    if (index === -1) throw new Error("Сейчас отвечает другая команда.");
    return index;
  }

  private sendAll(now: number) {
    for (const client of this.clients) this.sendView(client, now);
  }

  private sendView(client: Client, now: number) {
    if (!this.members.has(client.sessionId)) return;
    const roster = this.match?.roster ?? this.lobbyRoster();
    const view: SurveyRoomView = {
      code: this.roomId,
      you: client.sessionId,
      owner: this.owner,
      teamCount: this.teams.length,
      teamSize: Math.max(...this.teams.map(({ seats }) => seats.length)),
      teams: this.teams.map(({ seats, fruitIndex }, index) => ({
        players: roster[index],
        ...(this.match ? {} : { seats }),
        name: SURVEY_TEAM_NAMES[fruitIndex],
        fruitIndex,
        capacity: seats.length,
        score: this.match?.game.teams[index].score ?? 0,
      })),
      unassigned: this.match ? [] : this.unassignedMembers(roster),
      serverNow: now,
      match: this.match ? this.matchView(this.match, client.sessionId) : null,
    };
    client.send("view", view);
  }

  private matchView({ game, stage, roster }: Match, actor: string): SurveyMatchView {
    const stagePlayer = roster[game.activeTeam].findIndex(({ id }) => id === actor);
    const ballotPlayer = roster.flat().findIndex(({ id }) => id === actor);
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
        ? roster[game.activeTeam].flatMap((_, i) => stage.readiness.isReady(i) ? [i] : [])
        : [],
      submitted: stagePlayer >= 0 && game.hasProposed(stagePlayer),
      confirmationId: stage.phase === "turn" && stagePlayer >= 0
        ? game.confirmationCandidate(stage.clockVisible)?.id ?? null
        : null,
      turnHistory: [...game.turnHistory],
    };
  }
}
