import { READINESS_MS } from "./turn-timing";

export type Question = {
  prompt: string;
  answers: readonly {
    label: string;
    points: number;
    aliases: readonly string[];
  }[];
};

type Team = { name: string; players: readonly string[]; score: number };
type Proposal = { id: number; text: string };
export type TurnResult = Readonly<{
  team: number;
  text: string;
  points: number;
  kind: "hit" | "miss" | "repeat" | "pass";
  answerIndex?: number;
}>;

const TEAMS = ["Яблоки", "Апельсины", "Сливы"];
export const MAX_ROUNDS = 2;
const MAX_ANSWER_LENGTH = 80;

export class TurnReadiness {
  private readonly readyPlayers = new Set<number>();

  constructor(
    private readonly teamSize: number,
    private readonly startedAt: number,
    private readonly durationMs = READINESS_MS,
  ) {
    if (!Number.isInteger(teamSize) || teamSize < 1) {
      throw new RangeError("В команде должен быть хотя бы один игрок.");
    }
    if (!Number.isFinite(startedAt) || !Number.isFinite(durationMs) || durationMs <= 0) {
      throw new RangeError("Неверное время ожидания команды.");
    }
  }

  get count(): number {
    return this.readyPlayers.size;
  }

  isReady(player: number): boolean {
    return this.readyPlayers.has(player);
  }

  remaining(now: number): number {
    if (!Number.isFinite(now)) throw new RangeError("Неверное время.");
    return Math.max(0, this.durationMs - Math.max(0, now - this.startedAt));
  }

  shouldStart(now: number): boolean {
    return this.remaining(now) === 0 || this.count === this.teamSize;
  }

  confirm(player: number, now: number): boolean {
    if (!Number.isInteger(player) || player < 0 || player >= this.teamSize) {
      throw new RangeError("Игрок не входит в команду.");
    }
    if (this.shouldStart(now)) return true;
    this.readyPlayers.add(player);
    return this.count === this.teamSize;
  }
}

function normalizeAnswer(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[\p{P}\p{Z}\s]+/gu, " ")
    .trim();
}

export class SurveyGame {
  readonly teams: readonly Team[];
  readonly opened = new Map<number, number>();
  readonly votes = new Map<number, number>();
  questionIndex = 0;
  turnIndex = 0;
  phase: "turn" | "reveal" | "results" = "turn";
  private readonly completedTurns: TurnResult[] = [];
  private readonly currentProposals: Proposal[] = [];
  private readonly submitted = new Set<number>();
  private manualCandidate: { key: string; proposal: Proposal | undefined } | undefined;
  private chosenQuestionId: number | undefined;

  constructor(
    private readonly questions: readonly Question[],
    playerCount: number,
    private readonly random: () => number = Math.random,
    readonly questionLimit = questions.length,
  ) {
    if (!Number.isInteger(playerCount) || playerCount < 10 || playerCount > 12) {
      throw new Error("Для игры нужно от 10 до 12 участников.");
    }
    if (!questions.length || questions.some(({ answers }) => answers.length !== 6)) {
      throw new Error("У каждого вопроса должно быть шесть ответов.");
    }
    if (!Number.isInteger(questionLimit) || questionLimit < 1 || questionLimit > questions.length) {
      throw new Error("Неверное число вопросов в партии.");
    }

    let nextPlayer = 1;
    this.teams = TEAMS.map((name, team) => {
      const size = Math.floor(playerCount / TEAMS.length) + Number(team < playerCount % TEAMS.length);
      const players = Array.from({ length: size }, () => `Игрок ${nextPlayer++}`);
      return { name, players, score: 0 };
    });
  }

  get question(): Question {
    return this.questions[this.questionId];
  }

  get questionId(): number {
    return this.chosenQuestionId ?? this.questionIndex;
  }

  selectQuestion(id: number): void {
    if (this.phase !== "turn" || this.turnIndex !== 0 || this.chosenQuestionId !== undefined ||
        this.submitted.size || this.completedTurns.length ||
        !Number.isInteger(id) || id < 0 || id >= this.questions.length) {
      throw new Error("Этот вопрос сейчас нельзя выбрать.");
    }
    this.chosenQuestionId = id;
  }

  get activeTeam(): number {
    return this.teamForTurn(this.turnIndex);
  }

  teamForTurn(turnIndex: number): number {
    return (this.questionIndex + turnIndex) % this.teams.length;
  }

  get proposals(): readonly Proposal[] {
    return this.currentProposals;
  }

  get turnHistory(): readonly TurnResult[] {
    return this.completedTurns;
  }

