import type { Point, Shot } from "../../shared/hide/shot";
import { Client, type Room } from "colyseus.js";
import { type Snapshot } from "../../shared/hide/world";
import { isHideSetting, settingLimits, validSetting, type HideSettings } from "../../shared/hide/settings";
import type { createScene } from "./scene";
import type { MapId } from "../../shared/hide/maps";
import { loadWorld } from "./load-map";
import { escape } from "../rooms/ui";
import { isMapId, mapNames } from "../../shared/hide/maps";
import brand from "../home-art/logo.webp";
import hidePatch from "../home-art/hide.webp";
import "../base.css";
import "../survey/online-lobby.css";
import "../survey/textile.css";
import "../survey/lobby-textile.css";
import "./hide.css";

const settingLabels: Record<keyof HideSettings, string> = {
  hideSeconds: "До выхода водящих, сек",
  huntSeconds: "Время охоты, сек",
  shotsPerHunter: "Жизней у водящего",
};
const settingFields = (Object.keys(settingLabels) as (keyof HideSettings)[]).map(key =>
  `<label>${settingLabels[key]}<input type="number" required data-setting="${key}" min="1" max="${settingLimits[key]}" step="1"></label>`,
).join("");
const mapOptions = Object.entries(mapNames).map(([id, title]) => `<option value="${id}">${escape(title)}</option>`).join("");

