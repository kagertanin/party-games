import "./demo.css";
import { MAX_ROUNDS, SurveyGame, TurnReadiness, type TurnResult } from "./survey";
import { demoGuesses, questions } from "./questions";
import { renderTurnSpiral } from "./turn-spiral";
import { renderFruit } from "./fruit-icons";
import { animateTurnResult } from "./turn-animation";
import { getTurnTiming } from "./turn-timing";

const READY_MS = 10_000;
const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
function clockText(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function mountSurveyDemo(app: HTMLElement) {
  let game: SurveyGame | null = null;
  let playerCount = 12;
  let player = 0;
  let deadline = 0;
  let votingOnly = false;
  let draft = "";
  let proposalError = "";
  let readiness: TurnReadiness | null = null;
  let resolving: TurnResult | null = null;
  document.title = "Угадай ответ · Party Games";

  const timeLeft = () => Math.max(0, deadline - performance.now());
  const turnTiming = (match: SurveyGame) =>
    getTurnTiming(match.questionIndex, match.turnIndex, match.teams.length);

  function teamSidebar(match: SurveyGame) {
    const hasTurn = match.phase === "turn";
    const playing = hasTurn && deadline !== 0;
    const activeTeam = resolving?.team ?? (hasTurn ? match.activeTeam : -1);
    const ownTeam = activeTeam < 0 ? match.lastAnswer?.team ?? match.activeTeam : activeTeam;
    const own = match.teams[ownTeam];
    const teamOrder = match.teams.map((_, turn) => match.teamForTurn(turn));
    const playedTurns = match.turnHistory.length;
    const totalTurns = match.teams.length * MAX_ROUNDS;
    const progressLabel = resolving ? "Результат хода." : hasTurn
      ? `Круг ${Math.floor(match.turnIndex / match.teams.length) + 1} из ${MAX_ROUNDS}. ${playing ? "Отвечают" : "Готовятся"} — ${match.teams[activeTeam].name}.`
      : "Вопрос завершён.";
    const ownScore = own.score - (resolving?.points ?? 0);
    const teamStatus = readiness ? "Готовятся" : playing ? "Отвечают" : "";

    return `<aside class="survey-sidebar" aria-label="Команды">
      <section class="survey-team-card survey-team-${ownTeam}${ownTeam === activeTeam ? " is-current" : ""}" aria-label="Моя команда">
        <div class="survey-team-head">
          <div><span class="survey-team-label">Моя команда</span><h2>${renderFruit(ownTeam)}${escape(own.name)}</h2>
            ${teamStatus ? `<small class="survey-responding">${teamStatus}</small>` : ""}</div>
          <strong class="survey-score-value" data-score-team="${ownTeam}" aria-label="Очки команды: ${ownScore}">${ownScore}</strong>
        </div>
        <ol class="survey-roster" aria-label="Игроки команды">
          ${own.players.map((name, index) => {
            const member = `<span class="survey-member-avatar" aria-hidden="true">${index + 1}</span>
              <span class="survey-member-name">${escape(name)}${player === index ? '<small class="survey-member-you"> (вы)</small>' : ""}</span>
              ${readiness?.isReady(index) ? '<small class="survey-member-status is-ready" aria-label="Готов">✓</small>'
                : playing && match.votes.has(index) ? '<small class="survey-member-status" aria-label="Голос отдан">✓</small>' : ""}`;
            return playing || readiness
              ? `<li><button class="survey-member" data-player="${index}" aria-pressed="${player === index}">${member}</button></li>`
              : `<li><div class="survey-member${player === index ? " is-selected" : ""}">${member}</div></li>`;
          }).join("")}
        </ol>
      </section>
      <div class="survey-rivals" aria-label="Соперники">
        ${match.teams.map((team, index) => index === ownTeam ? "" : `
          <div class="survey-rival survey-team-${index}">
            <span class="survey-team-name">${renderFruit(index)}
              <span>${escape(team.name)}</span>
            </span>
            <strong class="survey-rival-score" aria-label="Очки команды: ${team.score}">${team.score}</strong>
          </div>`).join("")}
      </div>
      <div class="survey-turn-progress" role="group" aria-label="${progressLabel} Сыграно ${playedTurns} из ${totalTurns} возможных ходов.">
        ${renderTurnSpiral(teamOrder, MAX_ROUNDS, playedTurns, hasTurn && !resolving, match.turnHistory)}
      </div>
    </aside>`;
  }

  function questionProgress(match: SurveyGame) {
    return `<div class="survey-question-progress" role="img" aria-label="Вопрос ${match.questionIndex + 1} из ${questions.length}">
      ${questions.map((_, index) => `<span class="survey-question-node${index < match.questionIndex ? " is-past" : index === match.questionIndex ? " is-current" : ""}" aria-hidden="true"></span>`).join("")}
    </div>`;
  }

  function revealedTile(match: SurveyGame, index: number, team: number | undefined) {
    const answer = match.question.answers[index];
    return `<span class="survey-rank">${index + 1}</span>
      <span class="survey-answer">${escape(answer.label)}</span>
      <span class="survey-points" aria-label="${team === undefined ? "Не начислено" : "Очки"}: ${answer.points}">${answer.points}</span>`;
  }

  function board(match: SurveyGame) {
    const revealed = match.phase === "reveal" && !resolving;
    return `<section class="survey-board" aria-label="Табло ответов">
      <ol>${match.question.answers.map((_, index) => {
        const team = match.opened.get(index);
        return (team !== undefined || revealed) && resolving?.answerIndex !== index
          ? `<li data-answer-index="${index}" class="${team === undefined ? "unclaimed" : `found survey-team-${team}`}">${revealedTile(match, index, team)}</li>`
          : `<li data-answer-index="${index}" class="hidden-answer" aria-label="Ответ ${index + 1} скрыт"><span class="survey-rank">${index + 1}</span></li>`;
      }).join("")}</ol>
    </section>`;
  }

  function turnPanel(match: SurveyGame) {
    if (resolving) {
      const verdict = {hit: "Верно!", miss: "Мимо!", repeat: "Уже открыто", pass: "Ход пропущен"}[resolving.kind];
      return `<section class="survey-panel" aria-label="Результат хода">
        <div class="survey-resolution survey-team-${resolving.team}" role="status">
          <p class="survey-verdict ${resolving.kind}">${verdict}</p>
          ${resolving.text ? `<strong class="survey-resolved-answer">${escape(resolving.text)}</strong>` : ""}
        </div>
      </section>`;
    }
    if (match.phase === "reveal") {
      return `<section class="survey-panel survey-recap">
        <h2>Вопрос завершён</h2>
        <p>${match.opened.size === match.question.answers.length ? "Все шесть ответов угаданы." : "Два круга закончились. Открыли оставшиеся строки, очки за них никому не начислены."}</p>
        <button class="survey-button primary-action" data-survey="next-question">${match.questionIndex + 1 === questions.length ? "Показать итоги" : "Следующий вопрос"}</button>
      </section>`;
    }
    const team = match.teams[match.activeTeam];
    const timing = turnTiming(match);
    if (readiness) {
      const confirmed = readiness.isReady(player);
      return `<section class="survey-panel survey-team-${match.activeTeam}" aria-label="Подготовка команды">
        <div class="survey-ready">
          <div class="survey-ready-copy">
            <h2>${renderFruit(match.activeTeam)}${escape(team.name)}, ваш ход!</h2>
            <p class="survey-ready-count" role="status">Готовы ${readiness.count} из ${team.players.length}</p>
          </div>
          ${timing.showClockAtMs === 0 ? timer(readiness.remaining(performance.now()), READY_MS, "До начала", "Время до начала хода") : ""}
          <button class="survey-button survey-ready-button" data-survey="ready" ${confirmed ? "disabled" : ""}>${confirmed ? "Вы готовы" : "Готов"}</button>
        </div>
      </section>`;
    }
    const selected = match.votes.get(player);
    const hasProposed = match.hasProposed(player);
    const cardList = match.proposals.map((proposal) => {
      const votes = Array.from(match.votes.values()).filter((id) => id === proposal.id).length;
      const marked = selected === proposal.id;
      return `<button class="survey-proposal" data-vote="${proposal.id}" aria-pressed="${marked}">
        <span class="survey-choice-mark" aria-hidden="true">${marked ? "✓" : ""}</span>
        <span>${escape(proposal.text)}</span>
        <span class="survey-votes" aria-label="Голосов: ${votes}">${votes}</span>
      </button>`;
    }).join("");

    const remaining = timeLeft();
    const visibleWindowMs = timing.durationMs - timing.showClockAtMs;
    return `<section class="survey-panel survey-team-${match.activeTeam}" aria-label="Ход команды">
      <div class="survey-workhead">
        <div class="survey-work-heading">
          <h2>${votingOnly ? "Время голосовать" : "Предложите ответ"}</h2>
          ${votingOnly ? '<p class="survey-phase">Приём вариантов завершён.</p>' : ""}
        </div>
        ${remaining <= visibleWindowMs ? timer(remaining, visibleWindowMs, "Ваш ход", "Время хода") : ""}
      </div>
        ${votingOnly ? "" : hasProposed ? `<p class="survey-muted">Твой вариант в списке. Теперь проголосуй.</p>` : `
          <form class="survey-form" id="survey-propose">
            <input name="answer" aria-label="Твой вариант ответа" placeholder="Ваш вариант" value="${escape(draft)}" maxlength="80" required autocomplete="off" aria-describedby="survey-error">
            <button class="survey-button primary-action" type="submit">Предложить</button>
          </form>`}
        <p id="survey-error" class="survey-error" role="status">${escape(proposalError)}</p>
        <div class="survey-step"><h3>Выберите ответ команды</h3><small>Голосов: ${match.votes.size}/${team.players.length}</small></div>
        <div class="survey-proposals">${cardList || '<p class="survey-muted">Здесь появятся варианты вашей команды.</p>'}</div>
        <div class="survey-turn-actions">
          <button class="survey-button secondary-action" data-survey="suggest" ${votingOnly ? "disabled" : ""}>Примеры от команды</button>
          <button class="survey-button primary-action" data-survey="submit">${match.votes.size ? "Засчитать голоса" : "Пропустить ход"}</button>
        </div>
    </section>`;
  }

  function timer(remaining: number, duration: number, label: string, description: string) {
    return `<div class="survey-timer">
      <span class="survey-timer-label">${label}</span>
      <time class="survey-clock" id="survey-clock" datetime="PT${Math.ceil(remaining / 1000)}S">${clockText(remaining)}</time>
      <progress class="survey-clock-track" max="${duration}" value="${remaining}" aria-label="${description}"></progress>
    </div>`;
  }

  function setup() {
    return `<main class="survey-wrap survey-setup">
      <div class="survey-intro">
        <p class="survey-kicker">Демопартия · 10–12 участников</p>
        <h1>Угадай<br><em>ответ.</em></h1>
        <p>Шесть популярных ответов скрыты на табло. Предлагайте свои варианты, голосуйте внутри команды и открывайте строки.</p>
        <div class="survey-start">
          <label>Игроков <select id="survey-size" aria-label="Число игроков">${[10, 11, 12].map((size) => `<option ${size === playerCount ? "selected" : ""}>${size}</option>`).join("")}</select></label>
          <button class="survey-button primary-action" data-survey="start">Начать демопартию</button>
        </div>
        <p class="survey-muted">В демо можно переключаться между игроками и управлять всеми тремя командами на этом экране.</p>
      </div>
      <aside class="survey-preview">
        <div class="survey-board-heading"><h2>Как проходит партия</h2></div>
        <ol>
          <li><strong>Три вопроса</strong><span>На каждый — шесть ответов из опроса.</span></li>
          <li><strong>Три команды по очереди</strong><span>На готовность — до 10 секунд. Все готовы — ход начинается сразу.</span></li>
          <li><strong>На первые ходы — по 3 минуты</strong><span>Отсчёт виден в последние 30 секунд. Дальше на ход одна минута, последние 10 секунд — голосование.</span></li>
          <li><strong>Два круга на вопрос</strong><span>Оставшиеся ответы открываются без начисления очков.</span></li>
        </ol>
      </aside>
    </main>`;
  }

  function results(match: SurveyGame) {
    const standings = [...match.teams].sort((a, b) => b.score - a.score);
    const winners = standings.filter((team) => team.score === standings[0].score);
    return `<main class="survey-wrap survey-results">
      <p class="survey-kicker">Три вопроса сыграны</p>
      <h1>${winners.length > 1 ? "Ничья" : `Победили <em>${winners[0].name.toLowerCase()}</em>`}</h1>
      ${winners.length > 1 ? `<p>${winners.map((team) => team.name).join(" · ")} набрали по ${winners[0].score} очков.</p>` : ""}
      <ol>${standings.map((team) => {
        const index = match.teams.indexOf(team);
        return `<li class="survey-team-${index}"><span>${renderFruit(index)}${team.name}</span><strong>${team.score}</strong></li>`;
      }).join("")}</ol>
      <button class="survey-button primary-action" data-survey="reset">Сыграть ещё</button>
    </main>`;
  }

  function render() {
    app.classList.add("survey-app");
    app.innerHTML = `
      <header class="survey-header"><a href="./" class="survey-brand">Party Games</a><span>Угадай ответ</span><a href="./">Все игры</a></header>
      ${!game ? setup() : game.phase === "results" ? results(game) : `
        <main class="survey-wrap survey-match">
          ${teamSidebar(game)}
          <div class="survey-main">
            <div class="survey-question">
              ${questionProgress(game)}
              <h1>${escape(game.question.prompt)}</h1>
            </div>
            ${board(game)}
            ${turnPanel(game)}
          </div>
        </main>`}`;
  }

  function prepareTurn() {
    if (!game || game.phase !== "turn") return;
    readiness = new TurnReadiness(game.teams[game.activeTeam].players.length, performance.now(), READY_MS);
    player = 0;
    render();
    focusNext();
  }

  function beginTurn() {
    if (!game) return;
    readiness = null;
    deadline = performance.now() + turnTiming(game).durationMs;
    votingOnly = false;
    proposalError = "";
    draft = "";
    render();
    document.querySelector<HTMLInputElement>("#survey-propose input")?.focus({preventScroll: true});
  }

  async function finishTurn() {
    if (!game || !deadline || resolving) return;
    const match = game;
    const proposals = [...match.proposals];
    match.finishTurn();
    deadline = 0;
    const result = match.lastAnswer!;
    const choice = proposals.find(({text}) => text === result.text);
    const source = choice ? app.querySelector(`[data-vote="${choice.id}"]`)?.getBoundingClientRect() ?? null : null;
    resolving = result;
    render();
    const tile = result.answerIndex === undefined ? null
      : app.querySelector<HTMLElement>(`[data-answer-index="${result.answerIndex}"]`);
    const score = app.querySelector<HTMLElement>(`[data-score-team="${result.team}"]`);
    try {
      await animateTurnResult(result, {
        root: app,
        source,
        tile,
        score,
        verdict: app.querySelector<HTMLElement>(".survey-verdict"),
        reveal: () => {
          if (!tile || result.answerIndex === undefined) return;
          tile.classList.remove("hidden-answer");
          tile.classList.add("found", `survey-team-${result.team}`);
          tile.removeAttribute("aria-label");
          tile.innerHTML = revealedTile(match, result.answerIndex, result.team);
        },
        award: () => {
          if (!score) return;
          const total = match.teams[result.team].score;
          score.textContent = String(total);
          score.setAttribute("aria-label", `Очки команды: ${total}`);
        },
      });
    } finally {
      resolving = null;
      if (match.phase === "turn") prepareTurn();
      else {
        render();
        focusNext();
      }
    }
  }

  function focusNext() {
    app.querySelector<HTMLButtonElement>(".survey-panel [data-survey]")?.focus({preventScroll: true});
  }

  function refreshTimer() {
    if (readiness) {
      const now = performance.now();
      if (readiness.shouldStart(now)) beginTurn();
      else updateClock(readiness.remaining(now));
      return;
    }
    if (!game || !deadline) return;
    const remaining = timeLeft();
    if (!remaining) {
      void finishTurn();
      return;
    }
    const timing = turnTiming(game);
    if (!votingOnly && remaining <= timing.voteOnlyMs) {
      const focused = document.activeElement;
      const previousPlayer = focused instanceof HTMLButtonElement ? focused.dataset.player : undefined;
      const previousVote = focused instanceof HTMLButtonElement ? focused.dataset.vote : undefined;
      const finishFocused = focused?.matches("[data-survey='submit']");
      votingOnly = true;
      render();
      let replacement = "";
      if (previousPlayer !== undefined) replacement = `[data-player="${previousPlayer}"]`;
      else if (previousVote !== undefined) replacement = `[data-vote="${previousVote}"]`;
      else if (finishFocused) replacement = "[data-survey='submit']";
      else if (focused?.closest("#survey-propose, [data-survey='suggest']")) {
        replacement = ".survey-proposal, [data-survey='submit']";
      }
      if (replacement) app.querySelector<HTMLButtonElement>(replacement)?.focus({preventScroll: true});
    } else {
      const visibleWindowMs = timing.durationMs - timing.showClockAtMs;
      if (remaining > visibleWindowMs) return;
      if (!app.querySelector("#survey-clock")) {
        app.querySelector(".survey-workhead")?.insertAdjacentHTML(
          "beforeend", timer(remaining, visibleWindowMs, "Ваш ход", "Время хода"),
        );
      } else updateClock(remaining);
    }
  }

  function updateClock(remaining: number) {
    const clock = app.querySelector<HTMLTimeElement>("#survey-clock");
    const time = clockText(remaining);
    if (clock && clock.textContent !== time) {
      clock.textContent = time;
      clock.dateTime = `PT${Math.ceil(remaining / 1000)}S`;
    }
    const track = app.querySelector<HTMLProgressElement>(".survey-clock-track");
    if (track) track.value = remaining;
  }

  function addExamples(match: SurveyGame) {
    const examples = demoGuesses[match.questionIndex];
    match.teams[match.activeTeam].players.forEach((_, index) => {
      if (index === player || match.hasProposed(index)) return;
      const guess = examples[(match.turnIndex + index + examples.length - player - 1) % examples.length];
      match.propose(index, guess);
    });
    render();
    document.querySelector<HTMLButtonElement>(".survey-proposal")?.focus({preventScroll: true});
  }

  app.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === "answer") draft = event.target.value;
  });
  app.addEventListener("change", (event) => {
    if (event.target instanceof HTMLSelectElement && event.target.id === "survey-size") playerCount = Number(event.target.value);
  });
  app.addEventListener("submit", (event) => {
    if (!(event.target instanceof HTMLFormElement) || event.target.id !== "survey-propose") return;
    event.preventDefault();
    if (!game || timeLeft() <= turnTiming(game).voteOnlyMs) { refreshTimer(); return; }
    const answer = draft.trim();
    if (!answer) return;
    try {
      game.propose(player, answer);
    } catch (error) {
      proposalError = (error as Error).message;
      render();
      document.querySelector<HTMLInputElement>("#survey-propose input")?.focus();
      return;
    }
    proposalError = "";
    draft = "";
    render();
    document.querySelector<HTMLButtonElement>(".survey-proposal")?.focus({preventScroll: true});
  });
  app.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    const action = button.dataset.survey;
    if (action === "start") {
      game = new SurveyGame(questions, playerCount);
      prepareTurn();
      return;
    }
    if (!game || resolving) return;
    if (readiness?.shouldStart(performance.now())) { beginTurn(); return; }
    if (deadline && !timeLeft()) { void finishTurn(); return; }
    if (action === "ready" && readiness) {
      if (readiness.confirm(player, performance.now())) beginTurn();
      else {
        render();
        app.querySelector<HTMLButtonElement>(`[data-player="${player}"]`)?.focus({preventScroll: true});
      }
      return;
    }
    if (action === "submit") { void finishTurn(); return; }
    if (action === "suggest" && timeLeft() > turnTiming(game).voteOnlyMs) addExamples(game);
    if (action === "next-question") {
      game.nextQuestion();
      if (game.phase === "turn") prepareTurn();
      else {
        render();
        focusNext();
      }
    }
    if (action === "reset") {
      game = null;
      player = 0;
      render();
      document.querySelector<HTMLButtonElement>("[data-survey='start']")?.focus();
      return;
    }
    if ((deadline || readiness) && button.dataset.player !== undefined) {
      player = Number(button.dataset.player);
      proposalError = "";
      draft = "";
      render();
      document.querySelector<HTMLButtonElement>(`[data-player="${player}"]`)?.focus({preventScroll: true});
    }
    if (deadline && button.dataset.vote !== undefined) {
      const proposal = Number(button.dataset.vote);
      game.vote(player, proposal);
      render();
      document.querySelector<HTMLButtonElement>(`[data-vote="${proposal}"]`)?.focus({preventScroll: true});
    }
  });
  window.setInterval(refreshTimer, 125);
  render();
}
