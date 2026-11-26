import type { TurnResult } from "./survey";

type TurnAnimationElements = {
  root: HTMLElement;
  source: DOMRect | null;
  tile: HTMLElement | null;
  score: HTMLElement | null;
  verdict: HTMLElement | null;
  reveal: () => void;
  award: () => void;
};

type Point = { x: number; y: number };

function visibleCenter(rect: DOMRect | null | undefined, view: Window): Point | null {
  if (!rect) return null;
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(view.innerWidth, rect.right);
  const bottom = Math.min(view.innerHeight, rect.bottom);
  if (right <= left || bottom <= top) return null;
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

async function play(
  element: HTMLElement,
  keyframes: Keyframe[],
  duration: number,
  easing: string,
) {
  const animation = element.animate(keyframes, { duration, easing, fill: "both" });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      animation.finished,
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, duration + 150); }),
    ]);
  } finally {
    clearTimeout(timeout);
    animation.cancel();
  }
}

async function fly(
  root: HTMLElement,
  kind: "answer" | "points",
  text: string,
  team: number,
  from: Point,
  to: Point,
  duration: number,
) {
  const item = root.ownerDocument.createElement("span");
  item.className = `survey-flying-${kind} survey-team-${team}`;
  item.setAttribute("aria-hidden", "true");
  item.textContent = text;
  item.style.left = `${from.x}px`;
  item.style.top = `${from.y}px`;
  root.append(item);
  try {
    await play(item, [
      { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
      {
        transform: `translate(-50%, -50%) translate(${to.x - from.x}px, ${to.y - from.y}px) scale(.68)`,
        opacity: .2,
      },
    ], duration, "cubic-bezier(.22,.68,.26,1)");
  } finally {
    item.remove();
  }
}

export async function animateTurnResult(result: TurnResult, elements: TurnAnimationElements): Promise<void> {
  const { root, source, tile, score, verdict, reveal, award } = elements;
  const view = root.ownerDocument.defaultView;
  const motion = view && !view.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (result.kind !== "hit") {
    if (result.kind === "pass") return;
    if (motion && verdict) {
      await play(verdict, [
        { transform: "translateX(0)" },
        { transform: "translateX(-6px)", offset: .15 },
        { transform: "translateX(6px)", offset: .3 },
        { transform: "translateX(-3px)", offset: .45 },
        { transform: "translateX(0)", offset: .6 },
        { transform: "translateX(0)" },
      ], 430, "ease-in-out").catch(() => undefined);
    } else await new Promise<void>((resolve) => setTimeout(resolve, 430));
    return;
  }

  const destination = view && visibleCenter(tile?.getBoundingClientRect(), view);
  if (view && motion && tile && destination) {
    try {
      const resolved = root.querySelector(".survey-resolved-answer");
      const origin = visibleCenter(source, view)
        ?? visibleCenter(resolved?.getBoundingClientRect(), view)
        ?? { x: destination.x, y: Math.min(view.innerHeight - 24, destination.y + 60) };
      await fly(root, "answer", result.text, result.team, origin, destination, 460);
      tile.classList.add("survey-flipping");
      await play(tile, [
        { transform: "perspective(760px) rotateY(0)" },
        { transform: "perspective(760px) rotateY(90deg)" },
      ], 150, "ease-in");
    } catch {
      // Continue to reveal the answer even if a browser cancels the motion.
    }
  }

  try {
    reveal();
    if (view && motion && tile && destination) {
      await play(tile, [
        { transform: "perspective(760px) rotateY(-90deg)" },
        { transform: "perspective(760px) rotateY(0)" },
      ], 170, "ease-out");
      tile.classList.remove("survey-flipping");
      const points = tile.querySelector(".survey-points");
      const target = visibleCenter(score?.getBoundingClientRect(), view);
      if (target) {
        const origin = visibleCenter(points?.getBoundingClientRect(), view) ?? destination;
        await fly(root, "points", `+${result.points}`, result.team, origin, target, 410);
      }
    }
  } catch {
    // Skipping an animation must still commit the score.
  } finally {
    tile?.classList.remove("survey-flipping");
    award();
  }

  if (motion && score && score.isConnected) {
    score.classList.add("survey-score-pulse");
    try {
      await play(score, [
        { transform: "scale(1)" },
        { transform: "scale(1.22)" },
        { transform: "scale(1)" },
      ], 240, "ease-out");
    } catch {
      // The score has already been awarded.
    } finally {
      score.classList.remove("survey-score-pulse");
    }
  } else if (!motion) await new Promise<void>((resolve) => setTimeout(resolve, 430));
}
