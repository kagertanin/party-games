import type {
  DrawPlayer,
  RevealAward,
  RevealFrame,
  RevealTitle,
} from "./draw.js";

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
  // The real phrase wins ties, but even a popular bluff can close the round.
  titles.sort(
    (a, b) =>
      a.voters.length - b.voters.length || Number(a.truth) - Number(b.truth),
  );
  const total = titles.length;
  const beats: Beat[] = [
    {
      frame: { step: -1, total, kind: "opening", titles: [], awards: [] },
      duration: 1100,
    },
  ];
  for (const [step, o] of titles.entries()) {
    const title: RevealTitle = {
      text: o.text,
      voters: o.voters,
      likes: o.likes,
      author: o.author,
    };
    let awards: RevealAward[] = [];
    const kind = o.truth ? "truth" : o.voters.length ? "false" : "empty";
    if (o.voters.length && step < total - 1) {
      beats.push({
        frame: {
          step,
          total,
          kind: "suspense",
          titles: [{ text: o.text, voters: o.voters, likes: o.likes }],
          awards: [],
        },
        duration: 2300,
      });
    }
    if (o.truth) {
      awards = o.voters.map((player) => {
        const bonus = 100 * players.get(player)!.streak;
        return { player, amount: 1000 + bonus, reason: "guessed", bonus };
      });
      if (o.voters.length)
        awards.push({
          player: o.author,
          amount: 1000 * o.voters.length,
          reason: "artist",
        });
    } else if (o.voters.length) {
      awards.push({
        player: o.author,
        amount: 500 * o.voters.length,
        reason: "fooled",
      });
    }
    beats.push({
      frame: { step, total, kind, titles: [title], awards },
      duration: step === total - 1 ? 4600 : kind === "empty" ? 1200 : 2450,
    });
  }
  return beats;
}

// Send only settled answers. A reconnect can rebuild the board without revealing future answers.
export function revealedBefore(beats: Beat[], index: number) {
  return beats
    .slice(0, index)
    .map((beat) => beat.frame)
    .filter((frame) => frame.kind !== "opening" && frame.kind !== "suspense");
}

export const normalizeCaption = (s: string) =>
  s
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]/gu, "");

export function applyRevealFrame(
  frame: RevealFrame,
  members: Map<string, DrawPlayer>,
  artist: string,
) {
  for (const award of frame.awards) {
    const p = members.get(award.player)!;
    p.points += award.amount;
    if (award.reason === "fooled") p.fooled += frame.titles[0].voters.length;
    if (award.reason === "guessed") p.guesses++;
  }
  if (frame.kind !== "suspense" && frame.kind !== "truth") {
    for (const o of frame.titles) members.get(o.author!)!.likes += o.likes;
  }
  if (frame.kind === "truth") {
    const guessed = new Set(frame.titles[0].voters);
    for (const [id, p] of members) {
      if (id !== artist) p.streak = guessed.has(id) ? p.streak + 1 : 0;
    }
  }
}
