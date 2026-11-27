import { Client, type Room } from "colyseus.js";
import {
  DRAW_MAX,
  DRAW_MIN,
  DRAW_ROOM,
  type DrawView,
} from "../../shared/draw";
import { mountCanvas } from "./canvas";
import "./style.css";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const hostUrl =
  import.meta.env.VITE_SERVER_URL ||
  (location.hostname.endsWith(".chatgpt.site")
    ? "https://party-games-kagertanin.waw0.amvera.tech"
    : import.meta.env.DEV
      ? location.protocol + "//" + location.hostname + ":2567"
      : location.origin);
const http = String(hostUrl).replace(/^ws/, "http").replace(/\/$/, "");
const storage = "risovach.room";
const nameKey = "risovach.name";
function read(k: string) {
  try {
    return sessionStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
}
function write(k: string, v: string) {
  try {
    if (v) sessionStorage.setItem(k, v);
    else sessionStorage.removeItem(k);
  } catch {
    /* Private browsing. */
  }
}

export function mountDraw(app: HTMLElement) {
  let socket: Room | undefined;
  let view: DrawView | undefined;
  let drawer: ReturnType<typeof mountCanvas> | undefined;
  let clockOffset = 0;
  let pageKey = "";
  let connecting = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let retry = 0;
  let selection = "";
  let voluntary = false;
  const invited = (
    new URL(location.href).searchParams.get("room") ?? ""
  ).toUpperCase();
  const sdk = new Client(http);
  app.innerHTML = `<main class="risovach"><header><a href="./" class="draw-brand" aria-label="К выбору игр">И.Г.Р.Ы.</a><span>Рисовач</span><button data-exit hidden>Выйти</button></header>
    <div class="draw-notice" role="status"></div><section class="draw-stage"></section></main>`;
  const stage = app.querySelector<HTMLElement>(".draw-stage")!;
  const exit = app.querySelector<HTMLButtonElement>("[data-exit]")!;
  const notify = (s: string) => {
    app.querySelector(".draw-notice")!.textContent = s;
  };
  const who = (id: string) =>
    esc(view?.players.find((p) => p.id === id)?.name ?? "Игрок");
  const act = (type: string, extra: Record<string, unknown> = {}) =>
    socket?.send("play", { epoch: view?.epoch, type, ...extra });
  function entrance(join = Boolean(invited)) {
    pageKey = "";
    exit.hidden = true;
    stage.innerHTML = `<div class="draw-intro"><div class="draw-hero-art" aria-hidden="true"></div>
      <div class="draw-panel"><h1>Рисовач</h1><p>Нарисуй свою фразу. Придумай подпись к чужому рисунку и попробуй угадать настоящую.</p>
      <div class="draw-tabs"><button data-mode="create" aria-pressed="${!join}">Создать комнату</button><button data-mode="join" aria-pressed="${join}">Присоединиться</button></div>
      <form><label>Твоё имя<input name="name" autocomplete="nickname" maxlength="24" required value="${esc(read(nameKey))}"></label>
      ${join ? `<label>Код комнаты<input name="code" maxlength="7" pattern="[Rr][0-9a-fA-F]{6}" placeholder="R…" required value="${esc(invited)}"></label>` : ""}
      <button class="primary">${join ? "Войти" : "Создать"}</button></form></div></div>`;
    stage.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(
      (b) =>
        (b.onclick = () => {
          write(
            nameKey,
            stage.querySelector<HTMLInputElement>("[name=name]")!.value,
          );
          entrance(b.dataset.mode === "join");
        }),
    );
    const form = stage.querySelector("form")!;
    form.onsubmit = (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const name = String(data.get("name")).trim();
      if (!name) return;
      write(nameKey, name);
      const code = String(data.get("code") ?? "")
        .trim()
        .toUpperCase();
      void connect(
        () =>
          join ? sdk.joinById(code, { name }) : sdk.create(DRAW_ROOM, { name }),
        false,
      );
    };
  }
  async function connect(open: () => Promise<Room>, resuming: boolean) {
    if (connecting) return;
    connecting = true;
    notify(resuming ? "Возвращаемся в комнату…" : "Подключаемся…");
    try {
      const room = await open();
      socket = room;
      retry = 0;
      voluntary = false;
      pageKey = "";
      write(
        storage,
        JSON.stringify({ code: room.roomId, token: room.reconnectionToken }),
      );
      const url = new URL(location.href);
      url.searchParams.set("room", room.roomId);
      history.replaceState(null, "", url);
      room.onMessage<DrawView>("view", (v) => {
        view = v;
        clockOffset = v.now - Date.now();
        notify("");
        render(v);
      });
      room.onMessage<string>("problem", notify);
      room.onLeave(() => {
        if (socket !== room || voluntary) return;
        socket = undefined;
        notify("Соединение прервалось. Возвращаемся в комнату…");
        scheduleReconnect();
      });
      room.send("sync");
    } catch {
      if (resuming && retry < 5) {
        scheduleReconnect();
        return;
      }
      write(storage, "");
      view = undefined;
      drawer?.dispose(false);
      drawer = undefined;
      entrance();
      notify(
        resuming
          ? "Время возврата истекло. Войдите по коду комнаты."
          : "Не удалось войти. Проверьте код комнаты и подключение.",
      );
    } finally {
      connecting = false;
    }
  }
  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    const raw = read(storage);
    if (!raw) return;
    const data = JSON.parse(raw);
    retry++;
    reconnectTimer = setTimeout(
      () => void connect(() => sdk.reconnect(data.token), true),
      Math.min(retry * 800, 3500),
    );
  }
  exit.onclick = () => {
    voluntary = true;
    clearTimeout(reconnectTimer);
    write(storage, "");
    void socket?.leave();
    location.href = "?game=draw";
  };
  function bar(v: DrawView, label: string) {
    return `<div class="draw-bar"><strong>${label}</strong><span data-progress></span><b class="draw-clock" aria-label="Оставшееся время"></b></div>`;
  }
  function picture(v: DrawView) {
    return v.picture
      ? `<img class="draw-picture" alt="Рисунок игрока" src="${esc(http + v.picture)}">`
      : '<div class="draw-picture blank">Холст остался пустым</div>';
  }
  function render(v: DrawView) {
    exit.hidden = false;
    const key = [
      v.code,
      v.epoch,
      v.phase,
      v.phase === "drawing" || v.phase === "captions" ? v.done : "",
    ].join(".");
    if (pageKey !== key || v.phase === "lobby") {
      drawer?.dispose(v.phase !== "drawing" || v.done);
      drawer = undefined;
      selection = "";
      pageKey = key;
      if (v.phase === "lobby") {
        stage.innerHTML = `<div class="draw-panel lobby"><h1>Комната ожидания</h1><button class="draw-code" title="Скопировать код" data-copy>${esc(v.code)} <small>Копировать</small></button>
        <p>Игроки · ${v.players.filter((p) => p.connected).length} из ${DRAW_MAX}</p><ul class="roster">${v.players.map((p) => `<li>${who(p.id)} ${p.id === v.host ? "<small>ведущий</small>" : ""}${p.connected ? "" : " · вне сети"}</li>`).join("")}</ul>
        ${v.you === v.host ? `<button class="primary" data-start ${v.players.filter((p) => p.connected).length < DRAW_MIN ? "disabled" : ""}>Начать игру</button><small>От 3 до 12 игроков</small>` : "<p>Ведущий начнёт игру.</p>"}</div>`;
        stage.querySelector<HTMLButtonElement>("[data-copy]")!.onclick = () =>
          void navigator.clipboard.writeText(v.code).then(
            () => notify("Код скопирован."),
            () => notify("Код комнаты " + v.code),
          );
        const start = stage.querySelector<HTMLButtonElement>("[data-start]");
        if (start) start.onclick = () => act("start");
      } else if (v.phase === "drawing") {
        stage.innerHTML =
          bar(v, "Рисование") +
          `<div class="draw-panel studio"><h1>${esc(v.prompt ?? "Твоё задание")}</h1>${v.done ? "<p>Рисунок принят. Ждём остальных художников.</p>" : '<div class="drawing-pad"></div>'}</div>`;
        if (!v.done && v.upload)
          drawer = mountCanvas(
            stage.querySelector(".drawing-pad")!,
            http + v.upload,
            () => act("ready"),
            notify,
          );
      } else if (
        v.phase === "captions" ||
        v.phase === "vote" ||
        v.phase === "reveal"
      ) {
        stage.innerHTML =
          bar(v, `Рисунок ${v.turn + 1} из ${v.total}`) +
          `<div class="draw-spread"><div class="draw-sheet">${picture(v)}</div><div class="draw-panel responses"></div></div>`;
        const panel = stage.querySelector(".responses")!;
        if (v.phase === "captions") {
          const artist = v.you === v.artist;
          panel.innerHTML = `<h1>${artist ? "Твой рисунок" : "Придумай подпись"}</h1>${artist ? "<p>Другие игроки придумывают свои версии.</p>" : v.done ? "<p>Подпись принята. Скоро голосование.</p>" : `<p>Как бы звучало задание к этому рисунку? Предложи версию, в которую поверят друзья.</p><form><label>Твоя версия<input name="caption" required maxlength="80" autocomplete="off"></label><button class="primary">Отправить</button></form>`}`;
          const form = panel.querySelector("form");
          if (form)
            form.onsubmit = (e) => {
              e.preventDefault();
              act("caption", { text: new FormData(form).get("caption") });
            };
        } else if (v.phase === "vote") {
          panel.innerHTML = `<h1>${v.you === v.artist ? "Подписи к твоему рисунку" : "Какая фраза была задана?"}</h1><p>${v.you === v.artist ? "Отметь понравившиеся подписи сердцем." : "Выбери ответ. Сердцем можно отдельно отметить смешные версии."}</p><div class="draw-options"></div>${v.you !== v.artist ? '<button class="primary" data-vote disabled>Проголосовать</button>' : ""}`;
        } else {
          const truth = v.reveal!.find((o) => o.truth)!;
          panel.innerHTML = `<small>Исходная фраза · ${who(truth.author)}</small><h1>${esc(truth.text)}</h1>
          <p>Угадали: ${truth.voters.length ? truth.voters.map(who).join(", ") : "никто"}</p>
          <ul class="reveal-list">${v
            .reveal!.filter((o) => !o.truth)
            .map(
              (o) =>
                `<li><strong>${esc(o.text)}</strong> · ${who(o.author)}<small>${o.voters.length ? "Поверили: " + o.voters.map(who).join(", ") : "0 голосов"} · ♥ ${o.likes}</small></li>`,
            )
            .join("")}</ul>
          <b>Твои очки за рисунок: +${v.gains?.[v.you] ?? 0}</b>`;
        }
      } else if (v.phase === "results") {
        const ranked = [...v.players].sort((a, b) => b.points - a.points);
        const award = (prop: "likes" | "guesses" | "fooled", title: string) => {
          const best = Math.max(...ranked.map((p) => p[prop]));
          return best
            ? `<p><b>${title}</b> · ${ranked
                .filter((p) => p[prop] === best)
                .map((p) => who(p.id))
                .join(", ")} (${best})</p>`
            : "";
        };
        stage.innerHTML = `<div class="draw-panel lobby"><h1>Итоги партии</h1><ol class="score-list">${ranked.map((p) => `<li><span>${who(p.id)}</span><b>${p.points}</b></li>`).join("")}</ol>${award("guesses", "Больше всех угадали")}${award("fooled", "Самые убедительные подписи")}${award("likes", "Любимцы компании")}${v.host === v.you ? '<button class="primary" data-again>Ещё партия</button>' : ""}</div>`;
        stage
          .querySelector("button")
          ?.addEventListener("click", () => act("again"));
      }
    }
    if (v.phase === "vote") {
      const choices = stage.querySelector(".draw-options")!;
      if (!choices.childElementCount) {
        choices.innerHTML = v
          .choices!.map(
            (o) =>
              `<div><button data-choice="${o.id}">${esc(o.text)}</button><button data-heart="${o.id}" aria-label="Респект: ${esc(o.text)}">♡</button></div>`,
          )
          .join("");
      }
      const submit = stage.querySelector<HTMLButtonElement>("[data-vote]");
      for (const o of v.choices!) {
        const b = choices.querySelector<HTMLButtonElement>(
          `[data-choice="${o.id}"]`,
        )!;
        b.disabled = v.you === v.artist || o.mine || v.done;
        b.setAttribute("aria-pressed", String(selection === o.id));
        b.onclick = () => {
          selection = o.id;
          render(v);
        };
        const h = choices.querySelector<HTMLButtonElement>(
          `[data-heart="${o.id}"]`,
        )!;
        const liked = v.liked?.includes(o.id) ?? false;
        h.disabled = o.mine;
        h.textContent = liked ? "♥" : "♡";
        h.setAttribute("aria-pressed", String(liked));
        h.onclick = () => act("like", { choice: o.id, likes: !liked });
      }
      if (submit) {
        submit.disabled = v.done || !selection;
        submit.textContent = v.done ? "Голос принят" : "Проголосовать";
        submit.onclick = () => act("vote", { choice: selection });
      }
    }
    const progress = stage.querySelector("[data-progress]");
    if (progress)
      progress.textContent =
        v.phase === "reveal"
          ? "Разгадка"
          : `Готовы ${v.ready} из ${v.expected}`;
    tick();
  }
  function tick() {
    if (!view?.deadline) return;
    const left = Math.max(
      0,
      Math.ceil((view.deadline - Date.now() - clockOffset) / 1000),
    );
    const timer = stage.querySelector(".draw-clock");
    if (timer)
      timer.textContent =
        Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    if (left === 0 && view.phase === "drawing") drawer?.submit();
  }
  setInterval(tick, 250);
  entrance();
  try {
    const saved = JSON.parse(read(storage) || "null");
    if (saved && (!invited || saved.code === invited))
      void connect(() => sdk.reconnect(saved.token), true);
  } catch {
    write(storage, "");
  }
}
