import type { Shot } from "../../shared/hide/shot";
import { Client, type Room } from "colyseus.js";
import { type Snapshot } from "../../shared/hide/world";
import { isHideSetting, settingLimits, validSetting, type HideSettings } from "../../shared/hide/settings";
import { createScene } from "./scene";
import "./hide.css";

const settingLabels: Record<keyof HideSettings, string> = {
  hideSeconds: "До выхода водящих, сек",
  huntSeconds: "Время охоты, сек",
  shotsPerHunter: "Выстрелов на водящего за раунд",
};
const settingFields = (Object.keys(settingLabels) as (keyof HideSettings)[]).map(key =>
  `<label>${settingLabels[key]}<input type="number" required data-setting="${key}" min="1" max="${settingLimits[key]}" step="1"></label>`,
).join("");

export function mount(app: HTMLElement) {
  app.innerHTML =
    '<main class="hide-game"><canvas></canvas><div class="hide-hud"></div><div class="hide-aim"></div><div class="hide-touch"><div class="stick">✥</div><button class="jump" hidden>Прыжок</button><button class="action">Действие</button></div><section class="hide-panel"></section><output></output></main>';
  const root = app.querySelector("main")!,
    panel = root.querySelector("section")!,
    canvas = root.querySelector("canvas")!,
    hud = root.querySelector<HTMLElement>(".hide-hud")!,
    out = root.querySelector("output")!;
  const action = root.querySelector<HTMLButtonElement>(".action")!;
  const jump = root.querySelector<HTMLButtonElement>(".jump")!;
  const code = new URL(location.href).searchParams.get("room");
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
    generation = 0,
    seenAt = 0,
    stamp = "",
    messageTimer = 0;
  const key = "hide.connection",
    nameKey = "hide.name";
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  function notify(s: string) {
    out.textContent = s;
    clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => (out.textContent = ""), 2800);
  }
  function form(error = "") {
    root.dataset.play = "false";
    panel.hidden = false;
    panel.innerHTML =
      '<a href="/">Все игры</a><h1>Прятки</h1><p>Brightline Offices · 2–12 игроков</p><form><label>Ваше имя<input maxlength="24" required autocomplete="nickname"></label><button>' +
      (code ? "Войти в комнату" : "Создать комнату") +
      "</button></form><small></small>";
    const input = panel.querySelector("input")!;
    input.value = localStorage.getItem(nameKey) ?? "";
    panel.querySelector("small")!.textContent = error;
    panel.querySelector("form")!.onsubmit = async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      localStorage.setItem(nameKey, name);
      panel.querySelector("button")!.disabled = true;
      try {
        await attach(
          code
            ? await client.joinById(code, { name })
            : await client.create("hide", { name }),
        );
      } catch {
        form(
          "Не удалось войти. Проверьте подключение или попросите новую ссылку.",
        );
      }
    };
  }
  async function attach(r: Room) {
    room = r;
    sessionStorage.setItem(key, r.reconnectionToken);
    const url = new URL(location.href);
    url.searchParams.set("room", r.roomId);
    history.replaceState(null, "", url);
    r.onMessage("shot", (shot: Shot) => scene?.shot(shot));
    r.onMessage("feedback", (s: string) => notify(s));
    r.onMessage("view", (v: Snapshot) => {
      view = v;
      seenAt = performance.now();
      scene?.update(v);
      render();
    });
    r.onLeave(() => {
      location.reload();
    });
    r.send("sync");
    if (!scene) {
      const gen = ++generation;
      try {
        scene = await createScene(
          canvas,
          r.sessionId,
          (batch) => room?.send("move", batch),
          (aim, seen) => room?.send("use", { aim, seen }),
        );
        if (gen !== generation) return;
        ready = true;
        if (view) scene.update(view);
        stamp = "";
        render();
      } catch {
        sceneFailed = true;
        stamp = "";
        render();
      }
    }
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
          ready, sceneFailed, v.phase, v.winner, v.host,
          v.phase === "lobby" && v.settings,
          v.phase === "lobby" && v.players.map((p) => [p.id, p.name, p.hunter, p.online]),
        ]);
    if (stamp === signature) return;
    stamp = signature;
    root.dataset.play = String(play);
    root.dataset.results = String(ready && v.phase === "results");
    panel.hidden = play;
    action.textContent = me.hunter ? "Выстрел" : "Скопировать";
    action.hidden = !me.alive;
    jump.hidden = !play || me.hunter || !me.alive;
    if (play) return;
    if (document.pointerLockElement) document.exitPointerLock();
    if (!ready) {
      panel.innerHTML = sceneFailed
        ? "<h1>Офис не загрузился</h1><p>Проверьте доступность WebGL и обновите страницу.</p>"
        : "<h1>Загружаем офис…</h1>";
      return;
    }
    if (v.phase === "hide") {
      panel.innerHTML =
        "<h1>Вы водите</h1><p>Игроки выбирают укрытия. Офис откроется через <b class='clock'></b>.</p>";
      return;
    }
    if (v.phase === "results") {
      panel.innerHTML =
        "<h1>" +
        v.winner +
        " победили</h1>" +
        (v.host === me.id
          ? "<button id='again'>Ещё раунд</button>"
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
      panel.innerHTML = '<a href="/">Все игры</a><h1>Прятки</h1><p class="hide-count"></p>' +
        '<button id="invite">Скопировать приглашение</button><ul></ul>' +
        '<p>Нажмите на роль, чтобы сменить сторону. Для старта нужен хотя бы один игрок с каждой стороны.</p>' +
        '<fieldset class="hide-settings"><legend>Настройки раунда</legend>' + settingFields + '</fieldset>' +
        '<button id="start">Начать раунд</button><p class="hide-start-wait">Ожидаем старта</p>';
    }
    panel.querySelector(".hide-count")!.textContent = "Brightline Offices · " + v.players.length + " / 12";
    const settings = panel.querySelector<HTMLFieldSetElement>(".hide-settings")!;
    settings.disabled = !host;
    for (const field of settings.querySelectorAll<HTMLInputElement>("input")) {
      const key = field.dataset.setting;
      if (isHideSetting(key) && field !== document.activeElement) field.value = String(v.settings[key]);
    }
    const start = panel.querySelector<HTMLButtonElement>("#start")!;
    start.hidden = !host;
    start.disabled = !canStart;
    panel.querySelector<HTMLElement>(".hide-start-wait")!.hidden = host;
    panel.querySelector("ul")!.innerHTML =
      v.players
        .map(
          (p) =>
            "<li><span>" +
            escape(p.name) +
            (p.id === me.id ? " · вы" : "") +
            (p.online ? "" : " · отключён") +
            '</span><button data-role="' +
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
    if (!(field instanceof HTMLInputElement) || !room || !view || view.phase !== "lobby" || room.sessionId !== view.host) return;
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
    if (b.id === "invite") {
      try {
        await navigator.clipboard.writeText(location.href);
        notify("Ссылка скопирована");
      } catch {
        prompt("Ссылка на комнату", location.href);
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
          ? "Водящий · Патроны " + me.ammo + "/" + view.settings.shotsPerHunter
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
        (me.hunter ? "ЛКМ — выстрел" : "пробел — прыжок · E — скопировать") +
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
  jump.onpointerdown = (e) => { e.preventDefault(); scene?.jump(); };
  window.addEventListener("pagehide", () => room?.connection.close());
  async function resume(token: string) {
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
  if (code && token?.startsWith(code + ":")) void resume(token);
  else form();
}
