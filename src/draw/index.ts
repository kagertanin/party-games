import { playSound } from "../audio/sound";
import { Client, type Room } from "colyseus.js";
import {
  drawIntro,
  DRAW_TIMES,
  DRAW_KICKED,
  DRAW_ROOM,
  type DrawView,
} from "../../shared/draw";
import type { DrawDemo } from "./demo";
import { mountCanvas, paintStrokes } from "./canvas";
import { escape as esc } from "../rooms/ui";
import { openDrawForm, mountDrawLobby } from "./rooms";
import { drawServerUrl } from "./avatar";
import { finale } from "./finale";
import { mountReveal } from "./reveal";
import { songbird } from "./art/songbird";
import logo from "../home-art/logo.webp";
import "../base.css";
import "../survey/demo.css";
import "../survey/online-lobby.css";
import "../survey/textile.css";
import "../survey/landing-textile.css";
import "../survey/lobby-textile.css";
import "./style.css";
import "./finale.css";
import "./lobby.css";

const http = drawServerUrl();
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
  let demo: DrawDemo | undefined;
  const demoImages = new Map<string, string>();
  let view: DrawView | undefined;
  let drawer: ReturnType<typeof mountCanvas> | undefined;
  let clockOffset = 0;
  let pageKey = "";
  let connecting = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let retry = 0;

  let voluntary = false;
  const invited = (
    new URL(location.href).searchParams.get("room") ?? ""
  ).toUpperCase();
  const directDemo =
    new URLSearchParams(location.search).get("demo") === "1" && !invited;
  const sdk = new Client(http);
  app.classList.add("survey-app", "draw-app");
  app.innerHTML = `<header class="survey-header"><a href="./" class="survey-brand"><img src="${logo}" alt="И.Г.Р.Ы." width="550" height="204"></a>
    <span data-title hidden>Рисовач</span>
    <div class="survey-demo-tools draw-demo-tools" data-demo-tools hidden>
      <label class="survey-view-choice">Игрок в демо <select data-perspective></select></label>
      <button class="survey-button secondary-action" data-next>Следующий этап</button>
      <button class="survey-button secondary-action" data-finish-demo>Симулировать конец игры</button>
    </div><button class="survey-button secondary-action draw-exit" data-exit hidden>Выйти</button><a data-all href="./">Все игры</a></header>
    <div class="draw-notice" role="status"></div><div class="draw-stage"></div><div class="draw-curtain" role="status" hidden><strong></strong></div>`;
  const stage = app.querySelector<HTMLElement>(".draw-stage")!;
  const exit = app.querySelector<HTMLButtonElement>("[data-exit]")!;
  const curtain = app.querySelector<HTMLElement>(".draw-curtain")!;
  let curtainTimer: ReturnType<typeof setTimeout>;
  let shownStage = "";
  let transitioning = false;
  let fastFinale = false;
  const header = app.querySelector<HTMLElement>(".survey-header")!;
  let lobby: ReturnType<typeof mountDrawLobby> | undefined;
  let recap: ReturnType<typeof mountReveal> | undefined;
  const notify = (s: string) => {
    app.querySelector(".draw-notice")!.textContent = s;
  };
  const demoTools = app.querySelector<HTMLElement>("[data-demo-tools]")!;
  const perspective =
    demoTools.querySelector<HTMLSelectElement>("[data-perspective]")!;
  const next = demoTools.querySelector<HTMLButtonElement>("[data-next]")!;
  function refreshDemo() {
    if (!demo) return;
    view = demo.snapshot();
    clockOffset = 0;
    notify("");
    render(view);
  }
  function startDemo(Game: typeof DrawDemo) {
    demo = new Game();
    demoImages.clear();
    pageKey = "";
    shownStage = "";
    perspective.innerHTML =
      '<option value="auto">По очереди</option>' +
      demo.players
        .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
        .join("");
    perspective.value = demo.perspective;
    refreshDemo();
  }
  perspective.onchange = () => {
    if (demo) {
      demo.perspective = perspective.value;
      refreshDemo();
    }
  };
  next.onclick = () => {
    demo?.next();
    refreshDemo();
  };
  demoTools.querySelector<HTMLButtonElement>("[data-finish-demo]")!.onclick =
    () => {
      fastFinale = true;
      demo?.finish();
      refreshDemo();
    };
  const act = (type: string, extra: Record<string, unknown> = {}) => {
    if (!demo) {
      socket?.send("play", { epoch: view?.epoch, type, ...extra });
      return;
    }
    if (type === "again") {
      location.reload();
      return;
    }
    try {
      demo.act(type, extra);
      refreshDemo();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Не удалось выполнить действие.",
      );
    }
  };
  function entrance() {
    lobby?.dispose(true);
    lobby = undefined;
    pageKey = "";
    shownStage = "";
    header.hidden = false;
    app.classList.add("is-landing");
    app.querySelector<HTMLElement>("[data-title]")!.hidden = true;
    app.querySelector<HTMLElement>("[data-all]")!.hidden = false;
    exit.hidden = true;
    stage.className = "draw-stage";
    resetTransition();
    stage.innerHTML = `<main class="survey-wrap survey-setup"><section class="survey-intro">
      <h1>Рисовач</h1><p class="survey-player-range">3–12 игроков</p>
      <p class="survey-lead">Нарисуй свою фразу. Угадай, что рисовали друзья.</p>
      <div class="survey-start"><button class="survey-button primary-action" data-play>Играть</button>
      <button class="survey-button secondary-action" data-start-demo>Демо</button></div></section>
      <div class="draw-art-patch" role="img" aria-label="Птичка, нарисованная синей ручкой на ткани">${songbird}</div></main>`;
    stage.querySelector<HTMLButtonElement>("[data-play]")!.onclick = () =>
      openForm("");
    stage.querySelector<HTMLButtonElement>("[data-start-demo]")!.onclick =
      async () => {
        const { DrawDemo } = await import("./demo");
        history.pushState(null, "", "?game=draw&demo=1");
        window.addEventListener("popstate", () => location.reload(), {
          once: true,
        });
        startDemo(DrawDemo);
      };
  }
  function openForm(code: string) {
    openDrawForm(app, read(nameKey), code, async (name, code) => {
      write(nameKey, name);
      await connect(
        () =>
          code ? sdk.joinById(code, { name }) : sdk.create(DRAW_ROOM, { name }),
        false,
      );
    });
  }
  function resetTransition() {
    clearTimeout(curtainTimer);
    transitioning = false;
    stage.inert = header.inert = false;
    curtain.hidden = true;
    stage.classList.remove("arriving");
  }
  function inTransition(v: DrawView) {
    const key = v.code + "." + v.epoch + "." + v.phase;
    const intro =
      (v.phase === "results" && fastFinale) ||
      (v.phase === "reveal" && v.reveal?.kind !== "opening")
        ? 0
        : drawIntro(v.phase);
    const age = Math.max(0, Date.now() + clockOffset - v.startedAt);
    if (key === shownStage && (!transitioning || intro > age))
      return transitioning;
    resetTransition();
    shownStage = key;
    if (!intro || age >= intro) return false;
    const names = {
      drawing: "Время рисовать!",
      captions: "Придумайте подпись",
      vote: "Голосование",
      reveal: "Подсчёт итогов",
      results: "Итоги партии",
      lobby: "",
    };
    playSound("turn");
    transitioning = true;
    stage.inert = header.inert = true;
    drawer?.dispose(v.phase !== "drawing");
    drawer = undefined;
    curtain.firstElementChild!.textContent = names[v.phase];
    curtain.classList.toggle("long-intro", v.phase === "drawing");
    curtain.style.setProperty("--intro-duration", intro + "ms");
    curtain.style.setProperty("--intro-delay", -age + "ms");
    curtain.hidden = false;
    // Never mount the next screen before its title has faded into the solid backdrop.
    curtainTimer = setTimeout(() => {
      if (shownStage !== key || !view) return;
      resetTransition();
      render(view);
      stage.classList.add("arriving");
    }, intro - age);
    return true;
  }
  async function connect(open: () => Promise<Room>, resuming: boolean) {
    if (connecting) throw Error("Уже подключаемся к комнате.");
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
      room.onMessage<string>("problem", (message) => {
        lobby?.retryAvatar();
        notify(message);
      });
      room.onLeave((code) => {
        if (socket !== room || voluntary) return;
        socket = undefined;
        if (code === DRAW_KICKED) {
          clearTimeout(reconnectTimer);
          write(storage, "");
          view = undefined;
          history.replaceState(null, "", "?game=draw");
          entrance();
          notify("Ведущий исключил вас из комнаты.");
          return;
        }
        notify("Соединение прервалось. Возвращаемся в комнату…");
        scheduleReconnect();
      });
      room.send("sync");
    } catch (error) {
      if (!resuming) {
        notify("");
        throw Error(
          error instanceof Error && /locked|full/i.test(error.message)
            ? "Комната заполнена или игра уже началась."
            : "Не удалось войти. Проверьте код комнаты и подключение.",
        );
      }
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
    if (demo) {
      location.href = "?game=draw";
      return;
    }
    lobby?.dispose(true);
    lobby = undefined;
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
    if (!v.picture)
      return '<div class="draw-picture blank">Холст остался пустым</div>';
    let source = http + v.picture;
    if (demo) {
      if (!demoImages.has(v.picture)) {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        paintStrokes(canvas.getContext("2d")!, demo.drawings.get(v.picture)!);
        demoImages.set(v.picture, canvas.toDataURL("image/png"));
      }
      source = demoImages.get(v.picture)!;
    }
    return `<img class="draw-picture" alt="Рисунок игрока" src="${esc(source)}">`;
  }
  function render(v: DrawView) {
    if (inTransition(v)) return;
    header.hidden = false;
    app.classList.remove("is-landing");
    app.querySelector<HTMLElement>("[data-title]")!.hidden = false;
    app.querySelector<HTMLElement>("[data-all]")!.hidden = true;
    exit.hidden = v.phase === "lobby";
    stage.className =
      v.phase === "lobby" ? "draw-stage" : "draw-stage risovach";
    if (demo) {
      demoTools.hidden = v.phase === "results";
      next.textContent = v.phase === "reveal" ? "Дальше" : "Следующий этап";
      perspective.options[0].text =
        demo.perspective === "auto"
          ? "По очереди · " +
            (v.players.find((p) => p.id === v.you)?.name ?? "")
          : "По очереди";
    }

    const key = [
      v.code,
      v.you,
      v.epoch,
      v.phase,
      v.phase === "drawing" || v.phase === "captions" ? v.done : "",
    ].join(".");
    if (pageKey !== key) {
      lobby?.dispose(v.phase !== "lobby");
      lobby = undefined;
      drawer?.dispose(v.phase !== "drawing" || v.done);
      drawer = undefined;

      pageKey = key;
      stage.onclick = null;
      recap?.dispose();
      recap = undefined;
      if (v.phase === "lobby") {
        lobby = mountDrawLobby(stage, v, http, act, () => exit.click(), notify);
      } else if (v.phase === "drawing") {
        stage.innerHTML =
          bar(v, "Рисование") +
          `<div class="draw-panel studio"><header><h1>${esc(v.prompt ?? "Твоя фраза")}</h1><p>Нарисуй то, что описывает фраза.</p></header>${v.done ? "<p>Рисунок принят. Ждём остальных художников.</p>" : '<div class="drawing-pad"></div>'}</div>`;
        if (!v.done && (v.upload || demo))
          drawer = mountCanvas(
            stage.querySelector(".drawing-pad")!,
            demo ? { strokes: demo.drawings.get(v.you)! } : http + v.upload,
            () => act("ready"),
            notify,
          );
      } else if (v.phase === "captions") {
        stage.innerHTML =
          bar(v, `Подписи · Рисунок ${v.turn + 1} из ${v.total}`) +
          `<div class="draw-spread"><div class="draw-sheet">${picture(v)}</div><div class="draw-panel responses"></div></div>`;
        const panel = stage.querySelector(".responses")!;
        const artist = v.you === v.artist;
        panel.innerHTML = `<h1>${artist ? "Твой рисунок" : "Придумай подпись"}</h1>${artist ? "<p>Другие игроки придумывают свои версии.</p>" : v.done ? "<p>Подпись принята. Скоро голосование.</p>" : `<p>Как бы звучала фраза к этому рисунку? Предложи версию, в которую поверят друзья.</p><form><label>Твоя версия<input name="caption" required maxlength="80" autocomplete="off"></label><button class="primary">Отправить</button></form>`}`;
        const form = panel.querySelector("form");
        if (form && demo) {
          const input = form.elements.namedItem("caption") as HTMLInputElement;
          input.value = demo.captionDrafts.get(v.you) ?? "";
          input.oninput = () => demo!.captionDrafts.set(v.you, input.value);
        }
        if (form)
          form.onsubmit = (e) => {
            e.preventDefault();
            act("caption", { text: new FormData(form).get("caption") });
          };
      } else if (v.phase === "vote") {
        const choices = v.choices ?? [];
        const side = (items: typeof choices) =>
          items
            .map(
              (o) =>
                `<div class="ballot-line"><button class="ballot-phrase" data-choice="${esc(o.id)}">${esc(o.text)}</button></div>`,
            )
            .join("");
        const middle = Math.ceil(choices.length / 2);
        stage.innerHTML =
          bar(v, `Голосование · Рисунок ${v.turn + 1} из ${v.total}`) +
          `<section class="draw-ballot"><h1>Что это?</h1><p class="ballot-hint" role="status"></p>
          <div class="ballot-field"><div class="ballot-picture">${picture(v)}</div>
          <div class="ballot-side ballot-left">${side(choices.slice(0, middle))}</div>
          <div class="ballot-side ballot-right">${side(choices.slice(middle))}</div></div></section>`;
        stage.onclick = (event) => {
          const button = (
            event.target as HTMLElement
          ).closest<HTMLButtonElement>("button");
          if (!button || button.disabled) return;
          if (button.dataset.choice) {
            stage
              .querySelectorAll<HTMLButtonElement>("[data-choice]")
              .forEach((b) => (b.disabled = true));
            act("vote", { choice: button.dataset.choice });
          }
        };
      } else if (v.phase === "reveal") {
        recap = mountReveal(stage, v, picture(v), (choice, likes) =>
          act("like", { choice, likes }),
        );
      } else if (v.phase === "results") {
        stage.innerHTML = finale(v.players, Boolean(demo || v.host === v.you));
        stage
          .querySelector("button")
          ?.addEventListener("click", () => act("again"));
      }
    } else if (v.phase === "lobby") {
      lobby?.update(v);
    }
    if (v.phase === "reveal") recap?.update(v);
    if (v.phase === "vote") {
      stage.querySelector(".ballot-hint")!.textContent =
        v.you === v.artist
          ? "Твой рисунок. Остальные выбирают фразу."
          : v.done
            ? "Голос принят."
            : "Нажми на фразу, чтобы отдать голос.";
      for (const o of v.choices ?? []) {
        const b = stage.querySelector<HTMLButtonElement>(
          `[data-choice="${o.id}"]`,
        )!;
        b.disabled = v.you === v.artist || o.mine || v.done;
        b.classList.toggle("is-mine", o.mine);
        b.setAttribute("aria-pressed", String(v.votedFor === o.id));
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
    if (transitioning || !view?.deadline) return;
    const remaining = Math.max(
      0,
      Math.ceil((view.deadline - Date.now() - clockOffset) / 1000),
    );
    const left =
      view.phase === "drawing" ||
      view.phase === "captions" ||
      view.phase === "vote"
        ? Math.min(remaining, DRAW_TIMES[view.phase] / 1000)
        : remaining;
    const timer = stage.querySelector(".draw-clock");
    if (timer)
      timer.textContent =
        Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    if (!demo && left === 0 && view.phase === "drawing") drawer?.submit();
  }
  setInterval(() => {
    if (demo && demo.deadline && Date.now() >= demo.deadline) {
      demo.next();
      refreshDemo();
    } else tick();
  }, 250);
  if (directDemo) {
    header.hidden = true;
    void import("./demo")
      .then(({ DrawDemo }) => startDemo(DrawDemo))
      .catch(() => {
        entrance();
        notify("Не удалось загрузить демо. Попробуйте ещё раз.");
      });
    return;
  }
  entrance();
  try {
    const saved = JSON.parse(read(storage) || "null");
    if (saved && (!invited || saved.code === invited))
      void connect(() => sdk.reconnect(saved.token), true);
    else if (invited) openForm(invited);
  } catch {
    write(storage, "");
  }
}
