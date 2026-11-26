import "./online-lobby.css";
import type { Client, Room } from "colyseus.js";
import {
  SURVEY_CODE, SURVEY_ROOM, SURVEY_TEAM_COUNTS, SURVEY_MIN_TEAM_SIZE, SURVEY_MAX_TEAM_SIZE,
  type SurveyOnlineAction, type SurveyRoomView,
} from "../../shared/survey-online";
import { renderFruit } from "./fruit-icons";

const SESSION_KEY = "party-games.survey.connection";
const NAME_KEY = "party-games.survey.name";
const CONNECT_TIMEOUT = 12_000;
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
  let mode: "create" | "join" = "create";

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
    dialog.innerHTML = `
      <form class="survey-start-form" id="survey-online-form">
        <h2 id="survey-online-title">Играть с друзьями</h2>
        <div class="survey-online-modes" role="group" aria-label="Вход в комнату">
          <button class="survey-button secondary-action" type="button" data-room-action="create">Новая комната</button>
          <button class="survey-button secondary-action" type="button" data-room-action="join">Войти по коду</button>
        </div>
        <label>Ваше имя <input name="name" maxlength="24" required autocomplete="nickname"
          value="${escape(readSession(NAME_KEY) ?? "")}" autofocus></label>
        <label data-room-fields="join">Код комнаты <input name="code" maxlength="7" autocapitalize="characters" spellcheck="false"
          pattern="[sS][0-9A-Fa-f]{6}" title="Семь символов, начиная с S" autocomplete="off" required
          value="${escape(prefill?.slice(0, 7) ?? "")}" placeholder="S123ABC"></label>
        <p class="survey-online-error" data-room-error role="status" hidden></p>
        <div class="survey-dialog-actions">
          <button class="survey-button secondary-action" type="button" data-room-action="close">Назад</button>
          <button class="survey-button primary-action" type="submit"></button>
        </div>
      </form>`;
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
      removeDialog();
      redrawRoom();
    });
    socket.onMessage<string>("rejected", (message) => {
      if (room !== socket) return;
      error = message;
      redrawRoom();
    });
    socket.onLeave(() => {
      if (room !== socket) return;
      room = null;
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
      if (view) onUpdate();
    }, CONNECT_TIMEOUT);
    socket.send("sync");
  }

  async function connect(action: (client: Client) => Promise<Room>, recovering = false) {
    if (pending || room) return;
    const currentAttempt = ++attempt;
    pending = true;
    error = "";
    updateDialog();
    if (view) onUpdate();
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
      if (view) onUpdate();
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

  function leave() {
    ++attempt;
    dropRoom();
    save(null);
    view = null;
    pending = false;
    error = "";
    notice = "";
    onUpdate();
    app.querySelector<HTMLButtonElement>("[data-survey='setup']")?.focus();
  }

  function send(action: SurveyOnlineAction) {
    if (!room?.connection.isOpen || pending) return;
    const previousError = error;
    error = "";
    room.send("action", action);
    if (previousError) onUpdate();
  }

  function redrawRoom() {
    const focused = document.activeElement;
    const action = focused instanceof HTMLButtonElement ? focused.dataset.roomAction : undefined;
    const team = focused instanceof HTMLButtonElement ? focused.dataset.roomTeam : undefined;
    onUpdate();
    if (!action || document.activeElement !== document.body) return;
    const replacement = [...app.querySelectorAll<HTMLButtonElement>("button[data-room-action]")]
      .find((button) => button.dataset.roomAction === action && button.dataset.roomTeam === team && !button.disabled);
    replacement?.focus({ preventScroll: true });
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
    const roster = teams.map((team, index) => ({
      ...team,
      capacity: team.capacity ?? teamSize,
      fruit: team.fruitIndex ?? index,
      connected: team.players.filter((member) => member.connected).length,
    }));
    const connected = roster.reduce((sum, team) => sum + team.connected, 0);
    const occupied = roster.reduce((sum, team) => sum + team.players.length, 0);
    const seats = roster.reduce((sum, team) => sum + team.capacity, 0);
    const canStart = roster.every((team) => team.connected >= SURVEY_MIN_TEAM_SIZE);
    return `<main class="survey-wrap survey-online-lobby" aria-labelledby="survey-online-lobby-title">
      <header class="survey-online-heading">
        <div><h1 id="survey-online-lobby-title">Комната ожидания</h1><p class="survey-muted" role="status">Подключились ${connected} из ${seats}</p></div>
        <div class="survey-online-invites">
          <label class="survey-online-code">Код комнаты <input aria-label="Код комнаты" value="${escape(code)}" readonly></label>
          <div class="survey-online-copy">
            <button class="survey-button secondary-action" type="button" data-room-action="copy-code">Скопировать код</button>
            <button class="survey-button secondary-action" type="button" data-room-action="copy-link">Скопировать ссылку</button>
          </div>
          <p class="survey-muted" data-room-notice role="status">${escape(notice)}</p>
        </div>
      </header>
      <div class="survey-online-teams">
        ${roster.map(({ name, players, capacity, fruit }) => `<section class="survey-online-team survey-team-${fruit}" aria-label="${escape(name)}">
          <h2>${renderFruit(fruit)}${escape(name)}</h2>
          <ol>${Array.from({ length: capacity }, (_, seat) => {
            const member = players[seat];
            if (!member) return '<li class="survey-online-empty">Свободное место</li>';
            const tag = [member.id === you ? "Вы" : "", member.id === owner ? "Ведущий" : "", member.connected ? "" : "Переподключается"]
              .filter(Boolean).join(" · ");
            return `<li><strong>${escape(member.name)}</strong>${tag ? `<span>${tag}</span>` : ""}</li>`;
          }).join("")}</ol>
          ${isHost ? `<div class="survey-online-slot-actions" aria-label="Места команды «${escape(name)}»" role="group">
            <button class="survey-button secondary-action" type="button" data-room-action="remove-slot" data-room-team="${fruit}"
              aria-label="Убрать место: ${escape(name)}" ${canEdit && capacity > Math.max(SURVEY_MIN_TEAM_SIZE, players.length) ? "" : "disabled"}>− Место</button>
            <button class="survey-button secondary-action" type="button" data-room-action="add-slot" data-room-team="${fruit}"
              aria-label="Добавить место: ${escape(name)}" ${canEdit && capacity < SURVEY_MAX_TEAM_SIZE ? "" : "disabled"}>+ Место</button>
          </div>${roster.length > SURVEY_TEAM_COUNTS[0] ? `<button class="survey-online-remove-team" type="button"
              data-room-action="remove-team" data-room-team="${fruit}" aria-label="Убрать команду: ${escape(name)}"
              ${canEdit && occupied <= seats - capacity ? "" : "disabled"}>Убрать команду</button>` : ""}` : ""}
        </section>`).join("")}
      </div>
      ${isHost && roster.length < SURVEY_TEAM_COUNTS[1] ? `<button class="survey-button secondary-action survey-online-add-team"
        type="button" data-room-action="add-team" ${canEdit ? "" : "disabled"}>Добавить команду</button>` : ""}
      <footer class="survey-online-footer">
        <p class="survey-muted">${canStart ? isHost ? "Можно начинать." : "Ожидаем запуска от ведущего." : "Для старта нужно минимум два игрока в каждой команде."}</p>
        <div class="survey-dialog-actions">
          ${room || pending ? '<button class="survey-button secondary-action" type="button" data-room-action="leave">Выйти из комнаты</button>' : ""}
          ${isHost ? `<button class="survey-button primary-action" type="button" data-room-action="start" ${canStart && room && !pending ? "" : "disabled"}>Начать игру</button>` : ""}
        </div>
      </footer>
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
    switch (button.dataset.roomAction) {
      case "create": case "join":
        mode = button.dataset.roomAction;
        error = "";
        updateDialog();
        break;
      case "close": close(); break;
      case "start": send({ type: "start" }); break;
      case "add-team": send({ type: "add-team" }); break;
      case "remove-team": send({ type: "remove-team", team: Number(button.dataset.roomTeam) }); break;
      case "add-slot": send({ type: "resize-team", team: Number(button.dataset.roomTeam), delta: 1 }); break;
      case "remove-slot": send({ type: "resize-team", team: Number(button.dataset.roomTeam), delta: -1 }); break;
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
    open, restore, send, leave, lobbyMarkup, connectionMarkup,
    get view() { return view; },
    get connected() { return room !== null && !pending; },
    get error() { return error; },
  };
}
