import { playSound } from "../audio/sound";
import type { TurnResult } from "./survey";

type TurnAnimationElements = {
  root: HTMLElement;
  source: DOMRect | null;
  tile: HTMLElement | null;
  score: HTMLElement | null;
  checkpoint: Element | null;
  fruit: number;
  reveal: () => void;
  award: () => void;
  markTurn: () => void;
};

type Point = { x: number; y: number };

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function center(rect: DOMRect | null | undefined, view: Window): Point | null {
  if (!rect || !rect.width || !rect.height) return null;
  return {
    x: Math.max(12, Math.min(view.innerWidth - 12, (rect.left + rect.right) / 2)),
    y: Math.max(12, Math.min(view.innerHeight - 12, (rect.top + rect.bottom) / 2)),
  };
}

async function play(
  element: HTMLElement, keyframes: Keyframe[], duration: number, easing: string, signal?: AbortSignal,
) {
  if (signal?.aborted || !element.isConnected || typeof element.animate !== "function") return;
  const animation = element.animate(keyframes, { duration, easing, fill: "both" });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stop = () => animation.cancel();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    await Promise.race([
      animation.finished,
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, duration + 50); }),
    ]);
  } catch {
    // A cancelled animation must not interrupt the result reveal.
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", stop);
    stop();
  }
}

async function fly(
  root: HTMLElement, kind: "answer" | "points", text: string, team: number,
  from: Point, to: Point, duration: number, signal?: AbortSignal,
) {
  if (!duration || signal?.aborted) return;
  const item = root.ownerDocument.createElement("span");
  item.className = `survey-flying-${kind} survey-team-${team}`;
  item.setAttribute("aria-hidden", "true");
  item.textContent = text;
  item.style.left = `${from.x}px`;
  item.style.top = `${from.y}px`;
  root.append(item);
  const destination = `translate(-50%, -50%) translate(${to.x - from.x}px, ${to.y - from.y}px) scale(.68)`;
  try {
    await play(item, [
      { transform: "translate(-50%, -50%) scale(1)", opacity: .92 },
      { transform: destination, opacity: .98, offset: .91 },
      { transform: destination, opacity: 0 },
    ], duration, "cubic-bezier(.36,.12,.25,1)", signal);
  } finally {
    item.remove();
  }
}

export async function animateTurnResult(
  result: TurnResult, elements: TurnAnimationElements, duration: number, signal?: AbortSignal,
): Promise<void> {
  const { root, source, tile, score, checkpoint, fruit, reveal, award, markTurn } = elements;
  const view = root.ownerDocument.defaultView;
  const end = delay(duration, signal);
  if (!view || view.matchMedia("(prefers-reduced-motion: reduce)").matches || duration < 240) {
    if (!signal?.aborted) playSound(result.kind === "hit" ? "points" : "miss");
    reveal();
    award();
    markTurn();
    return end;
  }

  const panel = root.querySelector<HTMLElement>(".survey-resolution");
  if (panel) void play(panel, [
    { opacity: .35, transform: "translateY(5px)" },
    { opacity: 1, transform: "translateY(0)" },
  ], duration * .16, "ease-out", signal);

  const answer = root.querySelector<HTMLElement>(".survey-resolved-answer");
  const origin = center(source, view) ?? center(answer?.getBoundingClientRect(), view);
  const destination = center((result.kind === "hit" ? tile : checkpoint)?.getBoundingClientRect(), view);
  function flyAnswer(from: Point, to: Point, milliseconds: number) {
    if (answer) answer.style.opacity = "0";
    playSound("flight");
    return fly(root, "answer", result.text, fruit, from, to, milliseconds, signal);
  }
  if (result.kind !== "hit") {
    try {
      if (origin && destination && result.text) {
        await delay(duration * .27, signal);
        if (!signal?.aborted) await flyAnswer(origin, destination, duration * .51);
      }
    } finally {
      if (!signal?.aborted) { playSound("miss"); markTurn(); }
    }
    return end;
  }

  try {
    if (origin && destination) await flyAnswer(origin, destination, duration * .33);
    if (tile) {
      tile.classList.add("survey-flipping");
      await play(tile, [
        { transform: "perspective(760px) rotateY(0)" },
        { transform: "perspective(760px) rotateY(90deg)" },
      ], duration * .09, "ease-in", signal);
    }
    if (signal?.aborted) return;
    reveal();
    if (tile) {
      await play(tile, [
        { transform: "perspective(760px) rotateY(-90deg)" },
        { transform: "perspective(760px) rotateY(0)" },
      ], duration * .1, "ease-out", signal);
      tile.classList.remove("survey-flipping");
    }
    if (signal?.aborted) return;
    markTurn();
    const points = center(tile?.querySelector(".survey-points")?.getBoundingClientRect(), view) ?? destination;
    const target = center(score?.getBoundingClientRect(), view);
    if (points && target) {
      await fly(root, "points", `+${result.points}`, fruit, points, target, duration * .32, signal);
    }
  } finally {
    tile?.classList.remove("survey-flipping");
    if (!signal?.aborted) { playSound("points"); award(); }
  }

  if (score && !signal?.aborted) {
    score.classList.add("survey-score-pulse");
    try {
      await play(score, [
        { transform: "scale(1)" },
        { transform: "scale(1.18)" },
        { transform: "scale(1)" },
      ], duration * .13, "ease-out", signal);
    } finally {
      score.classList.remove("survey-score-pulse");
    }
  }
  await end;
}
