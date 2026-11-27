import { renderFruit } from "./fruit-icons";
import type { SurveyStatsAnswer, SurveyTitle } from "./match-stats";
import type { SurveyDisplay } from "./online-match";
import "./results.css";

type TitleId = SurveyTitle["id"];

export type SurveyResultsInteraction =
  | { kind: "open-team" | "close-team"; team: number }
  | { kind: "open-title" | "close-title"; title: TitleId };

type ResultsSelection = { team: number | null; title: TitleId | null };

type ResultsOptions = {
  fruitOf: (index: number) => number;
  canAdvance: boolean;
  selection?: ResultsSelection;
};

const titleNames: Record<TitleId, string> = {
  ideas: "Генератор идей",
  bullseye: "В яблочко",
  confirmations: "Самый ответственный",
};

const titleCaptions: Record<TitleId, [string, string, string]> = {
  ideas: ["вариант", "варианта", "вариантов"],
  bullseye: ["очко", "очка", "очков"],
  confirmations: ["подтверждение", "подтверждения", "подтверждений"],
};

const evidenceLabels: Record<TitleId, string> = {
  ideas: "Варианты игрока",
  bullseye: "Самый дорогой ответ",
  confirmations: "Подтверждённые ответы",
};

const answerGroups: readonly {
  heading: string;
  kinds: readonly SurveyStatsAnswer["kind"][];
  symbol: string;
}[] = [
  { heading: "Угадали", kinds: ["hit"], symbol: "✓" },
  { heading: "Не попали", kinds: ["miss"], symbol: "×" },
  { heading: "Засчитано ведущим", kinds: ["awarded"], symbol: "+" },
  { heading: "Повторы и пропуски", kinds: ["repeat", "pass"], symbol: "–" },
];

const pluralRules = new Intl.PluralRules("ru");

function countLabel(count: number, forms: readonly [string, string, string]) {
  const plural = pluralRules.select(count);
  return `${count} ${forms[plural === "one" ? 0 : plural === "few" ? 1 : 2]}`;
}

