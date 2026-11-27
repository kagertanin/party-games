import type { TurnResult } from "./survey";

type QuestionContext = Readonly<{ questionIndex: number; prompt: string }>;

export type SurveyStatsAnswer = QuestionContext & Readonly<{
  text: string;
  points: number;
  kind: TurnResult["kind"] | "awarded";
}>;

export type SurveyTeamStats = Readonly<{
  team: number;
  answers: readonly SurveyStatsAnswer[];
}>;

export type SurveyTitleEvidence = QuestionContext & Readonly<{
  text: string;
  points?: number;
  kind?: TurnResult["kind"];
}>;

export type SurveyTitle = Readonly<{
  id: "ideas" | "bullseye" | "confirmations";
  team: number;
  player: number;
  name: string;
  value: number;
  evidence: readonly SurveyTitleEvidence[];
}>;

export type SurveyMatchStats = Readonly<{
  teams: readonly SurveyTeamStats[];
  titles: readonly SurveyTitle[];
}>;

type PlayerStats = Pick<SurveyTitle, "team" | "player" | "name"> &
  Record<SurveyTitle["id"], SurveyTitleEvidence[]>;

export class SurveyStats {
  private readonly players: readonly PlayerStats[][];
  private readonly answers: readonly SurveyStatsAnswer[][];

  constructor(teams: readonly { players: readonly string[] }[]) {
    this.players = teams.map(({ players }, team) => players.map((name, player) => ({
      team, player, name, ideas: [], bullseye: [], confirmations: [],
    })));
    this.answers = teams.map(() => []);
  }

  proposal(team: number, player: number, question: QuestionContext, text: string): void {
    this.players[team][player].ideas.push({ ...question, text });
  }

  turn(question: QuestionContext, { team, text, points, kind }: TurnResult,
    author: number | undefined, confirmedBy: number | undefined): void {
    const evidence = { ...question, text, points, kind };
    this.answers[team].push(evidence);
    if (confirmedBy !== undefined) this.players[team][confirmedBy].confirmations.push(evidence);
    if (kind === "hit" && author !== undefined && points > 0) {
      const player = this.players[team][author];
      const highest = player.bullseye[0]?.points ?? 0;
      if (points > highest) player.bullseye = [evidence];
      else if (points === highest) player.bullseye.push(evidence);
    }
  }

  award(team: number, question: QuestionContext, text: string, points: number): void {
    this.answers[team].push({ ...question, text, points, kind: "awarded" });
  }

  snapshot(): SurveyMatchStats {
    return {
      teams: this.answers.map((answers, team) => ({ team, answers: [...answers] })),
      titles: [
        this.uniqueLeader("ideas"),
        this.uniqueLeader("bullseye"),
        this.uniqueLeader("confirmations"),
      ].filter((title): title is SurveyTitle => title !== undefined),
    };
  }

  private uniqueLeader(id: SurveyTitle["id"]): SurveyTitle | undefined {
    let max = 0;
    let title: SurveyTitle | undefined;
    for (const player of this.players.flat()) {
      const evidence = player[id];
      const value = id === "bullseye" ? evidence[0]?.points ?? 0 : evidence.length;
      if (value > max) {
        const { team, player: index, name } = player;
        max = value;
        title = { id, team, player: index, name, value, evidence: [...evidence] };
      } else if (value === max) {
        title = undefined;
      }
    }
    return title;
  }
}