export function mount(app: HTMLElement) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#ede7fb");
  app.innerHTML = `<main class="hide-game survey-app" data-screen="entry">
    <canvas data-world-input></canvas><div class="hide-hud"></div><div class="hide-aim"></div>
    <div class="hide-touch" data-world-input><div class="stick" aria-label="Движение">✥</div>
      <div class="hide-touch-actions"><button class="jump" hidden>Прыжок</button><button class="taunt" hidden>Дразнилка</button><button class="action">Действие</button></div></div>
    <div class="hide-menu">
      <header class="hide-header"><img src="${brand}" width="550" height="204" alt="И.Г.Р.Ы."><a href="/">Все игры</a></header>
      <section class="hide-panel"></section>
    </div><output></output></main>`;
  const root = app.querySelector("main")!,
    panel = root.querySelector("section")!,
    canvas = root.querySelector("canvas")!,
    hud = root.querySelector<HTMLElement>(".hide-hud")!,
    out = root.querySelector("output")!;
  const action = root.querySelector<HTMLButtonElement>(".action")!;
  const jump = root.querySelector<HTMLButtonElement>(".jump")!;
  const taunt = root.querySelector<HTMLButtonElement>(".taunt")!;
  const invited = new URL(location.href).searchParams.get("room")?.trim() ?? "";
  const client = new Client(
    import.meta.env.VITE_SERVER_URL ||
      (import.meta.env.DEV
        ? location.protocol + "//" + location.hostname + ":2567"
        : location.origin),
  );
  let room: Room | undefined,
    view: Snapshot | undefined,
    scene: Awaited<ReturnType<typeof createScene>> | undefined,
    ready = false,
    sceneFailed = false,
    sceneMap: MapId | undefined,
    sceneLoad: AbortController | undefined,
    seenAt = 0,
    stamp = "",
    messageTimer = 0;
  const key = "hide.connection",
    nameKey = "hide.name";
  function notify(s: string) {
    out.textContent = s;
    clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => (out.textContent = ""), 2800);
  }
  function form(error = "") {
    root.dataset.play = "false";
    root.dataset.screen = "entry";
    panel.hidden = false;
    panel.innerHTML = `<h1 class="hide-patch-title"><img src="${hidePatch}" width="375" height="640" alt="Прятки"></h1>
      <form class="hide-entry-sheet survey-online-lobby survey-online-dialog">
        <h2>Играть с друзьями</h2><p class="hide-capacity">2–12 игроков</p>
        <fieldset class="hide-entry">
        <div class="survey-online-modes" role="group" aria-label="Вход в комнату">
          <button class="survey-button secondary-action" type="button" data-mode="create">Новая комната</button>
          <button class="survey-button secondary-action" type="button" data-mode="join">Войти по коду</button>
        </div>
        <label>Ваше имя<input name="name" maxlength="24" required autocomplete="nickname"></label>
        <label>Код комнаты<input name="code" placeholder="H123ABC" required autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
        <button class="survey-button primary-action" type="submit"></button>
      </fieldset><small role="status"></small></form>`;
    const entry = panel.querySelector("form")!;
    const fields = entry.querySelector("fieldset")!;
    const nick = entry.elements.namedItem("name") as HTMLInputElement;
    const code = entry.elements.namedItem("code") as HTMLInputElement;
    const submit = entry.querySelector<HTMLButtonElement>("[type=submit]")!;
    const notice = entry.querySelector("small")!;
    const modes = entry.querySelectorAll<HTMLButtonElement>("[data-mode]");
    let join = Boolean(invited);
    function setMode() {
      for (const b of modes) b.setAttribute("aria-pressed", String((b.dataset.mode === "join") === join));
      code.disabled = !join;
      code.closest("label")!.hidden = !join;
      submit.textContent = join ? "Войти в комнату" : "Создать комнату";
    }
    for (const b of modes) b.onclick = () => {
      join = b.dataset.mode === "join";
      notice.textContent = "";
      setMode();
    };
    nick.value = localStorage.getItem(nameKey) ?? "";
    code.value = invited;
    notice.textContent = error;
    setMode();
    entry.onsubmit = async (e) => {
      e.preventDefault();
      if (fields.disabled) return;
      const name = nick.value.trim();
      if (!name) {
        notice.textContent = "Введите имя.";
        nick.focus();
        return;
      }
      const raw = code.value.trim();
      const roomCode = /^H[0-9A-F]{6}$/i.test(raw) ? raw.toUpperCase() : raw;
      // Existing invitation links used nine-character, case-sensitive Colyseus IDs.
      const legacyInvite = raw === invited && /^[\w-]{9}$/.test(raw);
      if (join && !/^H[0-9A-F]{6}$/.test(roomCode) && !legacyInvite) {
        notice.textContent = "Введите код из семи символов, начиная с латинской H.";
        code.focus();
        return;
      }
      localStorage.setItem(nameKey, name);
      fields.disabled = true;
      notice.textContent = "Подключаемся…";
      try {
        await attach(join ? await client.joinById(roomCode, { name }) : await client.create("hide", { name }));
      } catch {
        fields.disabled = false;
        notice.textContent = join
          ? "Не удалось войти. Проверьте код, подключение и убедитесь, что в комнате ещё есть места и раунд не начался."
          : "Не удалось создать комнату. Проверьте подключение и попробуйте ещё раз.";
      }
    };
  }
  async function attach(r: Room) {
    room = r;
    sessionStorage.setItem(key, r.reconnectionToken);
    const url = new URL(location.href);
    url.searchParams.set("room", r.roomId);
    history.replaceState(null, "", url);
    r.onMessage("taunt", (point: Point) => scene?.cry(point));
    r.onMessage("shot", (shot: Shot) => scene?.shot(shot));
    r.onMessage("feedback", (s: string) => notify(s));
    r.onMessage("view", (v: Snapshot) => {
      view = v;
      seenAt = performance.now();
      const selected = v.mapId ?? "office";
      if (selected !== sceneMap) {
        sceneLoad?.abort();
        sceneLoad = undefined;
        sceneMap = selected;
        scene = undefined;
        ready = sceneFailed = false;
      }
      if (scene) scene.update(v);
      else if (v.phase !== "lobby" && !sceneLoad) void openScene(selected, r);
      render();
    });
    r.onLeave(() => {
      sceneLoad?.abort();
      location.reload();
    });
    r.send("sync");
  }
  async function openScene(mapId: MapId, r: Room) {
    const controller = sceneLoad = new AbortController();
    try {
      const [{ createScene }, world] = await Promise.all([import("./scene"), loadWorld(mapId)]);
      controller.signal.throwIfAborted();
      const loaded = await createScene(
        canvas, r.sessionId,
        batch => r.send("move", batch),
        (aim, seen) => r.send("use", { aim, seen }),
        world, mapId, controller.signal,
      );
      if (controller.signal.aborted) return;
      scene = loaded;
      ready = true;
      if (view) scene.update(view);
    } catch (error) {
      if (controller.signal.aborted) return;
      controller.abort();
      console.error("Не удалось загрузить карту", error);
      sceneFailed = true;
    }
    stamp = "";
    render();
  }
  function render() {
    if (!room || !view) return;
    const v = view,
      me = v.players.find((p) => p.id === room!.sessionId);
    if (!me) return;
    const play =
      ready && (v.phase === "hunt" || (v.phase === "hide" && !me.hunter));
    // Most snapshots only move characters. Update DOM on visible state changes.
    const signature = play
      ? "play:" + me.hunter + ":" + me.alive
      : JSON.stringify([
          ready, sceneFailed, v.phase, v.winner, v.host, v.mapId,
          v.phase === "lobby" && v.settings,
          v.phase === "lobby" && v.players.map((p) => [p.id, p.name, p.hunter, p.online]),
        ]);
    if (stamp === signature) return;
    stamp = signature;
    root.dataset.play = String(play);
    root.dataset.results = String(ready && v.phase === "results");
    root.dataset.screen = v.phase;
    panel.hidden = play;
    action.textContent = me.hunter ? "Выстрел" : "Скопировать";
    action.hidden = !me.alive;
    jump.hidden = !play || me.hunter || !me.alive;
    taunt.hidden = jump.hidden;
    if (play) return;
    if (document.pointerLockElement) document.exitPointerLock();
    if (v.phase !== "lobby" && !ready) {
      root.dataset.screen = "loading";
      panel.innerHTML = sceneFailed
        ? "<h1>Карта не загрузилась</h1><p>Проверьте доступность WebGL и обновите страницу.</p>"
        : "<h1>Загружаем карту…</h1>";
      return;
    }
    if (v.phase === "hide") {
      panel.innerHTML = `<h1>Вы водите</h1><p>Игроки выбирают укрытия на карте «${mapNames[v.mapId ?? "office"]}».</p>
        <p class="hide-countdown">До выхода <b class="clock"></b></p>
        <p>Попадание в обычный предмет, в который можно превратиться, стоит одной жизни.</p>`;
      return;
    }
    if (v.phase === "results") {
      panel.innerHTML =
        "<h1>" +
        v.winner +
        " победили</h1>" +
        (v.host === me.id
          ? "<button class='survey-button primary-action' id='again'>Ещё раунд</button>"
          : "<p>Ведущий может начать следующий раунд.</p>");
      return;
    }
    const host = v.host === me.id,
      canStart =
        v.players.some((p) => p.hunter) &&
        v.players.some((p) => !p.hunter) &&
        v.players.every((p) => p.online);
    // Keep the controls mounted while players join or change sides.
    // Rebuilding them would discard a partially typed setting on a lobby update.
    if (!panel.querySelector(".hide-settings")) {
      panel.innerHTML = `<header class="survey-online-heading">
        <div class="survey-online-overview"><h1>Комната ожидания</h1><p class="hide-count"></p></div>
        <div class="survey-online-invites"><label class="survey-online-code hide-room-code">Код комнаты
        <input readonly value="${escape(room.roomId)}"></label><div class="survey-online-copy">
        <button class="survey-button secondary-action" id="copy-code">Скопировать код</button>
        <button class="survey-button secondary-action" id="invite">Скопировать ссылку</button></div></div>
        </header><div class="hide-room-columns">
        <section class="survey-online-team hide-roster"><h2>Игроки</h2><ul></ul>
        <p class="hide-note">Нажмите на роль, чтобы сменить сторону.</p></section>
        <section class="survey-online-team hide-rules"><h2 id="hide-rules-title">Настройки раунда</h2>
        <fieldset class="hide-settings" aria-labelledby="hide-rules-title">
        <label>Карта<select data-map aria-label="Карта">${mapOptions}</select></label>${settingFields}</fieldset></section></div>
        <footer class="survey-online-footer"><p class="hide-start-wait"></p>
        <button class="survey-button primary-action" id="start">Начать раунд</button></footer>`;
    }
    panel.querySelector(".hide-count")!.textContent = "Прятки · В комнате " + v.players.length + " из 12";
    const settings = panel.querySelector<HTMLFieldSetElement>(".hide-settings")!;
    settings.disabled = !host;
    settings.querySelector("select")!.value = v.mapId ?? "office";
    for (const field of settings.querySelectorAll<HTMLInputElement>("input")) {
      const key = field.dataset.setting;
      if (isHideSetting(key) && field !== document.activeElement) field.value = String(v.settings[key]);
    }
    const start = panel.querySelector<HTMLButtonElement>("#start")!;
    start.hidden = !host;
    start.disabled = !canStart;
    const wait = panel.querySelector<HTMLElement>(".hide-start-wait")!;
    wait.textContent = !canStart ? "Для старта нужны водящий и прячущийся. Все игроки должны быть на связи." :
      host ? "" : "Раунд начнёт ведущий.";
    panel.querySelector("ul")!.innerHTML =
      v.players
        .map(
          (p) =>
            "<li><span>" +
            escape(p.name) +
            (p.id === me.id ? " · вы" : "") +
            (p.online ? "" : " · отключён") +
            '</span><button class="survey-button secondary-action" data-role="' +
            escape(p.id) +
            '" ' +
            (host || p.id === me.id ? "" : "disabled") +
            ">" +
            (p.hunter ? "Водит" : "Прячется") +
            "</button></li>",
        )
        .join("");
  }
  panel.addEventListener("change", (event) => {
    const field = event.target;
    if (!room || !view || view.phase !== "lobby" || room.sessionId !== view.host) return;
    if (field instanceof HTMLSelectElement && field.hasAttribute("data-map") && isMapId(field.value)) {
      room.send("map", { id: field.value });
      return;
    }
    if (!(field instanceof HTMLInputElement)) return;
    const key = field.dataset.setting;
    if (!isHideSetting(key)) return;
    const value = field.valueAsNumber;
    if (!validSetting(key, value)) {
      notify(`Введите целое число от 1 до ${settingLimits[key]}`);
      field.value = String(view.settings[key]);
      return;
    }
    room.send("settings", { key, value });
  });
  panel.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b || !room || !view) return;
    if (b.dataset.role) {
      const p = view.players.find((p) => p.id === b.dataset.role)!;
      room.send("role", { id: p.id, hunter: !p.hunter });
    }
    if (b.id === "start" || b.id === "again") room.send(b.id);
    if (b.id === "invite" || b.id === "copy-code") {
      const copyCode = b.id === "copy-code";
      const value = copyCode ? room.roomId : location.href;
      try {
        await navigator.clipboard.writeText(value);
        notify(copyCode ? "Код скопирован" : "Ссылка скопирована");
      } catch {
        prompt(copyCode ? "Код комнаты" : "Ссылка на комнату", value);
      }
    }
  });
  setInterval(() => {
    if (!view || !room) return;
    const me = view.players.find((p) => p.id === room!.sessionId);
    if (!me) return;
    const left = Math.max(
      0,
      Math.ceil((view.until - view.now - performance.now() + seenAt) / 1000),
    );
    const time =
      Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    const clock = panel.querySelector(".clock");
    if (clock && clock.textContent !== time) clock.textContent = time;
    const status =
      (me.alive
        ? me.hunter
          ? "Водящий · Жизни " + me.ammo + "/" + view.settings.shotsPerHunter
          : "Прячетесь"
        : "Наблюдение") +
      "   " +
      time +
      "   Осталось: " +
      view.remaining;
    if (hud.textContent !== status) hud.textContent = status;
    const hint = matchMedia("(pointer:coarse)").matches
      ? "Слева — движение, справа — обзор"
      : "WASD — движение · мышь — обзор · " +
        (me.hunter ? "ЛКМ — выстрел" : "пробел — прыжок · E — скопировать · Q — дразнилка") +
        " · щёлкните для захвата мыши";
    if (hud.dataset.hint !== hint) hud.dataset.hint = hint;
  }, 150);
  const pad = root.querySelector<HTMLElement>(".stick")!;
  function joystick(e: PointerEvent) {
    const b = pad.getBoundingClientRect(),
      x = (e.clientX - b.left - b.width / 2) / (b.width / 2),
      y = -(e.clientY - b.top - b.height / 2) / (b.height / 2);
    scene?.joystick(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)), e.timeStamp);
  }
  pad.onpointerdown = (e) => {
    pad.setPointerCapture(e.pointerId);
    joystick(e);
  };
  pad.onpointermove = (e) => {
    if (pad.hasPointerCapture(e.pointerId)) joystick(e);
  };
  pad.onlostpointercapture = e => scene?.joystick(0, 0, e.timeStamp);
  action.onclick = () => scene?.action();
  taunt.onclick = () => { if (!taunt.hidden) room?.send("taunt"); };
  jump.onpointerdown = (e) => { e.preventDefault(); scene?.jump(); };
  window.addEventListener("keydown", (event) => {
    if (event.code !== "KeyQ" || event.repeat || !room || !view || document.hidden ||
        event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const me = view.players.find(p => p.id === room!.sessionId);
    if (me?.alive && !me.hunter && (view.phase === "hide" || view.phase === "hunt")) room.send("taunt");
  });
  window.addEventListener("pagehide", () => room?.connection.close());
  async function resume(token: string) {
    root.dataset.screen = "loading";
    panel.innerHTML = "<h1>Возвращаемся в комнату…</h1>";
    const deadline = Date.now() + 60000;
    // A proxy may report the old socket closed after the replacement tab loads.
    do {
      try {
        const resumed = await client.reconnect(token);
        await attach(resumed);
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    } while (Date.now() < deadline);
    sessionStorage.removeItem(key);
    form("Время возврата истекло. Войдите в комнату снова.");
  }
  const token = sessionStorage.getItem(key);
  if (invited && token?.startsWith(invited + ":")) void resume(token);
  else form();
}
