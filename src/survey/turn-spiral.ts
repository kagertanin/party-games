const SAMPLES_PER_TURN = 20;

export function renderTurnSpiral(
  teamOrder: readonly number[],
  rounds: number,
  playedTurns: number,
  active: boolean,
): string {
  const teams = Array.from({ length: rounds }, () => teamOrder).flat();
  const lastTurn = teams.length - 1;
  if (lastTurn < 0) return "";

  function point(turn: number) {
    const angle = 2 * Math.PI * turn / teamOrder.length - Math.PI / 2;
    const radius = 88 - 70 * turn / Math.max(lastTurn, 1);
    return [
      (96 + radius * Math.cos(angle)).toFixed(2),
      (98 + radius * Math.sin(angle)).toFixed(2),
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
    return `<g class="survey-spiral-node survey-team-${team}${state}">
      ${current ? `<circle class="survey-spiral-ring" cx="${x}" cy="${y}" r="8"/>` : ""}
      <circle class="survey-spiral-dot" cx="${x}" cy="${y}" r="${current ? 4.25 : 4.75}"/>
    </g>`;
  }).join("");

  return `<svg class="survey-spiral" viewBox="0 0 194 184" aria-hidden="true" focusable="false">
    <path class="survey-spiral-track" d="${pathThrough(lastTurn)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    ${reachedTurn > 0 ? `<path class="survey-spiral-progress" d="${pathThrough(reachedTurn)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
    ${nodes}
  </svg>`;
}
