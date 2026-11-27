import { roomForm, roomHeading, roomFooter } from "../rooms/ui";
import "./online-lobby.css";
import type { Client, Room } from "colyseus.js";
import {
  SURVEY_CODE, SURVEY_KICKED_CODE, SURVEY_ROOM, SURVEY_TEAM_COUNTS, SURVEY_MIN_TEAM_SIZE, SURVEY_MAX_TEAM_SIZE,
  canStartSurvey, type SurveyMember, type SurveyOnlineAction, type SurveyPackId, type SurveyResultsInteraction, type SurveyRoomView,
} from "../../shared/survey-online";
import { renderFruit } from "./fruit-icons";

const SESSION_KEY = "party-games.survey.connection";
const NAME_KEY = "party-games.survey.name";
const CONNECT_TIMEOUT = 12_000;
const KICKED_MESSAGE = "Ведущий исключил вас из комнаты.";
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

function serverEndpoint() {
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL as string;
  if (import.meta.env.DEV && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
    return `${location.protocol}//${location.hostname}:2567`;
  }
  return location.origin;
}

function readSession(key: string) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function writeSession(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch { /* The connection remains usable without storage. */ }
}

function connectWithin(pending: Promise<Room>) {
  let timeout: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      void pending.then((room) => room.leave(), () => {}).catch(() => {});
      reject(new Error("Сервер долго не отвечает. Попробуйте ещё раз."));
    }, CONNECT_TIMEOUT);
  });
  return Promise.race([pending, expired]).finally(() => clearTimeout(timeout));
}

function connectionError(error: unknown, missingRoom: boolean, fallback: string) {
  if (error instanceof Error) {
    if (/[а-яё]/i.test(error.message)) return error.message.slice(0, 200);
    if (/locked|full/i.test(error.message)) return "Комната заполнена или партия уже началась.";
  }
  return missingRoom ? "Комната не найдена. Проверьте код." : fallback;
}

type SavedSession = { token: string; code: string; endpoint: string };
type LobbyTeam = {
  name: string;
  players: SurveyMember[];
  seats: (SurveyMember | null)[];
  capacity: number;
  fruit: number;
};