  get lastAnswer(): TurnResult | null {
    return this.completedTurns.at(-1) ?? null;
  }

  hasProposed(player: number): boolean {
    return this.submitted.has(player);
  }

  propose(player: number, text: string): void {
    this.requireCurrentPlayer(player);
    if (this.hasProposed(player)) throw new Error("Ваша версия уже предложена.");
    const proposal = text.trim().replace(/\s+/g, " ");
    const key = normalizeAnswer(proposal);
    if (!/[\p{L}\p{N}]/u.test(key) || proposal.length > MAX_ANSWER_LENGTH) {
      throw new Error("Введите ответ длиной до 80 символов.");
    }
    if (!this.currentProposals.some(({ text }) => normalizeAnswer(text) === key)) {
      this.currentProposals.push({ id: this.currentProposals.length, text: proposal });
    }
    this.submitted.add(player);
  }

  vote(player: number, proposalId: number): void {
    this.requireCurrentPlayer(player);
    this.requireCurrentProposal(proposalId);
    this.votes.set(player, proposalId);
  }

  confirmationCandidate(timerVisible: boolean): Proposal | undefined {
    if (this.phase !== "turn") return undefined;
    const allVoted = this.votes.size === this.teams[this.activeTeam].players.length;
    if (!allVoted && !timerVisible) return undefined;

    const options = allVoted ? this.leadingProposals() : this.currentProposals;
    const key = `${allVoted}:${options.map(({ id }) => id).join(",")}`;
    if (this.manualCandidate?.key !== key) {
      this.manualCandidate = { key, proposal: this.pickProposal(options) };
    }
    return this.manualCandidate.proposal;
  }

  finishTurn(confirmedProposalId?: number): void {
    if (this.phase !== "turn") return;
    const proposal = confirmedProposalId === undefined
      ? this.pickProposal(this.leadingProposals())
      : this.requireCurrentProposal(confirmedProposalId);
    this.completedTurns.push(this.scoreTurn(proposal));
    this.resetBallot();
    if (this.opened.size === this.question.answers.length ||
        this.turnIndex + 1 === this.teams.length * MAX_ROUNDS) {
      this.phase = "reveal";
    } else {
      this.turnIndex++;
    }
  }

  nextQuestion(): void {
    if (this.phase !== "reveal") return;
    if (this.questionIndex + 1 === this.questionLimit) {
      this.phase = "results";
      return;
    }
    this.questionIndex++;
    this.chosenQuestionId = undefined;
    this.turnIndex = 0;
    this.completedTurns.length = 0;
    this.opened.clear();
    this.phase = "turn";
  }

  private requireCurrentPlayer(player: number): void {
    if (this.phase !== "turn" || !Number.isInteger(player) ||
        player < 0 || player >= this.teams[this.activeTeam].players.length) {
      throw new Error("Игрок не может отвечать в этом ходе.");
    }
  }

  private requireCurrentProposal(proposalId: number): Proposal {
    const proposal = this.currentProposals.find(({ id }) => id === proposalId);
    if (!proposal) throw new Error("Выберите одну из предложенных версий.");
    return proposal;
  }

  private scoreTurn(proposal: Proposal | undefined): TurnResult {
    const team = this.activeTeam;
    if (!proposal) return { team, text: "", points: 0, kind: "pass" };

    const text = proposal.text;
    const key = normalizeAnswer(text);
    const answerIndex = this.question.answers.findIndex(({ label, aliases }) =>
      [label, ...aliases].some((answer) => normalizeAnswer(answer) === key),
    );
    if (answerIndex === -1) return { team, text, points: 0, kind: "miss" };
    if (this.opened.has(answerIndex)) return { team, text, points: 0, kind: "repeat" };

    const { points } = this.question.answers[answerIndex];
    this.opened.set(answerIndex, team);
    this.teams[team].score += points;
    return { team, text, points, kind: "hit", answerIndex };
  }

  private leadingProposals(): Proposal[] {
    if (this.votes.size === 0) return [];
    const counts = new Map<number, number>();
    for (const id of this.votes.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
    const mostVotes = Math.max(...counts.values());
    return this.currentProposals.filter(({ id }) => counts.get(id) === mostVotes);
  }

  private pickProposal(options: readonly Proposal[]): Proposal | undefined {
    return options.length <= 1 ? options[0] : options[Math.floor(this.random() * options.length)];
  }

  private resetBallot(): void {
    this.currentProposals.length = 0;
    this.votes.clear();
    this.submitted.clear();
    this.manualCandidate = undefined;
  }
}
