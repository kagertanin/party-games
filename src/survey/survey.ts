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
type TurnResult = {
  team: number;
  text: string;
  points: number;
  kind: "hit" | "miss" | "repeat" | "pass";
};

const TEAMS = ["Зелёные", "Апельсины", "Сиреневые"];
export const MAX_ROUNDS = 3;
const MAX_ANSWER_LENGTH = 80;

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
  lastAnswer: TurnResult | null = null;
  private readonly currentProposals: Proposal[] = [];
  private readonly submitted = new Set<number>();

  constructor(
    private readonly questions: readonly Question[],
    playerCount: number,
    private readonly random: () => number = Math.random,
  ) {
    if (!Number.isInteger(playerCount) || playerCount < 10 || playerCount > 12) {
      throw new Error("Для игры нужно от 10 до 12 участников.");
    }
    if (!questions.length || questions.some(({ answers }) => answers.length !== 6)) {
      throw new Error("У каждого вопроса должно быть шесть ответов.");
    }

    let nextPlayer = 1;
    this.teams = TEAMS.map((name, team) => {
      const size = Math.floor(playerCount / TEAMS.length) + Number(team < playerCount % TEAMS.length);
      const players = Array.from({ length: size }, () => `Игрок ${nextPlayer++}`);
      return { name, players, score: 0 };
    });
  }

  get question(): Question {
    return this.questions[this.questionIndex];
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
    if (!this.currentProposals.some(({ id }) => id === proposalId)) {
      throw new Error("Выберите одну из предложенных версий.");
    }
    this.votes.set(player, proposalId);
  }

  finishTurn(): void {
    if (this.phase !== "turn") return;
    const team = this.activeTeam;
    const proposal = this.pickProposal();
    if (!proposal) {
      this.lastAnswer = { team, text: "", points: 0, kind: "pass" };
    } else {
      const key = normalizeAnswer(proposal.text);
      const index = this.question.answers.findIndex(({ label, aliases }) =>
        [label, ...aliases].some((answer) => normalizeAnswer(answer) === key),
      );
      if (index === -1) {
        this.lastAnswer = { team, text: proposal.text, points: 0, kind: "miss" };
      } else if (this.opened.has(index)) {
        this.lastAnswer = { team, text: proposal.text, points: 0, kind: "repeat" };
      } else {
        const { points } = this.question.answers[index];
        this.opened.set(index, team);
        this.teams[team].score += points;
        this.lastAnswer = { team, text: proposal.text, points, kind: "hit" };
      }
    }

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
    if (this.questionIndex + 1 === this.questions.length) {
      this.phase = "results";
      return;
    }
    this.questionIndex++;
    this.turnIndex = 0;
    this.lastAnswer = null;
    this.opened.clear();
    this.phase = "turn";
  }

  private requireCurrentPlayer(player: number): void {
    if (this.phase !== "turn" || !Number.isInteger(player) ||
        player < 0 || player >= this.teams[this.activeTeam].players.length) {
      throw new Error("Игрок не может отвечать в этом ходе.");
    }
  }

  private pickProposal(): Proposal | undefined {
    if (this.votes.size === 0) return undefined;
    const counts = new Map<number, number>();
    for (const id of this.votes.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
    const mostVotes = Math.max(...counts.values());
    const leaders = this.currentProposals.filter(({ id }) => counts.get(id) === mostVotes);
    return leaders.length === 1 ? leaders[0] : leaders[Math.floor(this.random() * leaders.length)];
  }

  private resetBallot(): void {
    this.currentProposals.length = 0;
    this.votes.clear();
    this.submitted.clear();
  }
}
