import type {
  DrawPlayer,
  RevealAward,
  RevealFrame,
  RevealTitle,
} from "../shared/draw.js";

export interface DrawOption {
  id: string;
  text: string;
  author: string;
  truth: boolean;
}
interface Beat {
  frame: RevealFrame;
  duration: number;
}
export function prepareReveal(
  choices: DrawOption[],
  votes: Map<string, string>,
  hearts: Map<string, Set<string>>,
  players: Map<string, DrawPlayer>,
): Beat[] {
  const titles = choices.map((choice) => ({
    ...choice,
    voters: [...votes]
      .filter(([, pick]) => pick === choice.id)
      .map(([id]) => id),
    likes: [...hearts.values()].filter((liked) => liked.has(choice.id)).length,
  }));
  const truth = titles.find((o) => o.truth)!;
  const blanks = titles.filter((o) => !o.truth && !o.voters.length);
  const decoys = titles
    .filter((o) => !o.truth && o.voters.length)
    .sort((a, b) => a.voters.length - b.voters.length);
  const total = decoys.length + 1 + (blanks.length ? 1 : 0);
  const beats: Beat[] = [];
  let step = 0;
  function add(
    kind: RevealFrame["kind"],
    titles: RevealTitle[],
    awards: RevealAward[],
    duration: number,
  ) {
    beats.push({ frame: { step, total, kind, titles, awards }, duration });
  }
  const publicTitle = (o: typeof truth): RevealTitle => ({
    text: o.text,
    voters: o.voters,
    likes: o.likes,
    author: o.author,
  });
  if (blanks.length) {
    add("empty", blanks.map(publicTitle), [], 2500);
    step++;
  }
  for (const o of decoys) {
    add(
      "suspense",
      [{ text: o.text, voters: o.voters, likes: o.likes }],
      [],
      3000,
    );
    add(
      "false",
      [publicTitle(o)],
      [{ player: o.author, amount: 500 * o.voters.length, reason: "fooled" }],
      2200,
    );
    step++;
  }
  const awards: RevealAward[] = truth.voters.map((player) => {
    const bonus = 100 * players.get(player)!.streak;
    return { player, amount: 1000 + bonus, reason: "guessed", bonus };
  });
  if (truth.voters.length)
    awards.push({
      player: truth.author,
      amount: 1000 * truth.voters.length,
      reason: "artist",
    });
  add("truth", [publicTitle(truth)], awards, 4500);
  return beats;
}