export function createSurveyLobby(app: HTMLElement, onUpdate: () => void) {
  const endpoint = serverEndpoint();
  let room: Room | null = null;
  let view: SurveyRoomView | null = null;
  let pending = false;
  let waitingForView: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let saved: SavedSession | null = null;
  let error = "";
  let notice = "";
  let dialog: HTMLDialogElement | null = null;
  let packDialog: HTMLDialogElement | null = null;
  let mode: "create" | "join" = "create";
  let managedMember: string | null = null;
  let confirmingKick = false;

  function selectMember(id: string | null) {
    managedMember = id;
    confirmingKick = false;
  }

  function save(session: SavedSession | null) {
    saved = session;
    writeSession(SESSION_KEY, session === null ? null : JSON.stringify(session));
  }

  function open(prefill = new URL(location.href).searchParams.get("room")?.toUpperCase()) {
    if (room || dialog?.open) return;
    mode = prefill === undefined ? "create" : "join";
    dialog = document.createElement("dialog");
    dialog.className = "survey-start-dialog survey-online-dialog";
    dialog.id = "survey-online-dialog";
    dialog.setAttribute("aria-labelledby", "survey-online-title");
    dialog.innerHTML = roomForm("S", readSession(NAME_KEY) ?? "", prefill ?? "");
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    app.append(dialog);
    updateDialog();
    dialog.showModal();
  }

  function removeDialog() {
    dialog?.close();
    dialog?.remove();
    dialog = null;
  }

  function availableQuestionPacks() {
    return room?.connection.isOpen && !pending && view && view.you === view.owner && !view.match
      ? view.questionPacks
      : undefined;
  }

  function closePackDialog(restoreFocus: boolean) {
    if (!packDialog) return;
    packDialog.close();
    packDialog.remove();
    packDialog = null;
    if (restoreFocus) {
      app.querySelector<HTMLButtonElement>('[data-room-action="question-packs"]')?.focus({ preventScroll: true });
    }
  }

  function openPackDialog() {
    const packs = availableQuestionPacks();
    const initial = packs?.find(({ id }) => id === view?.questionPack) ?? packs?.[0];
    if (!packs || !initial || packDialog) return;
    let selected = initial;

    const element = document.createElement("dialog");
    element.className = "survey-app survey-start-dialog survey-pack-dialog";
    element.id = "survey-pack-dialog";
    element.setAttribute("aria-labelledby", "survey-pack-title");
    element.innerHTML = `
      <form class="survey-start-form">
        <h2 id="survey-pack-title">Выбрать пак вопросов</h2>
        <div class="survey-online-modes" role="group" aria-label="Наборы вопросов">
          ${packs.map(({ id, name }) => `<button type="button" class="survey-button secondary-action"
            data-pack-id="${escape(id)}">${escape(name)}</button>`).join("")}
        </div>
        <p class="survey-pack-summary"></p>
        <div class="survey-pack-questions" tabindex="0" role="region" aria-label="Вопросы набора"></div>
        <div class="survey-dialog-actions">
          <button type="button" class="survey-button secondary-action" data-pack-cancel>Отмена</button>
          <button type="submit" class="survey-button primary-action">Применить</button>
        </div>
      </form>`;
    const tabs = [...element.querySelectorAll<HTMLButtonElement>("[data-pack-id]")];
    const summary = element.querySelector<HTMLElement>(".survey-pack-summary")!;
    const questions = element.querySelector<HTMLElement>(".survey-pack-questions")!;
    const pluralRules = new Intl.PluralRules("ru");

    function previewPack() {
      for (const tab of tabs) tab.setAttribute("aria-pressed", String(tab.dataset.packId === selected.id));
      const { prompts, categories, scoring } = selected;
      const plural = pluralRules.select(prompts.length);
      const count = `${prompts.length} ${plural === "one" ? "вопрос" : plural === "few" ? "вопроса" : "вопросов"}`;
      summary.textContent = `${count} · ${scoring === "editorial" ? "Подборка с игровыми очками" : "Очки по ответам опроса"}`;
      const list = (items: readonly string[]) => `<ul role="list">${items.map((text) => `<li>${escape(text)}</li>`).join("")}</ul>`;
      if (categories?.length === prompts.length && categories.every(Boolean)) {
        const groups = new Map<string, string[]>();
        categories.forEach((category, index) => {
          const group = groups.get(category);
          if (group) group.push(prompts[index]);
          else groups.set(category, [prompts[index]]);
        });
        questions.innerHTML = [...groups].map(([category, items]) => `<div class="survey-pack-category">
          <h3>${escape(category)}</h3>${list(items)}</div>`).join("");
      } else {
        questions.innerHTML = list(prompts);
      }
      questions.scrollTop = 0;
    }

    for (const tab of tabs) tab.addEventListener("click", () => {
      const next = packs.find(({ id }) => id === tab.dataset.packId);
      if (!next || next === selected) return;
      selected = next;
      previewPack();
    });
    element.querySelector("[data-pack-cancel]")!.addEventListener("click", () => closePackDialog(true));
    element.addEventListener("cancel", (event) => {
      event.preventDefault();
      closePackDialog(true);
    });
    element.addEventListener("submit", (event) => {
      event.preventDefault();
      const chosen = availableQuestionPacks()?.find(({ id }) => id === selected.id);
      closePackDialog(true);
      if (chosen && chosen.id !== view?.questionPack) send({ type: "select-pack", packId: chosen.id });
    });

    packDialog = element;
    previewPack();
    document.body.append(element);
    element.showModal();
    tabs.find((tab) => tab.dataset.packId === selected.id)?.focus({ preventScroll: true });
  }

  function close() {
    removeDialog();
    ++attempt;
    pending = false;
    dropRoom();
    error = "";
    app.querySelector<HTMLButtonElement>("[data-survey='setup']")?.focus();
  }

  function updateDialog() {
    if (!dialog) return;
    const form = dialog.querySelector("form")!;
    form.setAttribute("aria-busy", String(pending));
    for (const button of form.querySelectorAll<HTMLButtonElement>("[data-room-action='create'], [data-room-action='join']")) {
      button.setAttribute("aria-pressed", String(button.dataset.roomAction === mode));
      button.disabled = pending;
    }
    for (const group of form.querySelectorAll<HTMLElement>("[data-room-fields]")) {
      group.hidden = group.dataset.roomFields !== mode;
      for (const field of group.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")) {
        field.disabled = pending || group.hidden;
      }
    }
    (form.elements.namedItem("name") as HTMLInputElement).disabled = pending;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submit.textContent = pending ? "Подключаемся…" : mode === "create" ? "Создать комнату" : "Присоединиться";
    submit.disabled = pending;
    const feedback = form.querySelector<HTMLElement>("[data-room-error]")!;
    feedback.textContent = error;
    feedback.hidden = !error;
  }

  function dropRoom() {
    closePackDialog(false);
    const active = room;
    room = null;
    clearTimeout(waitingForView);
    if (active) void active.leave().catch(() => {});
  }

  function finishConnection(socket: Room, currentAttempt: number) {
    if (currentAttempt !== attempt) {
      void socket.leave().catch(() => {});
      return;
    }
    room = socket;
    socket.onMessage<SurveyRoomView>("view", (next) => {
      if (room !== socket) return;
      clearTimeout(waitingForView);
      if (pending) {
        pending = false;
        error = "";
        save({ token: socket.reconnectionToken, code: next.code, endpoint });
        const url = new URL(location.href);
        if (url.searchParams.has("room")) {
          url.searchParams.delete("room");
          history.replaceState(history.state, "", url);
        }
      }
      view = next;
      const members = next.teams.flatMap(({ players }) => players).concat(next.unassigned ?? []);
      if (next.match || next.you !== next.owner || !members.some(({ id }) => id === managedMember)) {
        selectMember(null);
      }
      removeDialog();
      redrawRoom();
    });
    socket.onMessage<string>("rejected", (message) => {
      if (room !== socket) return;
      error = message;
      redrawRoom();
    });
    socket.onMessage<string>("kicked", (message) => {
      if (room === socket) leave(message || KICKED_MESSAGE);
    });
    socket.onLeave((code) => {
      if (room !== socket) return;
      room = null;
      if (code === SURVEY_KICKED_CODE) {
        leave(KICKED_MESSAGE);
        return;
      }
      clearTimeout(waitingForView);
      pending = false;
      error = "Связь с комнатой прервалась.";
      if (saved) void reconnect();
      else updateDialog();
    });
    waitingForView = setTimeout(() => {
      if (room !== socket || currentAttempt !== attempt) return;
      dropRoom();
      pending = false;
      error = "Комната не ответила. Попробуйте подключиться ещё раз.";
      updateDialog();
      if (view) redrawRoom();
    }, CONNECT_TIMEOUT);
    socket.send("sync");
  }

  async function connect(action: (client: Client) => Promise<Room>, recovering = false) {
    if (pending || room) return;
    const currentAttempt = ++attempt;
    pending = true;
    error = "";
    updateDialog();
    if (view) redrawRoom();
    let sdk: typeof import("colyseus.js") | undefined;
    try {
      sdk = await import("colyseus.js");
      if (currentAttempt !== attempt) return;
      const client = new sdk.Client(endpoint);
      let connection: Room;
      try {
        connection = await connectWithin(action(client));
      } catch (firstError) {
        if (!recovering || !(firstError instanceof sdk.MatchMakeError)) throw firstError;
        // A reload can reach the server just before the previous socket has closed.
        await new Promise((resolve) => setTimeout(resolve, 350));
        if (currentAttempt !== attempt) return;
        connection = await connectWithin(action(client));
      }
      finishConnection(connection, currentAttempt);
    } catch (failure) {
      if (currentAttempt !== attempt) return;
      pending = false;
      const missingRoom = !!sdk && failure instanceof sdk.MatchMakeError && failure.code === sdk.ErrorCode.MATCHMAKE_INVALID_ROOM_ID;
      if (recovering && missingRoom) save(null);
      error = connectionError(failure, missingRoom, recovering
        ? "Не удалось вернуться в комнату. Попробуйте ещё раз."
        : "Не удалось подключиться к игровому серверу. Попробуйте ещё раз.");
      updateDialog();
      if (view) redrawRoom();
    }
  }

  function reconnect() {
    const session = saved;
    if (session) return connect((client) => client.reconnect(session.token), true);
  }

  function restore() {
    const invite = new URL(location.href).searchParams.get("room");
    if (invite !== null) {
      open(invite.toUpperCase());
      return;
    }
    const stored = readSession(SESSION_KEY);
    if (!stored) return;
    try {
      const session = JSON.parse(stored) as SavedSession | null;
      if (session?.endpoint !== endpoint || typeof session.token !== "string" || !SURVEY_CODE.test(session.code)) return;
      saved = session;
      open(session.code);
      void reconnect();
    } catch { save(null); }
  }

  function leave(message = "") {
    ++attempt;
    dropRoom();
    save(null);
    view = null;
    pending = false;
    error = message;
    notice = "";
    selectMember(null);
    onUpdate();
    if (message) open();
    else app.querySelector<HTMLButtonElement>("[data-survey='setup']")?.focus();
  }

  function send(action: SurveyOnlineAction) {
    if (!room?.connection.isOpen || pending) return;
    const previousError = error;
    error = "";
    room.send("action", action);
    if (previousError) redrawRoom();
  }

  function inspectResults(interaction: SurveyResultsInteraction) {
    if (view?.match?.phase === "results" && room?.connection.isOpen && !pending) {
      room.send("results-interaction", interaction);
    }
  }

  function redrawRoom(focusAction?: string, memberId?: string) {
    if (packDialog && !availableQuestionPacks()?.length) closePackDialog(false);
    const focused = document.activeElement;
    const previous = focused instanceof HTMLElement && app.contains(focused) ? focused.dataset : undefined;
    onUpdate();
    if ((!previous?.roomAction && !focusAction) || document.activeElement !== document.body) return;
    const buttons = [...app.querySelectorAll<HTMLButtonElement>("button[data-room-action]:not(:disabled)")];
    const replacement = focusAction
      ? buttons.find(({ dataset }) => dataset.roomAction === focusAction && dataset.roomMember === memberId)
      : previous && buttons.find(({ dataset }) => dataset.roomAction === previous.roomAction
        && dataset.roomTeam === previous.roomTeam && dataset.roomSeat === previous.roomSeat
        && dataset.roomMember === previous.roomMember);
    const related = previous?.roomMember
      ? buttons.find(({ dataset }) => dataset.roomAction === "manage-member" && dataset.roomMember === previous.roomMember)
      : [...app.querySelectorAll<HTMLElement>("[data-room-occupied-seat]")].find(({ dataset }) =>
        dataset.roomTeam === previous?.roomTeam && dataset.roomSeat === previous?.roomSeat);
    const fallback = app.querySelector<HTMLElement>("#survey-online-lobby-title");
    (replacement ?? related ?? fallback)?.focus({ preventScroll: true });
  }

  function connectionMarkup() {
    if (!view) return "";
    return `${pending ? '<p class="survey-online-state" role="status">Восстанавливаем связь…</p>' : ""}
      ${error ? `<p class="survey-online-state survey-online-error" role="status">${escape(error)}</p>` : ""}
      ${!pending && !room ? `<div class="survey-online-state survey-dialog-actions">
        ${saved ? '<button class="survey-button secondary-action" type="button" data-room-action="retry">Восстановить связь</button>' : ""}
        <button class="survey-button secondary-action" type="button" data-room-action="leave">Выйти из комнаты</button>
      </div>` : ""}`;
  }

  function lobbyMarkup() {
    if (!view) return "";
    const { code, teams, teamSize, you, owner } = view;
    const isHost = you === owner;
    const canEdit = !!room && !pending;
    const activePack: SurveyPackId = view.questionPack ?? "classic";
    const unassigned = view.unassigned ?? [];
    const hasSeatSelection = Array.isArray(view.unassigned);
    const canManage = isHost && canEdit && hasSeatSelection;
    const roster: LobbyTeam[] = teams.map(({ name, players, capacity = teamSize, seats, fruitIndex }, index) => ({
      name, capacity, players, fruit: fruitIndex ?? index,
      seats: seats ?? Array.from({ length: capacity }, (_, seat) => players[seat] ?? null),
    }));
    const members = roster.flatMap(({ players }) => players).concat(unassigned);
    const connected = members.filter(({ connected }) => connected).length;
    const occupied = members.length;
    const seats = roster.reduce((sum, team) => sum + team.capacity, 0);
    const canStart = hasSeatSelection
      ? canStartSurvey(roster, unassigned)
      : roster.every(({ players }) => players.filter(({ connected }) => connected).length >= SURVEY_MIN_TEAM_SIZE);
    let startMessage = "Для старта нужно минимум два игрока в каждой команде.";
    if (canStart) startMessage = isHost ? "Можно начинать." : "Ожидаем запуска от ведущего.";
    else if (unassigned.some((member) => member.connected)) startMessage = "Для старта всем нужно выбрать команду.";

    function memberMarkup(member: SurveyMember, currentTeam?: number) {
      const name = escape(member.name);
      const id = escape(member.id);
      const tag = [member.id === you ? "Вы" : "", member.id === owner ? "Ведущий" : "", member.connected ? "" : "Переподключается"]
        .filter(Boolean).join(" · ");
      const label = `<strong>${name}</strong>${tag ? `<span>${tag}</span>` : ""}`;
      if (!canManage || member.id === you) return `<div class="survey-online-member-label">${label}</div>`;

      const selected = managedMember === member.id;
      const trigger = `<button class="survey-online-member-label survey-online-manage" type="button" data-room-action="manage-member"
        data-room-member="${id}" aria-expanded="${selected}" ${selected ? 'aria-controls="survey-online-member-actions"' : ""}>${label}</button>`;
      if (!selected) return trigger;
      const actions = confirmingKick
        ? `<p>Исключить «${name}» из комнаты?</p>
          <button class="survey-button secondary-action" type="button" data-room-action="cancel-kick" data-room-member="${id}">Отмена</button>
          <button class="survey-button survey-online-kick" type="button" data-room-action="kick-member" data-room-member="${id}">Исключить</button>`
        : `${roster.map(({ name: teamName, fruit, seats: teamSeats }) => {
            const seat = teamSeats.indexOf(null);
            return currentTeam === fruit || seat < 0 ? "" : `<button class="survey-button secondary-action survey-team-${fruit}"
              type="button" data-room-action="move-member" data-room-team="${fruit}" data-room-seat="${seat}"
              data-room-member="${id}">${renderFruit(fruit)}В «${escape(teamName)}»</button>`;
          }).join("")}
          <button class="survey-button survey-online-kick" type="button" data-room-action="ask-kick"
            data-room-member="${id}">Исключить из комнаты</button>`;

      return `${trigger}
        <div class="survey-online-member-actions" id="survey-online-member-actions" role="group" aria-label="Действия с игроком ${name}">${actions}</div>`;
    }

    return `<main class="survey-wrap survey-online-lobby" aria-labelledby="survey-online-lobby-title">
${roomHeading(code, connected, seats, notice, `          <div class="survey-online-pack">
            <span class="survey-online-pack-label${activePack === "adult" ? " is-adult" : ""}">Набор <strong>${activePack === "adult" ? "18+" : "Классика"}</strong></span>
            ${isHost && view.questionPacks?.length ? `<button type="button" class="survey-button secondary-action"
              data-room-action="question-packs" aria-haspopup="dialog" ${canEdit ? "" : "disabled"}>Выбрать пак вопросов</button>` : ""}
          </div>
          ${unassigned.length ? `<ul class="survey-online-unassigned" aria-label="Игроки без команды" role="list">
            ${unassigned.map((member) => `<li>${memberMarkup(member)}</li>`).join("")}
          </ul>` : ""}`)}
      ${isHost && hasSeatSelection ? `<div class="survey-online-team-tools">
        <button class="survey-button secondary-action survey-online-shuffle" type="button"
          data-room-action="shuffle-teams" aria-label="Распределить случайно" ${canManage ? "" : "disabled"}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 6h2c6 0 8 12 14 12h2m-4-4 4 4-4 4M3 18h2c6 0 8-12 14-12h2m-4-4 4 4-4 4"/>
          </svg>
          <span class="survey-online-shuffle-hint" aria-hidden="true">Распределить случайно</span>
        </button>
      </div>` : ""}
      <div class="survey-online-teams">
        ${roster.map(({ name, players, capacity, fruit, seats: teamSeats }) => `<section class="survey-online-team survey-team-${fruit}" aria-label="${escape(name)}">
          <h2>${renderFruit(fruit)}${escape(name)}</h2>
          <ol>${teamSeats.map((member, seat) => {
            if (member) return `<li class="survey-online-member" tabindex="-1" data-room-occupied-seat
              data-room-team="${fruit}" data-room-seat="${seat}">${memberMarkup(member, fruit)}</li>`;
            if (!hasSeatSelection) return '<li class="survey-online-empty">Свободное место</li>';
            return `<li class="survey-online-empty has-seat-button"><button class="survey-online-take-seat" type="button"
              data-room-action="take-seat" data-room-team="${fruit}" data-room-seat="${seat}"
              aria-label="Занять место ${seat + 1} в команде «${escape(name)}»" ${canEdit ? "" : "disabled"}>Свободное место</button></li>`;
          }).join("")}</ol>
          ${isHost ? `<div class="survey-online-slot-actions" aria-label="Места команды «${escape(name)}»" role="group">
            <button class="survey-button secondary-action" type="button" data-room-action="remove-slot" data-room-team="${fruit}"
              aria-label="Убрать место: ${escape(name)}" ${canEdit && occupied < seats && capacity > Math.max(SURVEY_MIN_TEAM_SIZE, players.length) ? "" : "disabled"}>− Место</button>
            <button class="survey-button secondary-action" type="button" data-room-action="add-slot" data-room-team="${fruit}"
              aria-label="Добавить место: ${escape(name)}" ${canEdit && capacity < SURVEY_MAX_TEAM_SIZE ? "" : "disabled"}>+ Место</button>
          </div>${roster.length > SURVEY_TEAM_COUNTS[0] ? `<button class="survey-online-remove-team" type="button"
              data-room-action="remove-team" data-room-team="${fruit}" aria-label="Убрать команду: ${escape(name)}"
              ${canEdit && occupied <= seats - capacity ? "" : "disabled"}>Убрать команду</button>` : ""}` : ""}
        </section>`).join("")}
      </div>
      ${isHost && roster.length < SURVEY_TEAM_COUNTS[1] ? `<button class="survey-button secondary-action survey-online-add-team"
        type="button" data-room-action="add-team" ${canEdit ? "" : "disabled"}>Добавить команду</button>` : ""}
${roomFooter(startMessage, isHost, Boolean(canStart && room && !pending), Boolean(room || pending))}
      ${connectionMarkup()}
    </main>`;
  }

  async function copy(kind: "code" | "link") {
    const code = view?.code;
    if (!code) return;
    const link = new URL(location.pathname, location.origin);
    link.searchParams.set("game", SURVEY_ROOM);
    link.searchParams.set("room", code);
    try {
      await navigator.clipboard.writeText(kind === "code" ? code : link.href);
      notice = kind === "code" ? "Код скопирован." : "Ссылка скопирована.";
    } catch {
      const field = app.querySelector<HTMLInputElement>(".survey-online-code input");
      if (field) { field.focus(); field.select(); }
      notice = "Скопируйте выделенный код вручную.";
    }
    const feedback = app.querySelector<HTMLElement>("[data-room-notice]");
    if (feedback) feedback.textContent = notice;
  }

  app.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "survey-online-form") return;
    event.preventDefault();
    if (pending || room) return;
    const fields = new FormData(form);
    const name = String(fields.get("name") ?? "").trim();
    const code = String(fields.get("code") ?? "").trim().toUpperCase();
    if (!name || mode === "join" && !SURVEY_CODE.test(code)) {
      error = !name ? "Введите ваше имя." : "Введите код комнаты из семи символов.";
      updateDialog();
      return;
    }
    writeSession(NAME_KEY, name);
    const creating = mode === "create";
    void connect((client) => creating
      ? client.create(SURVEY_ROOM, { name })
      : client.joinById(code, { name }));
  });

  app.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button[data-room-action]");
    if (!button || button.disabled) return;
    const { roomAction, roomTeam, roomSeat, roomMember } = button.dataset;
    switch (roomAction) {
      case "create": case "join":
        mode = roomAction;
        error = "";
        updateDialog();
        break;
      case "close": close(); break;
      case "question-packs": openPackDialog(); break;
      case "start": send({ type: "start" }); break;
      case "add-team": send({ type: "add-team" }); break;
      case "remove-team": send({ type: "remove-team", team: Number(roomTeam) }); break;
      case "add-slot": send({ type: "resize-team", team: Number(roomTeam), delta: 1 }); break;
      case "remove-slot": send({ type: "resize-team", team: Number(roomTeam), delta: -1 }); break;
      case "take-seat": send({ type: "take-seat", team: Number(roomTeam), seat: Number(roomSeat) }); break;
      case "manage-member":
        if (!roomMember) break;
        selectMember(managedMember === roomMember ? null : roomMember);
        redrawRoom();
        break;
      case "move-member":
        if (!roomMember || managedMember !== roomMember) break;
        selectMember(null);
        send({ type: "move-player", memberId: roomMember, team: Number(roomTeam), seat: Number(roomSeat) });
        break;
      case "ask-kick":
      case "cancel-kick":
        if (!roomMember || managedMember !== roomMember) break;
        confirmingKick = roomAction === "ask-kick";
        redrawRoom(confirmingKick ? "cancel-kick" : "ask-kick", roomMember);
        break;
      case "kick-member":
        if (!roomMember || managedMember !== roomMember || !confirmingKick) break;
        selectMember(null);
        send({ type: "kick-player", memberId: roomMember });
        break;
      case "shuffle-teams":
        selectMember(null);
        send({ type: "shuffle-teams" });
        break;
      case "copy-code": void copy("code"); break;
      case "copy-link": void copy("link"); break;
      case "retry": void reconnect(); break;
      case "leave": leave(); break;
    }
  });

  window.addEventListener("pagehide", () => {
    ++attempt;
    const active = room;
    room = null;
    pending = false;
    clearTimeout(waitingForView);
    active?.connection.close();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && saved && !room) void reconnect();
  });

  return {
    open, restore, send, inspectResults, leave, lobbyMarkup, connectionMarkup,
    get view() { return view; },
    get connected() { return room !== null && !pending; },
    get error() { return error; },
  };
}
