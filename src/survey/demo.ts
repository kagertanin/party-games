import "./demo.css";
import gamesLogo from "../home-art/logo.webp";
import surveyTitlePatch from "./art/survey-title.webp";
import beachPatch from "./art/beach.webp";
import { MAX_ROUNDS, MAX_SURVEY_PLAYERS, MIN_SURVEY_PLAYERS, SurveyGame, TurnReadiness, type Question, type TurnResult } from "./survey";
import { QuestionDeck } from "./question-deck";
import { renderTurnSpiral } from "./turn-spiral";
import { renderFruit } from "./fruit-icons";
import { animateTurnResult } from "./turn-animation";
import { getReadinessClockAtMs, getTurnTiming, READINESS_MS } from "./turn-timing";
import { mountHoldConfirm } from "./hold-confirm";
import { mountAnswerAward } from "./answer-award";
import { QuestionBallot, QUESTION_BALLOT_CLOCK_MS, QUESTIONS_PER_MATCH } from "./question-ballot";
import { animateQuestionChoice } from "./question-transition";
import { createSurveyLobby } from "./online-lobby";
import { displayOnlineMatch, type SurveyDisplay } from "./online-match";
import { SURVEY_RESOLUTION_MS, type SurveyMatchView, type SurveyRoomView } from "../../shared/survey-online";

