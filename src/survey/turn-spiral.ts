import { renderFruit } from "./fruit-icons";

const SAMPLES_PER_TURN = 20;
const WIDTH = 300;
const HEIGHT = 152;
const SPIRAL_CENTER_X = 150;
const ANSWER_WIDTH = 91;

// Reserve a separate label position for each checkpoint so the callouts don't
// collide when multiple turns on the same ray have been played.
const answerSlots = [
  { side: "right", y: 9 },
  { side: "right", y: 137 },
  { side: "left", y: 137 },
  { side: "left", y: 30 },
  { side: "right", y: 110 },
  { side: "left", y: 110 },
  { side: "right", y: 51 },
  { side: "right", y: 83 },
  { side: "left", y: 83 },
] as const;

const outcomes = {
  hit: { mark: "✓", label: "На табло" },
  miss: { mark: "×", label: "Ответа нет на табло" },
  repeat: { mark: "×", label: "Ответ уже открыт" },
  pass: { mark: "–", label: "Ход пропущен" },
};

type TurnAnswer = { text: string; kind: keyof typeof outcomes };

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);

export function renderTurnSpiral(
  teamOrder: readonly number[],
  rounds: number,
  playedTurns: number,
  active: boolean,
  history: readonly TurnAnswer[] = [],
): string {
  const teams = Array.from({ length: rounds }, () => teamOrder).flat();
  const lastTurn = teams.length - 1;
  if (lastTurn < 0) return "";

  function point(turn: number) {
    const angle = 2 * Math.PI * turn / teamOrder.length - Math.PI / 2;
    const radius = 68 - 55 * turn / Math.max(lastTurn, 1);
    return [
      (SPIRAL_CENTER_X + radius * Math.cos(angle)).toFixed(2),
      (79 + radius * Math.sin(angle)).toFixed(2),
    ];
  }

  function pathThrough(turn: number) {
    const count = turn * SAMPLES_PER_TURN + 1;
    return `M${Array.from({ length: count }, (_, sample) =>
      point(sample / SAMPLES_PER_TURN).join(" "),
    ).join(" L")}`;
  }

  const reachedTurn = Math.min(lastTurn, active ? playedTurns : playedTurns - 1);
  const nodes = teams.map((team, turn) => {
    const [x, y] = point(turn);
    const current = active && turn === playedTurns;
    const state = turn < playedTurns ? " is-played" : current ? " is-current" : "";
    return `<g class="survey-spiral-node survey-team-${team}${state}" transform="translate(${x} ${y})">
      ${current ? '<circle class="survey-spiral-ring" r="9"/>' : ""}
      <g transform="translate(-8 -8)">${renderFruit(team, "survey-spiral-fruit")}</g>
    </g>`;
  }).join("");

  const answers = history.slice(0, Math.min(teams.length, answerSlots.length)).map((answer, turn) => {
    const slot = answerSlots[turn];
    const [x, y] = point(turn);
    const right = slot.side === "right";
    const rail = right ? WIDTH - ANSWER_WIDTH : ANSWER_WIDTH;
    const bend = (Number(x) + rail) / 2;
    const text = escape(answer.text || "Пропуск");
    const outcome = outcomes[answer.kind];
    const caption = answer.text ? `${text}. ${outcome.label}` : outcome.label;
    return {
      connector: `<path class="survey-spiral-connector" d="M${x} ${y} L${bend} ${slot.y} H${rail}" fill="none"/>`,
      label: `<span class="survey-spiral-label is-${answer.kind}${right ? " is-right" : ""}"
        style="--label-y:${slot.y / HEIGHT * 100}%;--label-width:${ANSWER_WIDTH / WIDTH * 100}%"
        role="img" aria-label="${caption}" title="${caption}" data-answer="${caption}" tabindex="0">
        <span class="survey-spiral-result" aria-hidden="true">${outcome.mark}</span>
        <span class="survey-spiral-answer" aria-hidden="true">${text}</span>
      </span>`,
    };
  });

  const viewBox = answers.length ? `0 0 ${WIDTH} ${HEIGHT}` : `75 0 150 ${HEIGHT}`;
  return `<div class="survey-spiral-layout${answers.length ? " has-history" : ""}">
    <svg class="survey-spiral" viewBox="${viewBox}" aria-hidden="true" focusable="false">
      <path class="survey-spiral-track" d="${pathThrough(lastTurn)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      ${reachedTurn > 0 ? `<path class="survey-spiral-progress" d="${pathThrough(reachedTurn)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
      ${answers.map(({ connector }) => connector).join("")}
      ${nodes}
    </svg>
    ${answers.map(({ label }) => label).join("")}
  </div>`;
}
