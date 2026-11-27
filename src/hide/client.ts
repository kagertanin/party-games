import { Client, type Room } from "colyseus.js";
import { type Snapshot } from "../../shared/hide/world";
import { createScene } from "./scene";
import "./hide.css";

export function mount(app: HTMLElement) {
  app.innerHTML =
    '<main class="hide-game"><canvas></canvas><div class="hide-hud"></div><div class="hide-aim"></div><div class="hide-touch"><div class="stick">✥</div><button class="action">Действие</button></div><section class="hide-panel"></section><output></output></main>';
  const root = app.querySelector("main")!,
    panel = root.querySelector("section")!,
    canvas = root.querySelector("canvas")!,
    hud = root.querySelector<HTMLElement>(".hide-hud")!,
    out = root.querySelector("output")!;
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
          (i) => room?.send("input", i),
          () => room?.send("use", { seen: view?.now }),
        );
        if (gen !== generation) return;
        ready = true;
        if (view) scene.update(view);
        stamp = "";
        render();
      } catch {
        panel.hidden = false;
        panel.innerHTML =
          "<h1>Офис не загрузился</h1><p>Проверьте доступность WebGL и обновите страницу.</p>";
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
    root.dataset.play = String(play);
    panel.hidden = play;
    const action = root.querySelector<HTMLButtonElement>(".action")!;
    action.textContent = me.hunter ? "Выстрел" : "Скопировать";
    action.hidden = !me.alive;
    if (play) {
      stamp = "";
      return;
    }
    if (document.pointerLockElement) document.exitPointerLock();
    const signature = JSON.stringify([
      ready,
      v.phase,
      v.winner,
      v.host,
      v.players.map((p) => [p.id, p.name, p.hunter, p.online]),
    ]);
    if (stamp === signature) return;
    stamp = signature;
    if (!ready) {
      panel.innerHTML = "<h1>Загружаем офис…</h1>";
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
    panel.innerHTML =
      '<a href="/">Все игры</a><h1>Прятки</h1><p>Brightline Offices · ' +
      v.players.length +
      ' / 12</p><button id="invite">Скопировать приглашение</button><ul>' +
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
        .join("") +
      "</ul><p>Нажмите на роль, чтобы сменить сторону. Для старта нужен хотя бы один игрок с каждой стороны.</p>" +
      (host
        ? '<button id="start" ' +
          (canStart ? "" : "disabled") +
          ">Начать раунд</button>"
        : "<p>Ожидаем старта</p>");
  }
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
    if (clock) clock.textContent = time;
    hud.textContent =
      (me.alive
        ? me.hunter
          ? "Водящий · " + me.ammo + "/6"
          : "Прячетесь"
        : "Наблюдение") +
      "   " +
      time +
      "   Осталось: " +
      view.remaining;
    hud.dataset.hint = matchMedia("(pointer:coarse)").matches
      ? "Слева — движение, справа — обзор"
      : "WASD — движение · мышь — обзор · " +
        (me.hunter ? "ЛКМ — выстрел" : "E — скопировать") +
        " · щёлкните для захвата мыши";
  }, 150);
  const pad = root.querySelector<HTMLElement>(".stick")!;
  function joystick(e: PointerEvent) {
    const b = pad.getBoundingClientRect(),
      x = (e.clientX - b.left - b.width / 2) / (b.width / 2),
      y = -(e.clientY - b.top - b.height / 2) / (b.height / 2);
    scene?.joystick(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
  }
  pad.onpointerdown = (e) => {
    pad.setPointerCapture(e.pointerId);
    joystick(e);
  };
  pad.onpointermove = (e) => {
    if (pad.hasPointerCapture(e.pointerId)) joystick(e);
  };
  pad.onlostpointercapture = () => scene?.joystick(0, 0);
  root.querySelector<HTMLButtonElement>(".action")!.onclick = () =>
    scene?.action();
  const token = sessionStorage.getItem(key);
  if (code && token?.startsWith(code + ":"))
    client
      .reconnect(token)
      .then(attach)
      .catch(() => {
        sessionStorage.removeItem(key);
        form("Войдите в комнату снова.");
      });
  else form();
}
