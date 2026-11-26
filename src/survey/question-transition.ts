const OPTION_EXIT_MS = 210;
const TITLE_MOVE_MS = 410;
const TILE_INTRO_MS = 240;
const TILE_START_DELAY_MS = 280;
const TILE_STAGGER_MS = 45;

async function play(
  animations: Animation[],
  element: HTMLElement,
  keyframes: Keyframe[],
  duration: number,
  delay = 0,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const animation = element.animate(keyframes, {
      duration,
      delay,
      easing: "cubic-bezier(.22,.63,.35,1)",
      fill: "both",
    });
    animations.push(animation);
    await Promise.race([
      animation.finished,
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, duration + delay + 150); }),
    ]);
  } catch {
    // The game can continue after a cancelled or unavailable animation.
  } finally {
    clearTimeout(timeout);
  }
}

function titleFrames(source: DOMRect | undefined, title: HTMLElement): Keyframe[] {
  const target = title.getBoundingClientRect();
  if (!source?.width || !source.height || !target.width || !target.height) {
    return [{ opacity: 0, transform: "translateY(7px)" }, { opacity: 1, transform: "translateY(0)" }];
  }

  const x = source.left + source.width / 2 - target.left - target.width / 2;
  const y = source.top + source.height / 2 - target.top - target.height / 2;
  const scale = Math.max(.35, Math.min(1, source.width / target.width, source.height / target.height));
  return [
    { transform: `translate(${x}px, ${y}px) scale(${scale})`, opacity: .92, zIndex: 1 },
    { transform: "translate(0, 0) scale(1)", opacity: 1, zIndex: 1 },
  ];
}

export async function animateQuestionChoice(
  app: HTMLElement,
  winnerId: number,
  reveal: () => void,
): Promise<void> {
  const ballot = app.querySelector<HTMLElement>(".survey-question-ballot");
  const view = app.ownerDocument.defaultView;
  if (!ballot || !view || view.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    reveal();
    return;
  }

  const choices = Array.from(ballot.querySelectorAll<HTMLButtonElement>(".survey-question-option[data-question-id]"));
  const winner = choices.find((choice) => choice.dataset.questionId === String(winnerId));
  if (!winner) {
    reveal();
    return;
  }

  const outgoing: Animation[] = [];
  const wasInert = ballot.inert;
  ballot.inert = true;
  let source: DOMRect | undefined;
  try {
    const losers = choices.filter((choice) => choice !== winner);
    await Promise.all(losers.map((choice, index) => play(outgoing, choice, [
      { opacity: 1, transform: "translateY(0)" },
      { opacity: 0, transform: `translateY(${10 + index * 4}px)` },
    ], OPTION_EXIT_MS)));
    const winnerText = winner.querySelector<HTMLElement>(".survey-question-option-text") ?? winner;
    source = winnerText.getBoundingClientRect();
  } finally {
    ballot.inert = wasInert;
    try {
      reveal();
    } finally {
      for (const animation of outgoing) animation.cancel();
    }
  }

  const title = app.querySelector<HTMLElement>(".survey-question h1");
  const tiles = Array.from(app.querySelectorAll<HTMLElement>(".survey-board li"));
  const entering: Animation[] = [];
  try {
    const animations = tiles.map((tile, index) => play(entering, tile, [
      { opacity: 0, transform: "translateY(14px) scale(.97)" },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ], TILE_INTRO_MS, TILE_START_DELAY_MS + index * TILE_STAGGER_MS));
    if (title) animations.push(play(entering, title, titleFrames(source, title), TITLE_MOVE_MS));
    await Promise.all(animations);
  } finally {
    for (const animation of entering) animation.cancel();
  }
}
