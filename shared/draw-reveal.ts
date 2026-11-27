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
  players: Map<string, DrawPlayer>,
): Beat[] {
  const sorted = choices
    .map((choice) => ({
      choice,
      voters: [...votes]
        .filter(([, pick]) => pick === choice.id)
        .map(([id]) => id),
    }))
    .sort(
      (a, b) =>
        a.voters.length - b.voters.length ||
        Number(a.choice.truth) - Number(b.choice.truth),
    );
  const total = sorted.length;
  const beats: Beat[] = [];
  function pause(kind: "opening" | "tally" | "favorites", duration: number) {
    beats.push({
      frame: { step: -1, total, kind, titles: [], awards: [] },
      duration,
    });
  }
  pause("opening", 1100);
  for (const [step, { choice, voters }] of sorted.entries()) {
    // Reveal one check per second. Reconnects receive exactly the same visible votes.
    const duration = voters.length
      ? Math.max(4600, (voters.length + 1) * 1000)
      : 2400;
    for (let visible = 0; visible <= voters.length; visible++) {
      const title = {
        id: choice.id,
        text: choice.text,
        voters: voters.slice(0, visible),
      };
      beats.push({
        frame: { step, total, kind: "ballots", titles: [title], awards: [] },
        duration: visible < voters.length ? 1000 : duration - visible * 1000,
      });
    }
  }
  pause("tally", 1600);
  for (const [step, { choice, voters }] of sorted.entries()) {
    const awards: RevealAward[] = [];
    for (const voter of voters) {
      if (choice.truth) {
        const bonus = 100 * players.get(voter)!.streak;
        awards.push(
          {
            voter,
            player: voter,
            amount: 1000 + bonus,
            reason: "guessed",
            bonus,
          },
          { voter, player: choice.author, amount: 1000, reason: "artist" },
        );
      } else {
        awards.push({
          voter,
          player: choice.author,
          amount: 500,
          reason: "fooled",
        });
      }
    }
    const title: RevealTitle = {
      id: choice.id,
      text: choice.text,
      voters,
      author: choice.author,
    };
    beats.push({
      frame: {
        step,
        total,
        kind: choice.truth ? "truth" : "false",
        titles: [title],
        awards,
      },
      duration: awards.length ? 4000 : 1800,
    });
  }
  pause("favorites", 20000);
  return beats;
}

// Only send the last public state of each answer, including after a reconnect.
export function revealedBefore(beats: Beat[], index: number) {
  const board = new Map<number, RevealFrame>();
  for (const { frame } of beats.slice(0, index))
    if (frame.step >= 0) board.set(frame.step, frame);
  return [...board.values()];
}

export function setHeart(
  choices: DrawOption[],
  hearts: Map<string, Set<string>>,
  members: Map<string, DrawPlayer>,
  voter: string,
  optionId: unknown,
  liked: unknown,
) {
  const option = choices.find((o) => o.id === optionId);
  if (!option || option.author === voter || typeof liked !== "boolean") return;
  const set = hearts.get(voter) ?? new Set<string>();
  if (set.has(option.id) === liked) return;
  if (liked) set.add(option.id);
  else set.delete(option.id);
  hearts.set(voter, set);
  members.get(option.author)!.likes += liked ? 1 : -1;
}
export function heartCounts(hearts: Map<string, Set<string>>) {
  const counts: Record<string, number> = {};
  for (const picks of hearts.values())
    for (const pick of picks) counts[pick] = (counts[pick] ?? 0) + 1;
  return counts;
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
    if (award.reason === "fooled") p.fooled++;
    if (award.reason === "guessed") p.guesses++;
  }
  if (frame.kind === "truth") {
    const guessed = new Set(frame.titles[0].voters);
    for (const [id, p] of members) {
      if (id !== artist) p.streak = guessed.has(id) ? p.streak + 1 : 0;
    }
  }
}