const DEMO_PLAYER_COUNT = 12;

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
  let playerCount = DEMO_PLAYER_COUNT;
  let isDemo = true;
  let player = 0;
  let viewingTeam: number | null = 0;
  let expandedTeam: number | null = 0;
  let questionVoter = 0;
  let questionBallot: QuestionBallot | null = null;
  let changingQuestion = false;
  let demoQuestions: readonly Question[] = [];
  let demoExamples: readonly (readonly string[])[] = [];
  let demoDeck: QuestionDeck | undefined;
  let deadline = 0;
  let votingOnly = false;
  let draft = "";
  let proposalError = "";
  let readiness: TurnReadiness | null = null;
  let resolving: TurnResult | null = null;
  let onlineAnimation: AbortController | null = null;
  let liveDeadline = 0;
  let lastOnlineView: SurveyRoomView | null = null;
  let livePhaseId: number | undefined;
  let liveClockVisible = false;
  let liveVotingOnly = false;
  const lobby = createSurveyLobby(app, updateOnline);
  document.title = "Сто к одному · Party Games";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#ede7fb");

  const liveMatch = () => lobby.view?.match;
  const fruitOf = (team: number) => lobby.view?.teams[team]?.fruitIndex ?? team;
  const timeLeft = () => Math.max(0, (liveMatch() ? liveDeadline : deadline) - performance.now());
  const turnTiming = (match: SurveyDisplay) =>
    getTurnTiming(match.questionIndex, match.turnIndex, match.teams.length);
  const readyClockWindow = (match: SurveyDisplay) =>
    READINESS_MS - getReadinessClockAtMs(match.questionIndex, match.turnIndex, match.teams.length);
  const visibleTurnClockWindow = (match: SurveyDisplay) => {
    const {durationMs, showClockAtMs} = turnTiming(match);
    return durationMs - showClockAtMs;
  };
  const canAct = (match: SurveyDisplay) => liveMatch()
    ? lobby.connected && viewingTeam === match.activeTeam
    : viewingTeam === null || viewingTeam === match.activeTeam;
  const isBallot = () => liveMatch()?.phase === "ballot" || questionBallot !== null;
  const readyPlayer = (index: number) => liveMatch()?.ready.includes(index) ?? readiness?.isReady(index) ?? false;
  const waitingForTeam = () => liveMatch() ? liveMatch()?.phase === "ready" : readiness !== null;
  const canAdvance = () => !lobby.view || (lobby.connected && lobby.view.you === lobby.view.owner);
  function awardContext(answerIndex: number) {
    const room = lobby.view;
    const online = room?.match;
    const match = room && online ? displayOnlineMatch(room, online) : game;
    if (!match || match.phase !== "reveal" || resolving || !canAdvance() || match.opened.has(answerIndex)) return;
    const answer = match.question.answers[answerIndex];
    if (!answer) return;
    return {
      key: room && online ? `${room.code}:${online.phaseId}` : `demo:${match.questionIndex}`,
      label: answer.label,
      points: answer.points,
      teams: match.teams,
    };
  }
  const syncAnswerAward = mountAnswerAward(app, awardContext, (answerIndex, team) => {
    const online = liveMatch();
    if (online) {
      lobby.send({ type: "award-answer", phaseId: online.phaseId, answerIndex, team });
    } else if (game) {
      game.awardAnswer(answerIndex, team);
      render();
      focusNext();
    }
  });
  const cancelHold = mountHoldConfirm(app, (id) => {
    const match = liveMatch();
    if (match) {
      if (match.phase === "turn" && match.confirmationId === id) {
        lobby.send({ type: "confirm", phaseId: match.phaseId, id });
      }
      return;
    }
    if (!game || !deadline || resolving || !canAct(game)) return;
    const remaining = timeLeft();
    if (!remaining) {
      void finishTurn();
    } else if (game.confirmationCandidate(remaining <= visibleTurnClockWindow(game))?.id === id) {
      void finishTurn(id);
    }
  });

  function teamSidebar(match: SurveyDisplay) {
    const result = resolving ?? liveMatch()?.resolution;
    const hasTurn = match.phase === "turn" && !isBallot() && !changingQuestion && !result;
    const playing = hasTurn && (liveMatch() ? liveMatch()?.phase === "turn" : deadline !== 0);
    const activeTeam = result?.team ?? (hasTurn ? match.activeTeam : -1);
    const ownTeam = viewingTeam ?? (result?.team ?? match.lastAnswer?.team ?? match.activeTeam);
    const perspectiveTeam = viewingTeam === null && hasTurn ? match.activeTeam : ownTeam;
    const teamOrder = match.teams.map((_, turn) => fruitOf(match.teamForTurn(turn)));
    const playedTurns = match.turnHistory.length;
    const totalTurns = match.teams.length * MAX_ROUNDS;
    const progressLabel = result ? "Результат хода." : hasTurn
      ? `Круг ${Math.floor(match.turnIndex / match.teams.length) + 1} из ${MAX_ROUNDS}. ${playing ? "Отвечают" : "Готовятся"} — ${match.teams[activeTeam].name}.`
      : "Вопрос завершён.";
    const displayedScore = (index: number) =>
      match.teams[index].score - (resolving?.team === index ? resolving.points : 0);
    return `<aside class="survey-sidebar" aria-label="Команды">
      <div class="survey-team-list">
        ${match.teams.map((team, teamIndex) => {
          const own = teamIndex === perspectiveTeam;
          const open = expandedTeam === teamIndex;
          const current = teamIndex === activeTeam;
          const interactive = !liveMatch() && own && current && (playing || waitingForTeam());
          const score = displayedScore(teamIndex);
          return `<section data-award-team="${teamIndex}" class="survey-team-section survey-team-${fruitOf(teamIndex)}${own ? " is-own" : ""}${current ? " is-current" : ""}${open ? " is-expanded" : ""}">
            <button class="survey-team-toggle" data-expand-team="${teamIndex}" aria-expanded="${open}" aria-controls="survey-roster-${teamIndex}">
              <span>${own ? '<span class="survey-team-label">Моя команда</span>' : ""}
                <span class="survey-team-name">${renderFruit(fruitOf(teamIndex))}<span>${escape(team.name)}</span></span>
                ${playing && current ? '<small class="survey-responding">Отвечают</small>' : ""}
              </span>
              <strong class="survey-rival-score" data-score-team="${teamIndex}" aria-label="Очки команды: ${score}">${score}</strong>
            </button>
            <ol class="survey-roster" id="survey-roster-${teamIndex}" aria-label="Состав команды «${escape(team.name)}»" ${open ? "" : "hidden"}>
          ${team.players.map((name, index) => {
            const selected = own && player === index;
            const member = `<span class="survey-member-avatar" aria-hidden="true">${index + 1}</span>
              <span class="survey-member-name">${escape(name)}${selected ? '<small class="survey-member-you"> (вы)</small>' : ""}</span>
              ${current && readyPlayer(index) ? '<small class="survey-member-status is-ready" aria-label="Готов">✓</small>'
                : current && playing && match.votes.has(index) ? '<small class="survey-member-status" aria-label="Голос отдан">✓</small>' : ""}`;
            return interactive
              ? `<li><button class="survey-member" data-player="${index}" aria-pressed="${selected}">${member}</button></li>`
              : `<li><div class="survey-member${selected ? " is-selected" : ""}">${member}</div></li>`;
          }).join("")}
        </ol>
        </section>`;
        }).join("")}
      </div>
      ${!isBallot() && !changingQuestion ? `<div class="survey-turn-progress" role="group" aria-label="${progressLabel} Сыграно ${playedTurns} из ${totalTurns} возможных ходов.">
        ${renderTurnSpiral(teamOrder, MAX_ROUNDS, playedTurns, hasTurn, match.turnHistory, resolving ? playedTurns - 1 : undefined)}
      </div>` : ""}
    </aside>`;
  }

  function questionProgress(match: SurveyDisplay) {
    return `<div class="survey-question-progress" role="img" aria-label="Вопрос ${match.questionIndex + 1} из ${match.questionLimit}">
      ${Array.from({length: match.questionLimit}, (_, index) => `<span class="survey-question-node${index < match.questionIndex ? " is-past" : index === match.questionIndex ? " is-current" : ""}" aria-hidden="true"></span>`).join("")}
    </div>`;
  }

  function questionPicker(match: SurveyGame, ballot: QuestionBallot) {
    const remaining = ballot.remaining(performance.now());
    return `<section class="survey-question-ballot" aria-labelledby="survey-ballot-title">
      <div class="survey-question">${questionProgress(match)}<h1 id="survey-ballot-title" tabindex="-1">На какой вопрос будем отвечать?</h1></div>
      <div class="survey-ballot-status">
        <span role="status">Проголосовали ${ballot.votes.size}/${playerCount}</span>
        ${remaining > 0 && remaining <= QUESTION_BALLOT_CLOCK_MS ? ballotClock(remaining) : ""}
      </div>
      <div class="survey-ballot-choices">
        ${ballot.candidateIds.map((id) => `<button class="survey-question-option" data-question-id="${id}" aria-pressed="${ballot.votes.get(questionVoter) === id}">
          <span class="survey-question-option-text">${escape(demoQuestions[id].prompt)}</span>
          <span class="survey-question-votes" aria-label="Голосов: ${ballot.count(id)}">${ballot.count(id)}</span>
        </button>`).join("")}
      </div>
      <label class="survey-ballot-voter">${isDemo ? "Кто голосует в демо" : "Кто голосует"}
        <select id="survey-question-voter">
          ${match.teams.flatMap((team) => team.players.map((name) => ({name, team: team.name})))
            .map(({name, team}, index) => `<option value="${index}" ${index === questionVoter ? "selected" : ""}>${escape(name)} · ${escape(team)}${ballot.votes.has(index) ? " ✓" : ""}</option>`).join("")}
        </select>
      </label>
    </section>`;
  }

  function onlineQuestionPicker(match: SurveyDisplay) {
    const ballot = liveMatch()?.ballot;
    if (!ballot) return "";
    const remaining = timeLeft();
    const votes = ballot.choices.reduce((count, choice) => count + choice.votes, 0);
    const members = match.teams.reduce((count, team) => count + team.players.length, 0);
    return `<section class="survey-question-ballot" aria-labelledby="survey-ballot-title">
      <div class="survey-question">${questionProgress(match)}<h1 id="survey-ballot-title" tabindex="-1">На какой вопрос будем отвечать?</h1></div>
      <div class="survey-ballot-status">
        <span role="status">Проголосовали ${votes}/${members}</span>
        ${remaining <= QUESTION_BALLOT_CLOCK_MS ? ballotClock(remaining) : ""}
      </div>
      <div class="survey-ballot-choices">
        ${ballot.choices.map(({ id, prompt, votes }) => `<button class="survey-question-option" data-question-id="${id}" aria-pressed="${ballot.selected === id}" ${lobby.connected && viewingTeam !== null && viewingTeam >= 0 && remaining > 0 ? "" : "disabled"}>
          <span class="survey-question-option-text">${escape(prompt)}</span>
          <span class="survey-question-votes" aria-label="Голосов: ${votes}">${votes}</span>
        </button>`).join("")}
      </div>
    </section>`;
  }

  function ballotClock(remaining: number) {
    const seconds = Math.ceil(remaining / 1000);
    return `<time class="survey-ballot-clock" datetime="PT${seconds}S" aria-label="До закрытия голосования">${seconds} с</time>`;
  }

  function revealedTile(match: SurveyDisplay, index: number, team: number | undefined) {
    const answer = match.question.answers[index];
    if (!answer) return "";
    return `<span class="survey-revealed-content">
      <span class="survey-answer">${escape(answer.label)}</span>
      <span class="survey-points" aria-label="${team === undefined ? "Не начислено" : "Очки"}: ${answer.points}">${answer.points}</span>
    </span>`;
  }

  function board(match: SurveyDisplay) {
    const revealed = match.phase === "reveal" && !resolving;
    return `<section class="survey-board" aria-label="Табло ответов">
      <ol>${match.question.answers.map((_, index) => {
        const team = match.opened.get(index);
        if ((team === undefined && !revealed) || resolving?.answerIndex === index) {
          return `<li data-answer-index="${index}" class="hidden-answer" aria-label="Ответ ${index + 1} скрыт"><span class="survey-rank">${index + 1}</span></li>`;
        }
        const content = revealedTile(match, index, team);
        if (team !== undefined) {
          return `<li data-answer-index="${index}" class="found survey-team-${fruitOf(team)}">${content}</li>`;
        }
        return `<li data-answer-index="${index}" class="unclaimed${canAdvance() ? " is-awardable" : ""}">
          ${canAdvance() ? `<button type="button" class="survey-award-card" draggable="true" data-award-card="${index}"
            aria-label="Засчитать ответ «${escape(match.question.answers[index]!.label)}»">${content}</button>` : content}
        </li>`;
      }).join("")}</ol>
    </section>`;
  }

  function turnPanel(match: SurveyDisplay) {
    const result = resolving ?? liveMatch()?.resolution;
    if (result) {
      const verdict = {hit: "Верно!", miss: "Мимо!", repeat: "Уже открыто", pass: "Ход пропущен"}[result.kind];
      return `<section class="survey-panel" aria-label="Результат хода">
        <div class="survey-resolution survey-team-${fruitOf(result.team)}" role="status">
          <p class="survey-verdict ${result.kind}">${verdict}</p>
          ${result.text ? `<strong class="survey-resolved-answer">${escape(result.text)}</strong>` : ""}
        </div>
      </section>`;
    }
    if (match.phase === "reveal") {
      return `<section class="survey-panel survey-recap">
        <h2>Вопрос завершён</h2>
        <p>${match.opened.size === match.question.answers.length ? "Все ответы засчитаны."
          : canAdvance() ? "Перетащите незачтённый ответ на команду или нажмите на карточку."
          : "Незачтённые ответы открыты."}</p>
        ${canAdvance() ? `<button class="survey-button primary-action" data-survey="next-question">${match.questionIndex + 1 === match.questionLimit ? "Показать итоги" : "Выбрать следующий вопрос"}</button>` : '<p class="survey-muted">Ждём ведущего.</p>'}
      </section>`;
    }
    const team = match.teams[match.activeTeam];
    const ownTurn = canAct(match);
    if (waitingForTeam()) {
      const confirmed = readyPlayer(player);
      const remaining = readiness?.remaining(performance.now()) ?? timeLeft();
      const readyCount = liveMatch()?.ready.length ?? readiness?.count ?? 0;
      return `<section class="survey-panel survey-team-${fruitOf(match.activeTeam)}${ownTurn ? "" : " is-spectator"}" aria-label="Подготовка команды">
        <div class="survey-ready">
          <div class="survey-ready-copy">
            <h2 tabindex="-1">${escape(team.name)} — ваш ход!</h2>
            <div class="survey-ready-status">
              <p class="survey-ready-count" role="status">Готовы <strong>${readyCount}/${team.players.length}</strong></p>
              ${remaining <= readyClockWindow(match) ? readyClock(remaining) : ""}
            </div>
          </div>
          ${ownTurn ? `<div class="survey-ready-actions">
            <button class="survey-button survey-ready-button" data-survey="ready" aria-pressed="${confirmed}" ${confirmed ? "disabled" : ""}>Готов</button>
            <span class="survey-your-turn">Твой ход</span>
          </div>` : ""}
        </div>
      </section>`;
    }
    const hasProposed = match.hasProposed(player);
    const choosingOnly = liveMatch() ? liveVotingOnly : votingOnly;
    const remaining = timeLeft();
    const visibleWindowMs = visibleTurnClockWindow(match);
    const showClock = remaining <= visibleWindowMs;
    return `<section class="survey-panel survey-team-${fruitOf(match.activeTeam)}${ownTurn ? "" : " is-spectator"}" aria-label="Ход команды">
      <div class="survey-workhead">
        <div class="survey-work-heading">
          <h2 tabindex="-1">${!ownTurn ? `Отвечают «${escape(team.name)}»` : choosingOnly ? "Время голосовать" : "Предложите ответ"}</h2>
        </div>
        ${showClock ? timer(remaining, visibleWindowMs, ownTurn ? "Ваш ход" : "До конца хода", "Время хода") : ""}
      </div>
      ${ownTurn ? `
        ${choosingOnly ? "" : hasProposed ? `<p class="survey-muted survey-proposal-status">Твой вариант в списке.</p>` : `
          <form class="survey-form" id="survey-propose">
            <input name="answer" aria-label="Твой вариант ответа" placeholder="Ваш вариант" value="${escape(draft)}" maxlength="80" required autocomplete="off" aria-describedby="survey-error">
            <button class="survey-button primary-action" type="submit">Отправить ответ</button>
          </form>`}
        <p id="survey-error" class="survey-error" role="status">${liveMatch() ? "" : escape(proposalError)}</p>
      ` : ""}
      <div class="survey-step"><h3>${ownTurn ? "Выберите ответ команды" : "Варианты ответа команды"}</h3><small>Голосов: ${match.votes.size}/${team.players.length}</small></div>
      <div class="survey-proposals">${proposalCards(match, showClock)}</div>
      ${ownTurn && !liveMatch() && isDemo && !votingOnly ? `
        <div class="survey-turn-actions">
          <button class="survey-button secondary-action" data-survey="suggest">Примеры от команды</button>
        </div>` : ""}
    </section>`;
  }

  function proposalCards(match: SurveyDisplay, timerVisible: boolean) {
    const ownTurn = canAct(match);
    if (!match.proposals.length) return `<p class="survey-muted">${ownTurn ? "Здесь появятся варианты вашей команды." : "Команда пока не предложила ни одного ответа."}</p>`;
    const selected = match.votes.get(player);
    const candidate = ownTurn ? match.confirmationCandidate(timerVisible) : undefined;
    const team = match.teams[match.activeTeam];
    return match.proposals.map((proposal) => {
      const voters = Array.from(match.votes).filter(([, id]) => id === proposal.id)
        .map(([index]) => team.players[index]);
      const marked = ownTurn && selected === proposal.id;
      const card = `
          ${ownTurn ? `<span class="survey-choice-mark" aria-hidden="true">${marked ? "✓" : ""}</span>` : ""}
          <span>${escape(proposal.text)}</span>
          <span class="survey-votes" aria-label="Голосов: ${voters.length}">${voters.length}</span>`;
      return `<div class="survey-proposal-option">
        ${ownTurn
          ? `<button class="survey-proposal" data-proposal-id="${proposal.id}" data-vote="${proposal.id}" aria-pressed="${marked}">${card}</button>`
          : `<div class="survey-proposal is-readonly" data-proposal-id="${proposal.id}">${card}</div>`}
        ${candidate?.id === proposal.id ? `<button class="survey-button survey-confirm-button" data-confirm-proposal="${proposal.id}"
          aria-label="Подтвердить выбор: ${escape(proposal.text)}" aria-description="Удерживайте две секунды">
          <span class="survey-confirm-label">Подтвердить выбор</span>
        </button>` : ""}
        ${voters.length && !ownTurn ? `<ul class="survey-proposal-voters" aria-label="Проголосовали за этот ответ">
          ${voters.map((name) => `<li class="survey-proposal-voter">${escape(name)}</li>`).join("")}
        </ul>` : ""}
      </div>`;
    }).join("");
  }

  function readyClock(remaining: number) {
    const seconds = Math.ceil(remaining / 1000);
    return `<time class="survey-ready-clock" id="survey-clock" datetime="PT${seconds}S" aria-label="До начала хода">${seconds} с</time>`;
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
      <section class="survey-intro" aria-labelledby="survey-title">
        <h1 id="survey-title"><img src="${surveyTitlePatch}" alt="Сто к одному" width="755" height="134"></h1>
        <p class="survey-player-range">${MIN_SURVEY_PLAYERS}–${MAX_SURVEY_PLAYERS} игроков</p>
        <p class="survey-team-limit">До 3 команд, до 5 в каждой</p>
        <p class="survey-lead">Угадайте ответы на табло и заработайте очки.</p>
        <div class="survey-start">
          <button class="survey-button primary-action" data-survey="setup" type="button">Играть</button>
          <button class="survey-button secondary-action" data-survey="demo" type="button">Демо</button>
        </div>
      </section>
      <img class="survey-illustration" src="${beachPatch}" width="773" height="716"
        alt="На вопрос «Что берут на пляж?» игрок отвечает «Крем». Третья карточка открывается и приносит его команде 18 очков.">
    </main>`;
  }

  function results(match: SurveyDisplay) {
    const standings = [...match.teams].sort((a, b) => b.score - a.score);
    const winners = standings.filter((team) => team.score === standings[0].score);
    return `<main class="survey-wrap survey-results">
      <p class="survey-kicker">Три вопроса сыграны</p>
      <h1>${winners.length > 1 ? "Ничья" : `Победили <em>${winners[0].name.toLowerCase()}</em>`}</h1>
      ${winners.length > 1 ? `<p>${winners.map((team) => team.name).join(" · ")} набрали по ${winners[0].score} очков.</p>` : ""}
      <ol>${standings.map((team) => {
        const index = match.teams.indexOf(team);
        return `<li class="survey-team-${fruitOf(index)}"><span>${renderFruit(fruitOf(index))}${team.name}</span><strong>${team.score}</strong></li>`;
      }).join("")}</ol>
      ${canAdvance() ? '<button class="survey-button primary-action" data-survey="reset">Сыграть ещё</button>' : '<p class="survey-muted">Ждём ведущего.</p>'}
    </main>`;
  }

  function render() {
    cancelHold();
    syncAnswerAward();
    const room = lobby.view;
    const live = room?.match;
    const match = room && live ? displayOnlineMatch(room, live) : game;
    app.classList.add("survey-app");
    app.classList.toggle("is-landing", !match && !room);
    app.innerHTML = `
      <header class="survey-header"><a href="./" class="survey-brand"><img src="${gamesLogo}" width="550" height="204" alt="И.Г.Р.Ы."></a>${match || room ? "<span>Сто к одному</span>" : ""}
        ${!room && isDemo && game && game.phase !== "results" ? `<label class="survey-view-choice">Команда в демо
          <select id="survey-view-team">
            ${game.teams.map((team, index) => `<option value="${index}" ${viewingTeam === index ? "selected" : ""}>${escape(team.name)}</option>`).join("")}
            <option value="auto" ${viewingTeam === null ? "selected" : ""}>Все по очереди</option>
          </select></label>` : ""}<a href="./">Все игры</a></header>
      ${room && match ? lobby.connectionMarkup() : ""}
      ${room && live && viewingTeam === -1 ? '<p class="survey-online-state" role="status">Партия началась, пока вас не было. Можно смотреть и сыграть в следующей партии.</p>' : ""}
      ${!match ? room ? lobby.lobbyMarkup() : setup() : match.phase === "results" ? results(match) : `
        <main class="survey-wrap survey-match">
          ${teamSidebar(match)}
          <div class="survey-main">
            ${live?.phase === "ballot" ? onlineQuestionPicker(match) : game && questionBallot ? questionPicker(game, questionBallot) : `<div class="survey-question">
              ${questionProgress(match)}
              <h1>${escape(match.question.prompt)}</h1>
            </div>
            ${board(match)}
            ${changingQuestion ? "" : turnPanel(match)}`}
          </div>
        </main>`}`;
  }

  function updateOnline() {
    const room = lobby.view;
    const match = room?.match;
    if (!room || !match) {
      cancelOnlineAnimation();
      livePhaseId = undefined;
      lastOnlineView = null;
      render();
      return;
    }

    const changedPhase = livePhaseId !== match.phaseId;
    const previous = lastOnlineView?.code === room.code ? lastOnlineView.match : null;
    livePhaseId = match.phaseId;
    if (lastOnlineView !== room) {
      liveDeadline = match.deadline ? performance.now() + match.deadline - room.serverNow : 0;
      lastOnlineView = room;
    }
    viewingTeam = room.teams.findIndex((team) => team.players.some((member) => member.id === room.you));
    player = room.teams[viewingTeam]?.players.findIndex((member) => member.id === room.you) ?? -1;
    if (match.phase === "resolution" && !changedPhase) return;
    if (changedPhase) {
      cancelOnlineAnimation();
      draft = "";
      expandedTeam = viewingTeam;
    } else if (match.submitted) {
      draft = "";
    }
    updateOnlineClockState(match, room.teamCount);

    const result = match.resolution;
    const duration = Math.min(timeLeft(), SURVEY_RESOLUTION_MS);
    if (match.phase === "resolution" && result && previous?.phase === "turn" &&
        previous.questionIndex === match.questionIndex && previous.turnIndex === match.turnIndex &&
        lobby.connected && !document.hidden && duration >= 240) {
      const source = proposalPosition(previous.proposals, result);
      resolving = result;
      onlineAnimation = new AbortController();
      renderOnlineUpdate();
      void playResolution(displayOnlineMatch(room, match), result, source, duration, onlineAnimation.signal);
      return;
    }
    renderOnlineUpdate(changedPhase);
  }

  function cancelOnlineAnimation() {
    if (!onlineAnimation) return;
    onlineAnimation.abort();
    onlineAnimation = null;
    resolving = null;
  }

  function renderOnlineUpdate(changedPhase = false) {
    const focused = document.activeElement;
    const input = focused instanceof HTMLInputElement && focused.name === "answer" ? focused : null;
    const selection = input ? [input.selectionStart, input.selectionEnd] as const : null;
    const activeButton = focused instanceof HTMLButtonElement ? focused : null;
    const focusAttribute = ["data-question-id", "data-expand-team", "data-vote", "data-confirm-proposal", "data-award-card"]
      .find((attribute) => activeButton?.hasAttribute(attribute));
    render();
    if (changedPhase) {
      const next = app.querySelector<HTMLElement>("#survey-ballot-title, #survey-propose input, .survey-ready-copy h2, .survey-panel h2");
      next?.focus({ preventScroll: true });
    } else if (selection) {
      const next = app.querySelector<HTMLInputElement>("#survey-propose input");
      next?.focus({ preventScroll: true });
      if (next && selection[0] !== null && selection[1] !== null) next.setSelectionRange(selection[0], selection[1]);
    } else if (focusAttribute && activeButton) {
      const same = app.querySelector<HTMLElement>(`[${focusAttribute}="${activeButton.getAttribute(focusAttribute)}"]`);
      const next = same ?? (focusAttribute === "data-award-card"
        ? app.querySelector<HTMLElement>('[data-survey="next-question"]')
        : null);
      next?.focus({ preventScroll: true });
    }
  }

  function updateOnlineClockState(match: SurveyMatchView, teamCount: number) {
    const { phase, questionIndex, turnIndex } = match;
    const turn = getTurnTiming(questionIndex, turnIndex, teamCount);
    const remaining = timeLeft();
    const visible = phase === "ballot" ? remaining <= QUESTION_BALLOT_CLOCK_MS
      : phase === "ready" ? remaining <= READINESS_MS - getReadinessClockAtMs(questionIndex, turnIndex, teamCount)
      : phase === "turn" && remaining <= turn.durationMs - turn.showClockAtMs;
    const voteOnly = phase === "turn" && remaining <= turn.voteOnlyMs;
    const redraw = visible !== liveClockVisible || voteOnly !== liveVotingOnly;
    liveClockVisible = visible;
    liveVotingOnly = voteOnly;
    return redraw;
  }

  function startQuestionBallot() {
    demoDeck ??= new QuestionDeck(demoQuestions.length);
    questionBallot = new QuestionBallot(demoDeck.draw(), playerCount, performance.now());
    questionVoter = 0;
    render();
    app.querySelector<HTMLElement>("#survey-ballot-title")?.focus({preventScroll: true});
  }

  function startMatch(size: number, demo: boolean, teamCount?: number) {
    game = new SurveyGame(demoQuestions, size, Math.random, QUESTIONS_PER_MATCH, teamCount);
    playerCount = size;
    isDemo = demo;
    viewingTeam = demo ? 0 : null;
    expandedTeam = 0;
    startQuestionBallot();
  }

  async function startDemo(button: HTMLButtonElement) {
    button.disabled = true;
    app.querySelector("[data-demo-error]")?.remove();
    try {
      const { classicQuestions, classicDemoExamples } = await import("./classic-questions");
      if (lobby.view || !button.isConnected || app.querySelector("dialog[open]")) return;
      demoQuestions = classicQuestions;
      demoExamples = classicDemoExamples;
      startMatch(DEMO_PLAYER_COUNT, true);
    } catch {
      button.parentElement?.insertAdjacentHTML("afterend",
        '<p class="survey-error" data-demo-error role="status">Не удалось загрузить демо. Попробуйте ещё раз.</p>');
    } finally {
      button.disabled = false;
    }
  }

  async function closeQuestionBallot(now: number) {
    if (!game || !questionBallot || changingQuestion) return;
    const winner = questionBallot.finish(now);
    if (winner === undefined) return;
    const match = game;
    changingQuestion = true;
    try {
      await animateQuestionChoice(app, winner, () => {
        match.selectQuestion(winner);
        questionBallot = null;
        render();
      });
    } finally {
      changingQuestion = false;
      if (viewingTeam === null && expandedTeam !== null) expandedTeam = match.activeTeam;
      prepareTurn();
    }
  }

  function prepareTurn() {
    if (!game || game.phase !== "turn") return;
    if (viewingTeam === null && expandedTeam === game.lastAnswer?.team) expandedTeam = game.activeTeam;
    readiness = new TurnReadiness(game.teams[game.activeTeam].players.length, performance.now(), READINESS_MS);
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
    app.querySelector<HTMLElement>("#survey-propose input, .survey-panel.is-spectator h2")?.focus({preventScroll: true});
  }

  async function finishTurn(confirmedProposalId?: number) {
    if (!game || !deadline || resolving) return;
    const match = game;
    const proposals = [...match.proposals];
    match.finishTurn(confirmedProposalId);
    deadline = 0;
    const result = match.lastAnswer!;
    const source = proposalPosition(proposals, result);
    resolving = result;
    render();
    try {
      await playResolution(match, result, source);
    } finally {
      resolving = null;
      if (match.phase === "turn") prepareTurn();
      else {
        render();
        focusNext();
      }
    }
  }

  function proposalPosition(proposals: SurveyDisplay["proposals"], result: TurnResult) {
    const choice = proposals.find(({ text }) => text === result.text);
    return choice ? app.querySelector(`[data-proposal-id="${choice.id}"]`)?.getBoundingClientRect() ?? null : null;
  }

  function playResolution(match: SurveyDisplay, result: TurnResult, source: DOMRect | null,
    duration = SURVEY_RESOLUTION_MS, signal?: AbortSignal,
  ) {
    const tile = result.answerIndex === undefined ? null
      : app.querySelector<HTMLElement>(`[data-answer-index="${result.answerIndex}"]`);
    const score = app.querySelector<HTMLElement>(`[data-score-team="${result.team}"]`);
    const turn = match.turnHistory.length - 1;
    return animateTurnResult(result, {
      root: app,
      source,
      tile,
      score,
      checkpoint: app.querySelector(`[data-spiral-turn="${turn}"]`),
      fruit: fruitOf(result.team),
      reveal: () => {
        if (!tile || result.answerIndex === undefined) return;
        tile.classList.remove("hidden-answer");
        tile.classList.add("found", `survey-team-${fruitOf(result.team)}`);
        tile.removeAttribute("aria-label");
        tile.innerHTML = revealedTile(match, result.answerIndex, result.team);
      },
      award: () => {
        if (!score) return;
        const total = match.teams[result.team].score;
        score.textContent = String(total);
        score.setAttribute("aria-label", `Очки команды: ${total}`);
      },
      markTurn: () => app.querySelectorAll<HTMLElement | SVGElement>(`[data-spiral-history="${turn}"]`)
        .forEach((element) => { element.style.visibility = ""; }),
    }, duration, signal);
  }

  function focusNext() {
    const next = app.querySelector<HTMLElement>(".survey-panel [data-survey], .survey-panel.is-spectator h2");
    next?.focus({preventScroll: true});
  }

  function refreshTimer() {
    const room = lobby.view;
    const live = room?.match;
    if (room && live) {
      if (live.phase === "resolution") return;
      if (updateOnlineClockState(live, room.teamCount)) {
        renderOnlineUpdate();
      } else if (live.phase === "ballot" && liveClockVisible) {
        const clock = app.querySelector<HTMLTimeElement>(".survey-ballot-clock");
        const seconds = Math.ceil(timeLeft() / 1000);
        if (clock && clock.textContent !== `${seconds} с`) {
          clock.textContent = `${seconds} с`;
          clock.dateTime = `PT${seconds}S`;
        }
      } else if (liveClockVisible) {
        updateClock(timeLeft());
      }
      return;
    }
    if (!game) return;
    if (changingQuestion) return;
    if (questionBallot) {
      const now = performance.now();
      if (questionBallot.shouldFinish(now)) {
        void closeQuestionBallot(now);
      } else {
        const remaining = questionBallot.remaining(now);
        if (remaining > QUESTION_BALLOT_CLOCK_MS) return;
        const clock = app.querySelector<HTMLTimeElement>(".survey-ballot-clock");
        if (!clock) app.querySelector(".survey-ballot-status")?.insertAdjacentHTML("beforeend", ballotClock(remaining));
        else {
          const seconds = Math.ceil(remaining / 1000);
          if (clock.textContent !== `${seconds} с`) {
            clock.textContent = `${seconds} с`;
            clock.dateTime = `PT${seconds}S`;
          }
        }
      }
      return;
    }
    if (readiness) {
      const now = performance.now();
      if (readiness.shouldStart(now)) {
        beginTurn();
        return;
      }
      const remaining = readiness.remaining(now);
      if (remaining <= readyClockWindow(game)) {
        if (app.querySelector("#survey-clock")) updateClock(remaining);
        else app.querySelector(".survey-ready-status")?.insertAdjacentHTML("beforeend", readyClock(remaining));
      }
      return;
    }
    if (!deadline) return;
    const remaining = timeLeft();
    if (!remaining) {
      void finishTurn();
      return;
    }
    const timing = turnTiming(game);
    if (!votingOnly && remaining <= timing.voteOnlyMs) {
      const focused = document.activeElement;
      votingOnly = true;
      if (canAct(game)) {
        const moveFocus = focused?.closest("#survey-propose, [data-survey='suggest']");
        const title = app.querySelector(".survey-work-heading h2");
        if (title) title.textContent = "Время голосовать";
        app.querySelectorAll("#survey-propose, #survey-error, .survey-proposal-status, .survey-turn-actions")
          .forEach((element) => element.remove());
        if (moveFocus) app.querySelector<HTMLButtonElement>(".survey-proposal")?.focus({preventScroll: true});
      }
    }
    const visibleWindowMs = visibleTurnClockWindow(game);
    if (remaining > visibleWindowMs) return;
    if (app.querySelector("#survey-clock")) {
      updateClock(remaining);
      return;
    }
    const ownTurn = canAct(game);
    app.querySelector(".survey-workhead")?.insertAdjacentHTML(
      "beforeend", timer(remaining, visibleWindowMs, ownTurn ? "Ваш ход" : "До конца хода", "Время хода"),
    );
    const ballot = app.querySelector(".survey-proposals");
    if (ownTurn && ballot && game.votes.size < game.teams[game.activeTeam].players.length) {
      const focused = document.activeElement;
      const vote = focused instanceof HTMLButtonElement ? focused.dataset.vote : undefined;
      ballot.innerHTML = proposalCards(game, true);
      if (vote !== undefined) ballot.querySelector<HTMLButtonElement>(`[data-vote="${vote}"]`)?.focus({preventScroll: true});
    }
  }

  function updateClock(remaining: number) {
    const clock = app.querySelector<HTMLTimeElement>("#survey-clock");
    const seconds = Math.ceil(remaining / 1000);
    const time = clock?.classList.contains("survey-ready-clock") ? `${seconds} с` : clockText(remaining);
    if (clock && clock.textContent !== time) {
      clock.textContent = time;
      clock.dateTime = `PT${seconds}S`;
    }
    const track = app.querySelector<HTMLProgressElement>(".survey-clock-track");
    if (track) track.value = remaining;
  }

  function addExamples(match: SurveyGame) {
    const examples = demoExamples[match.questionId] ?? match.question.answers.map(({ label }) => label);
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
    if (!(event.target instanceof HTMLSelectElement)) return;
    if (!game || changingQuestion || resolving) return;
    if (event.target.id === "survey-question-voter" && questionBallot) {
      questionVoter = Number(event.target.value);
      render();
      app.querySelector<HTMLSelectElement>("#survey-question-voter")?.focus({preventScroll: true});
    }
    if (event.target.id === "survey-view-team") {
      viewingTeam = event.target.value === "auto" ? null : Number(event.target.value);
      expandedTeam = viewingTeam ?? game.activeTeam;
      player = 0;
      draft = "";
      proposalError = "";
      render();
      app.querySelector<HTMLSelectElement>("#survey-view-team")?.focus({preventScroll: true});
    }
  });
  app.addEventListener("submit", (event) => {
    if (!(event.target instanceof HTMLFormElement)) return;
    if (event.target.id !== "survey-propose") return;
    event.preventDefault();
    const live = liveMatch();
    if (live) {
      const answer = draft.trim();
      if (answer && live.phase === "turn" && !liveVotingOnly) {
        lobby.send({ type: "propose", phaseId: live.phaseId, text: answer });
      }
      return;
    }
    if (!game || questionBallot || changingQuestion || !canAct(game) || timeLeft() <= turnTiming(game).voteOnlyMs) { refreshTimer(); return; }
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
    const live = liveMatch();
    if (live) {
      if (live.phase === "resolution") return;
      const phaseId = live.phaseId;
      if (button.dataset.expandTeam !== undefined) {
        const team = Number(button.dataset.expandTeam);
        expandedTeam = expandedTeam === team ? null : team;
        renderOnlineUpdate();
      } else if (live.phase === "ballot" && button.dataset.questionId !== undefined) {
        lobby.send({ type: "question", phaseId, id: Number(button.dataset.questionId) });
      } else if (live.phase === "ready" && action === "ready") {
        lobby.send({ type: "ready", phaseId });
      } else if (live.phase === "turn" && button.dataset.vote !== undefined) {
        lobby.send({ type: "vote", phaseId, id: Number(button.dataset.vote) });
      } else if (live.phase === "reveal" && action === "next-question") {
        lobby.send({ type: "next", phaseId });
      } else if (live.phase === "results" && action === "reset") {
        lobby.send({ type: "replay", phaseId });
      }
      return;
    }
    if (!game) {
      if (lobby.view) return;
      if (action === "setup") lobby.open();
      if (action === "demo") void startDemo(button);
      return;
    }
    if (resolving || changingQuestion) return;
    if (button.dataset.expandTeam !== undefined) {
      const team = Number(button.dataset.expandTeam);
      expandedTeam = expandedTeam === team ? null : team;
      render();
      app.querySelector<HTMLButtonElement>(`[data-expand-team="${team}"]`)?.focus({preventScroll: true});
      return;
    }
    if (questionBallot) {
      if (button.dataset.questionId === undefined) return;
      const id = Number(button.dataset.questionId);
      const now = performance.now();
      questionBallot.choose(questionVoter, id, now);
      render();
      if (questionBallot.shouldFinish(now)) void closeQuestionBallot(now);
      else app.querySelector<HTMLButtonElement>(`[data-question-id="${id}"]`)?.focus({preventScroll: true});
      return;
    }
    if (readiness?.shouldStart(performance.now())) { beginTurn(); return; }
    if (deadline && !timeLeft()) { void finishTurn(); return; }
    if (action === "ready" && readiness && canAct(game)) {
      if (readiness.confirm(player, performance.now())) beginTurn();
      else {
        render();
        app.querySelector<HTMLButtonElement>(`[data-player="${player}"]`)?.focus({preventScroll: true});
      }
      return;
    }
    if (action === "suggest" && isDemo && canAct(game) && timeLeft() > turnTiming(game).voteOnlyMs) addExamples(game);
    if (action === "next-question") {
      game.nextQuestion();
      if (game.phase === "turn") startQuestionBallot();
      else {
        render();
        focusNext();
      }
      return;
    }
    if (action === "reset") {
      game = null;
      questionBallot = null;
      viewingTeam = 0;
      player = 0;
      render();
      app.querySelector<HTMLButtonElement>("[data-survey='setup']")?.focus();
      return;
    }
    if (!canAct(game)) return;
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
  void lobby.restore();
}
