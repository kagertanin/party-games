import "./demo.css";
import { SurveyGame } from "./survey";
import { demoGuesses, questions } from "./questions";

const TURN_MS = 30_000;
const VOTE_ONLY_MS = 10_000;
const colors = ["#baf68f", "#ffd084", "#d4b9ff"];
const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);

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

  function scoreboard(match: SurveyGame) {
    return `<div class="survey-scores" aria-label="Общий счёт">
      ${match.teams.map((team, index) => `
        <div class="survey-score ${match.phase === "turn" && index === match.activeTeam ? "active" : ""}" style="--team:${colors[index]}">
          <span class="survey-team-name"><i></i>${team.name}</span>
          <strong>${team.score}</strong>
        </div>`).join("")}
    </div>`;
  }

  function board(match: SurveyGame) {
    const revealed = match.phase === "reveal";
    return `<section class="survey-board" aria-label="Табло ответов">
      <div class="survey-board-heading"><h2>Табло</h2><span>Угадано ${match.opened.size} из 6</span></div>
      <ol>${match.question.answers.map((answer, index) => {
        const team = match.opened.get(index);
        const opened = team !== undefined;
        return `<li class="${opened ? "found" : revealed ? "unclaimed" : "hidden-answer"}" ${opened ? `style="--team:${colors[team]}"` : ""}>
          <span class="survey-rank">${index + 1}</span>
          <span class="survey-answer">${opened || revealed ? escape(answer.label) : '<span class="survey-mask" aria-label="Ответ скрыт"></span>'}</span>
          <span class="survey-points">${opened || revealed ? answer.points : "—"}</span>
        </li>`;
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
        <span>${escape(proposal.text)}${marked ? "<small>Твой голос</small>" : ""}</span>
        <span class="survey-votes" aria-label="Голосов: ${votes}">${votes}</span>
      </button>`;
    }).join("");

    return `<section class="survey-panel" style="--team:${colors[match.activeTeam]}" aria-label="Ход команды">
      <div class="survey-panel-head">
        <div><span>${deadline ? "Сейчас отвечает" : "Следующая команда"}</span><h2>${team.name}</h2></div>
        <div class="survey-clock" id="survey-clock" aria-label="Секунды до конца хода">${deadline ? Math.ceil(timeLeft() / 1000) : 30}<small>сек.</small></div>
      </div>
      ${deadline ? `
        <p class="survey-phase" id="survey-phase">${votingOnly ? "Последние секунды · только голосование" : "Предложения и голосование"}</p>
        <div class="survey-personas" aria-label="Участники команды">
          ${team.players.map((name, index) => `<button data-player="${index}" aria-pressed="${player === index}" title="${match.votes.has(index) ? "Голос отдан" : "Можно проголосовать"}">${escape(name)}${match.votes.has(index) ? " ✓" : ""}</button>`).join("")}
        </div>
        <div class="survey-step"><span>1</span><h3>Предложи ответ</h3></div>
        ${votingOnly ? `<p class="survey-muted">Приём вариантов завершён.</p>` : hasProposed ? `<p class="survey-muted">Твой вариант в списке. Теперь проголосуй.</p>` : `
          <form class="survey-form" id="survey-propose">
            <input name="answer" aria-label="Твой вариант ответа" placeholder="Введи свой вариант" value="${escape(draft)}" maxlength="80" required autocomplete="off" aria-describedby="survey-error">
            <button class="survey-button secondary-action" type="submit">Предложить</button>
          </form>`}
        <p id="survey-error" class="survey-error" role="status">${escape(proposalError)}</p>
        <div class="survey-step"><span>2</span><h3>Выбери ответ команды</h3><small>Голосов: ${match.votes.size}/${team.players.length}</small></div>
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
      <ol>${standings.map((team) => `<li style="--team:${colors[match.teams.indexOf(team)]}"><span><i></i>${team.name}</span><strong>${team.score}</strong></li>`).join("")}</ol>
      <button class="survey-button primary-action" data-survey="reset">Сыграть ещё</button>
    </main>`;
  }

  function render() {
    app.classList.add("survey-app");
    app.innerHTML = `
      <header class="survey-header"><a href="./" class="survey-brand">party<span>games</span></a><span>Угадай ответ</span><a href="./">Все игры</a></header>
      ${!game ? setup() : game.phase === "results" ? results(game) : `
        <main class="survey-wrap survey-match">
          ${scoreboard(game)}
          <div class="survey-question">
            <div class="survey-meta"><span>Вопрос ${game.questionIndex + 1} из ${questions.length}</span><span>Круг ${Math.floor(game.turnIndex / 3) + 1} из 3</span></div>
            <h1>${escape(game.question.prompt)}</h1>
          </div>
          <div class="survey-columns">${board(game)}${turnPanel(game)}</div>
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
    document.querySelector<HTMLButtonElement>(".survey-panel .primary-action")?.focus({preventScroll: true});
  }

  function refreshTimer() {
    if (!deadline) return;
    const remaining = timeLeft();
    if (!remaining) {
      finishTurn();
      return;
    }
    if (!votingOnly && remaining <= VOTE_ONLY_MS) {
      const hadInputFocus = document.activeElement?.closest("#survey-propose");
      votingOnly = true;
      render();
      if (hadInputFocus) document.querySelector<HTMLButtonElement>(".survey-proposal, [data-survey='submit']")?.focus({preventScroll: true});
    } else {
      const clock = document.querySelector("#survey-clock");
      if (clock?.firstChild) clock.firstChild.textContent = String(Math.ceil(remaining / 1000));
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
