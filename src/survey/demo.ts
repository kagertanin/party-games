import "./demo.css";
import { MAX_ROUNDS, SurveyGame } from "./survey";
import { demoGuesses, questions } from "./questions";
import { renderTurnSpiral } from "./turn-spiral";

const TURN_MS = 30_000;
const VOTE_ONLY_MS = 10_000;
const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
const clockText = (milliseconds: number) =>
  `00:${String(Math.ceil(milliseconds / 1000)).padStart(2, "0")}`;

export function mountSurveyDemo(app: HTMLElement) {
  let game: SurveyGame | null = null;
  let playerCount = 12;
  let player = 0;
  let deadline = 0;
  let votingOnly = false;
  let draft = "";
  let proposalError = "";
  let previousResult = false;
  document.title = "Угадай ответ · Party Games";

  const timeLeft = () => Math.max(0, deadline - performance.now());

  function teamSidebar(match: SurveyGame) {
    const hasTurn = match.phase === "turn";
    const playing = hasTurn && deadline !== 0;
    const activeTeam = hasTurn ? match.activeTeam : -1;
    const ownTeam = !playing && match.lastAnswer ? match.lastAnswer.team : match.activeTeam;
    const own = match.teams[ownTeam];
    const teamOrder = match.teams.map((_, turn) => match.teamForTurn(turn));
    const playedTurns = match.turnIndex + Number(!hasTurn);
    const totalTurns = match.teams.length * MAX_ROUNDS;
    const progressLabel = hasTurn
      ? `Круг ${Math.floor(match.turnIndex / match.teams.length) + 1} из ${MAX_ROUNDS}. ${playing ? "Отвечают" : "Следом"} — ${match.teams[activeTeam].name}.`
      : "Вопрос завершён.";

    return `<aside class="survey-sidebar" aria-label="Команды">
      <section class="survey-team-card survey-team-${ownTeam}${ownTeam === activeTeam ? " is-current" : ""}" aria-label="Моя команда">
        <div class="survey-team-head">
          <div><span class="survey-team-label">Моя команда</span><h2>${escape(own.name)}</h2>
            ${ownTeam === activeTeam && playing ? '<small class="survey-responding">Отвечают</small>' : ""}</div>
          <strong class="survey-score-value" aria-label="Очки команды: ${own.score}">${own.score}</strong>
        </div>
        <ol class="survey-roster" aria-label="Игроки команды">
          ${own.players.map((name, index) => {
            const member = `<span class="survey-member-avatar" aria-hidden="true">${index + 1}</span>
              <span class="survey-member-name">${escape(name)}${player === index ? '<small class="survey-member-you"> (вы)</small>' : ""}</span>
              ${playing && match.votes.has(index) ? '<small class="survey-member-status" aria-label="Голос отдан">✓</small>' : ""}`;
            return playing
              ? `<li><button class="survey-member" data-player="${index}" aria-pressed="${player === index}">${member}</button></li>`
              : `<li><div class="survey-member${player === index ? " is-selected" : ""}">${member}</div></li>`;
          }).join("")}
        </ol>
      </section>
      <div class="survey-rivals" aria-label="Соперники">
        ${match.teams.map((team, index) => index === ownTeam ? "" : `
          <div class="survey-rival survey-team-${index}${index === activeTeam ? " is-current" : ""}">
            <span class="survey-team-name"><i class="survey-team-dot" aria-hidden="true"></i>
              <span>${escape(team.name)}${index === activeTeam ? '<small class="survey-responding">Следом</small>' : ""}</span>
            </span>
            <strong aria-label="Очки команды: ${team.score}">${team.score}</strong>
          </div>`).join("")}
      </div>
      <div class="survey-turn-progress" role="img" aria-label="${progressLabel} Сыграно ${playedTurns} из ${totalTurns} возможных ходов.">
        ${renderTurnSpiral(teamOrder, MAX_ROUNDS, playedTurns, hasTurn)}
      </div>
    </aside>`;
  }

  function questionProgress(match: SurveyGame) {
    return `<div class="survey-question-progress" role="img" aria-label="Вопрос ${match.questionIndex + 1} из ${questions.length}">
      ${questions.map((_, index) => `<span class="survey-question-node${index < match.questionIndex ? " is-past" : index === match.questionIndex ? " is-current" : ""}" aria-hidden="true"></span>`).join("")}
    </div>`;
  }

  function board(match: SurveyGame) {
    const revealed = match.phase === "reveal";
    return `<section class="survey-board" aria-label="Табло ответов">
      <ol>${match.question.answers.map((answer, index) => {
        const team = match.opened.get(index);
        const opened = team !== undefined;
        return opened || revealed
          ? `<li class="${opened ? `found survey-team-${team}` : "unclaimed"}">
            <span class="survey-rank">${index + 1}</span>
            <span class="survey-answer">${escape(answer.label)}</span>
            <span class="survey-points" aria-label="${opened ? "Очки" : "Не начислено"}: ${answer.points}">${answer.points}</span>
          </li>`
          : `<li class="hidden-answer" aria-label="Ответ ${index + 1} скрыт"><span class="survey-rank">${index + 1}</span></li>`;
      }).join("")}</ol>
    </section>`;
  }

  function resultText(match: SurveyGame) {
    const result = match.lastAnswer;
    if (!result) return "";
    const answer = escape(result.text);
    return `<div class="survey-feedback ${result.kind}" role="status">
      <strong>${match.teams[result.team].name}${result.kind === "pass" ? " пропустили ход" : ` · «${answer}»`}</strong>
      <span>${{hit: `Ответ на табло · +${result.points} очков`, miss: "Такого ответа нет на табло", repeat: "Эта строка уже открыта", pass: "Голосов не было"}[result.kind]}</span>
    </div>`;
  }

  function turnPanel(match: SurveyGame) {
    if (match.phase === "reveal") {
      return `<section class="survey-panel survey-recap">
        <h2>Вопрос завершён</h2>
        <p>${match.opened.size === 6 ? "Все шесть ответов угаданы." : "Три круга закончились. Открыли оставшиеся строки, очки за них никому не начислены."}</p>
        ${resultText(match)}
        <button class="survey-button primary-action" data-survey="next-question">${match.questionIndex + 1 === questions.length ? "Показать итоги" : "Следующий вопрос"}</button>
      </section>`;
    }
    const team = match.teams[match.activeTeam];
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

    const remaining = deadline ? timeLeft() : TURN_MS;
    return `<section class="survey-panel survey-team-${match.activeTeam}" aria-label="Ход команды">
      <div class="survey-workhead">
        <div class="survey-work-heading">
          <h2>${deadline ? votingOnly ? "Время голосовать" : "Предложите ответ" : "Следующий ход"}</h2>
          ${deadline && votingOnly ? '<p class="survey-phase">Приём вариантов завершён.</p>' : ""}
        </div>
        <div class="survey-timer">
          <span class="survey-timer-label">${deadline ? "Ваш ход" : escape(team.name)}</span>
          <time class="survey-clock" id="survey-clock" datetime="PT${Math.ceil(remaining / 1000)}S">${clockText(remaining)}</time>
          <progress class="survey-clock-track" max="${TURN_MS}" value="${remaining}" aria-label="Время хода"></progress>
        </div>
      </div>
      ${deadline ? `
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
      ` : `
        ${previousResult ? resultText(match) : "<p>У каждого участника один вариант и один голос. У команды — один итоговый ответ.</p>"}
        <button class="survey-button primary-action" data-survey="turn">${previousResult ? "Следующий ход" : "Начать ход"}</button>`}
    </section>`;
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
        <div class="survey-board-heading"><h2>Как проходит партия</h2><span>Около 15 минут</span></div>
        <ol>
          <li><strong>Три вопроса</strong><span>На каждый — шесть ответов из опроса.</span></li>
          <li><strong>Три команды по очереди</strong><span>После ответа ход всегда переходит дальше.</span></li>
          <li><strong>30 секунд на ход</strong><span>20 секунд на предложения, последние 10 — только на выбор.</span></li>
          <li><strong>До трёх кругов на вопрос</strong><span>Всё угадали — заканчиваем раньше. Остаток открываем без начисления очков.</span></li>
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
      <ol>${standings.map((team) => `<li class="survey-team-${match.teams.indexOf(team)}"><span><i></i>${team.name}</span><strong>${team.score}</strong></li>`).join("")}</ol>
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
        </main>`}
      <footer class="survey-footer"><span>Демо на одном экране</span><span>Данные: <a href="https://github.com/iesl/protoqa-data" target="_blank" rel="noopener noreferrer">ProtoQA (Boratko и др., 2020)</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a> · перевод и варианты ввода адаптированы</span></footer>`;
  }

  function beginTurn() {
    deadline = performance.now() + TURN_MS;
    votingOnly = false;
    proposalError = "";
    player = 0;
    draft = "";
    render();
    document.querySelector<HTMLInputElement>("#survey-propose input")?.focus({preventScroll: true});
  }

  function finishTurn() {
    if (!game || !deadline) return;
    game.finishTurn();
    deadline = 0;
    previousResult = true;
    render();
    focusNext();
  }

  function focusNext() {
    app.querySelector<HTMLButtonElement>(".survey-panel [data-survey]")?.focus({preventScroll: true});
  }

  function refreshTimer() {
    if (!deadline) return;
    const remaining = timeLeft();
    if (!remaining) {
      finishTurn();
      return;
    }
    if (!votingOnly && remaining <= VOTE_ONLY_MS) {
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
      const clock = app.querySelector<HTMLTimeElement>("#survey-clock");
      const time = clockText(remaining);
      if (clock && clock.textContent !== time) {
        clock.textContent = time;
        clock.dateTime = `PT${Math.ceil(remaining / 1000)}S`;
      }
      const track = app.querySelector<HTMLProgressElement>(".survey-clock-track");
      if (track) track.value = remaining;
    }
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
    if (!game || timeLeft() <= VOTE_ONLY_MS) { refreshTimer(); return; }
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
      player = 0;
      previousResult = false;
      render();
      focusNext();
      return;
    }
    if (!game) return;
    if (deadline && !timeLeft()) { finishTurn(); return; }
    if (action === "turn") beginTurn();
    if (action === "submit") finishTurn();
    if (action === "suggest" && timeLeft() > VOTE_ONLY_MS) addExamples(game);
    if (action === "next-question") {
      game.nextQuestion();
      player = 0;
      previousResult = false;
      render();
      focusNext();
    }
    if (action === "reset") {
      game = null;
      render();
      document.querySelector<HTMLButtonElement>("[data-survey='start']")?.focus();
      return;
    }
    if (deadline && button.dataset.player !== undefined) {
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