function escape(text: string) {
  return text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function describeAnswer(answer: SurveyStatsAnswer) {
  if (answer.kind === "pass") return "Пропустили ход";
  if (answer.kind === "repeat") return `«${answer.text}» уже открыли`;
  return answer.text;
}

function renderTeamDetails(name: string, team: number, color: number, answers: readonly SurveyStatsAnswer[], expanded: boolean) {
  const hits = answers.filter(({ kind }) => kind === "hit").length;
  const misses = answers.filter(({ kind }) => kind === "miss").length;
  const groups = answerGroups.map(({ heading, kinds, symbol }) => {
    const entries = answers.filter(({ kind }) => kinds.includes(kind));
    if (!entries.length) return "";
    return `<section class="survey-result-answer-group is-${kinds[0]}">
      <h3>${heading}</h3>
      <ul>
        ${entries.map((answer) => `<li>
          <span class="survey-result-symbol" aria-hidden="true">${symbol}</span>
          <span class="survey-result-answer">
            <span>${escape(describeAnswer(answer))}</span>
            <small>${escape(answer.prompt)}</small>
          </span>
          ${answer.points > 0 ? `<span class="survey-result-points">+${answer.points}</span>` : ""}
        </li>`).join("")}
      </ul>
    </section>`;
  }).join("");
  return `<section id="survey-result-team-${team}" class="survey-result-details survey-team-${color}"
    data-results-team-panel="${team}" aria-labelledby="survey-result-team-heading-${team}" ${expanded ? "" : "hidden"}>
    <div class="survey-result-details-head">
      ${renderFruit(color)}
      <div>
        <h2 id="survey-result-team-heading-${team}">${escape(name)}</h2>
        ${answers.length ? `<p>${countLabel(hits, ["попадание", "попадания", "попаданий"])} · ${countLabel(misses, ["промах", "промаха", "промахов"])}</p>` : ""}
      </div>
    </div>
    ${groups || '<p class="survey-muted">Подробности ходов недоступны.</p>'}
  </section>`;
}

function renderTitle(title: SurveyTitle, expanded: boolean) {
  const { id, name, value, evidence } = title;
  return `<div class="survey-award-card" data-results-title-card="${id}">
    <button type="button" class="survey-award-trigger" data-results-title="${id}"
      aria-expanded="${expanded}" aria-controls="survey-result-award-${id}">
      <span aria-hidden="true" class="survey-award-medal">✦</span>
      <span class="survey-award-label">${titleNames[id]}</span>
      <strong>${escape(name)}</strong>
      <span class="survey-award-count">${countLabel(value, titleCaptions[id])}</span>
    </button>
    <div id="survey-result-award-${id}" class="survey-award-evidence" data-results-title-panel="${id}"
      tabindex="0" role="region" aria-label="${evidenceLabels[id]}" ${expanded ? "" : "hidden"}>
      <ul>
        ${evidence.map((entry) => `<li>
          <div><strong>${escape(entry.text || "Пропуск")}</strong>
            ${entry.points ? `<span class="survey-result-points">+${entry.points}</span>` : ""}</div>
          <small>${escape(entry.prompt)}</small>
        </li>`).join("")}
      </ul>
    </div>
  </div>`;
}

export function renderSurveyResults(match: SurveyDisplay, { fruitOf, canAdvance, selection }: ResultsOptions) {
  const standings = match.teams.map((team, index) => ({ ...team, index })).sort((a, b) => b.score - a.score);
  const leaders = standings.filter(({ score }) => score === standings[0].score);
  const titles = match.resultsStats?.titles ?? [];
  return `<main class="survey-wrap survey-results survey-results-finale">
    <h1 tabindex="-1">${leaders.length > 1 ? "Ничья" : `Победили ${escape(leaders[0].name.toLowerCase())}`}</h1>
    ${leaders.length > 1 ? `<p class="survey-result-tie">${leaders.map(({ name }) => escape(name)).join(" и ")} поделили первое место</p>` : ""}
    <ol class="survey-result-podium" data-team-count="${standings.length}" role="list" aria-label="Места команд">
      ${standings.map(({ name, score, index }, position) => {
        const place = standings.findIndex((team) => team.score === score) + 1;
        const expanded = selection?.team === index;
        return `<li class="survey-team-${fruitOf(index)} survey-result-slot" data-position="${position + 1}" data-place="${place}">
          <button type="button" class="survey-result-patch" data-results-team="${index}"
            aria-label="${escape(name)}, ${countLabel(score, ["очко", "очка", "очков"])}, ${place} место"
            aria-expanded="${expanded}" aria-controls="survey-result-team-${index}">
            <span class="survey-result-fruit">${renderFruit(fruitOf(index))}</span>
            <span class="survey-result-name">${escape(name)}</span>
            <strong class="survey-result-score">${score}</strong>
            <span class="survey-result-chevron" aria-hidden="true"></span>
          </button>
        </li>`;
      }).join("")}
    </ol>
    ${standings.map(({ name, index }) =>
      renderTeamDetails(name, index, fruitOf(index), match.resultsStats?.teams.find(({ team }) => team === index)?.answers ?? [],
        selection?.team === index)).join("")}
    ${titles.length ? `<section class="survey-awards" aria-label="Титулы игроков">
      ${titles.map((title) => renderTitle(title, selection?.title === title.id)).join("")}
    </section>` : ""}
    <div class="survey-result-footer">
      ${canAdvance ? '<button class="survey-button primary-action" data-survey="reset">Сыграть ещё</button>' : '<p class="survey-muted">Ждём ведущего.</p>'}
    </div>
  </main>`;
}

export function mountSurveyResults(app: HTMLElement, inspect?: (event: SurveyResultsInteraction) => void) {
  const selection: ResultsSelection = { team: null, title: null };
  let hovered: TitleId | null = null;
  let focused: TitleId | null = null;
  let dismissed: TitleId | null = null;

  function sync<T extends "team" | "title">(kind: T, active: ResultsSelection[T]) {
    const value = active === null ? null : String(active);
    app.querySelectorAll<HTMLElement>(`[data-results-${kind}]`).forEach((button) => {
      button.setAttribute("aria-expanded", String(button.getAttribute(`data-results-${kind}`) === value));
    });
    app.querySelectorAll<HTMLElement>(`[data-results-${kind}-panel]`).forEach((panel) => {
      panel.hidden = panel.getAttribute(`data-results-${kind}-panel`) !== value;
    });
  }

  function syncTitles() {
    if (dismissed !== hovered && dismissed !== focused) dismissed = null;
    const active = focused ?? hovered ?? selection.title;
    sync("title", active === dismissed ? selection.title : active);
  }
  const titleId = (element: Element, attribute: string) => element.getAttribute(attribute) as TitleId | null;
  const titleCard = (event: Event) =>
    event.target instanceof Element ? event.target.closest("[data-results-title-card]") : null;
  const isWithin = (card: Element, target: EventTarget | null) => target instanceof Node && card.contains(target);

  app.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("[data-results-team], [data-results-title]");
    if (!button) return;
    const team = button.dataset.resultsTeam;
    if (team !== undefined) {
      const next = Number(team);
      selection.team = selection.team === next ? null : next;
      inspect?.({ kind: selection.team === null ? "close-team" : "open-team", team: next });
      sync("team", selection.team);
      return;
    }
    const title = titleId(button, "data-results-title");
    if (!title) return;
    selection.title = selection.title === title ? null : title;
    dismissed = selection.title === null ? title : null;
    inspect?.({ kind: selection.title === null ? "close-title" : "open-title", title });
    syncTitles();
  });

  app.addEventListener("pointerover", (event) => {
    if (event.pointerType !== "mouse") return;
    const card = titleCard(event);
    if (!card || isWithin(card, event.relatedTarget)) return;
    hovered = titleId(card, "data-results-title-card");
    syncTitles();
  });
  app.addEventListener("pointerout", (event) => {
    if (event.pointerType !== "mouse") return;
    const card = titleCard(event);
    if (!card || isWithin(card, event.relatedTarget)) return;
    hovered = null;
    syncTitles();
  });
  app.addEventListener("focusin", (event) => {
    const card = titleCard(event);
    if (!card || !(event.target instanceof Element) || !event.target.matches(":focus-visible")) return;
    focused = titleId(card, "data-results-title-card");
    syncTitles();
  });
  app.addEventListener("focusout", (event) => {
    const card = titleCard(event);
    if (!card || isWithin(card, event.relatedTarget)) return;
    focused = null;
    syncTitles();
  });
  app.addEventListener("keydown", (event) => {
    const card = titleCard(event);
    if (event.key !== "Escape" || !card) return;
    if (event.target instanceof Element && event.target.matches("[data-results-title-panel]")) {
      card.querySelector<HTMLElement>("[data-results-title]")?.focus();
    }
    if (selection.title) inspect?.({ kind: "close-title", title: selection.title });
    selection.title = null;
    dismissed = titleId(card, "data-results-title-card");
    syncTitles();
  });

  return {
    selection,
    reset() {
      selection.team = null;
      selection.title = hovered = focused = dismissed = null;
    },
  };
}
