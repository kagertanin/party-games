import "./style.css";
import "@fontsource-variable/rubik";
import { Client, type Room } from "colyseus.js";
import {
  act,
  addPlayer,
  createGame,
  speaker,
  tick,
  view,
  type Action,
  type Game,
  type View,
} from "../shared/game";

const app = document.querySelector<HTMLDivElement>("#app")!;
const DEMO_KEY = "party-games.hat.demo.v1";
const CONNECTION_KEY = "party-games.hat.connection";
const endpoint = import.meta.env.VITE_SERVER_URL as string | undefined;
let screen = "home";
let model: Game | null = null;
let live: Room | null = null;
let state: View | null = null;
let modal = "";
let toastTimer: ReturnType<typeof setTimeout>;
let frozen = false;
let freezeAt = 0;
let pending = false;
let serverOffset = 0;
let roomCode = "";
let networkStatus = "";
const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const names = [
  "Шам",
  "Лера",
  "Макс",
  "Аня",
  "Саша",
  "Даша",
  "Илья",
  "Маша",
  "Дима",
  "Катя",
  "Никита",
  "Оля",
];
const sampleWords = [
  "Пингвин",
  "Ипотека",
  "Караоке",
  "Пельмени",
  "Понедельник",
  "Самокат",
  "Космонавт",
  "Дедлайн",
  "Капибара",
  "Будильник",
  "Пляж",
  "Пират",
  "Кактус",
  "Шашлык",
  "Шерлок",
  "Метро",
  "Тапочки",
  "Шаурма",
  "Отпуск",
  "Крокодил",
  "Дракон",
  "Бухгалтер",
  "Снеговик",
  "Диван",
  "Балалайка",
  "Лифт",
  "Банан",
  "Вампир",
  "Кофемашина",
  "Варежки",
  "Пылесос",
  "Водопад",
  "Котлета",
  "Покер",
  "Гитара",
  "Авокадо",
  "Дискотека",
  "Батарейка",
  "Русалка",
  "Борщ",
  "Единорог",
  "Суббота",
  "Аквариум",
  "Шляпа",
  "Хомяк",
  "Интернет",
  "Вулкан",
  "Шахматы",
  "Ниндзя",
  "Коктейль",
  "Рюкзак",
  "Сосиска",
  "Трактор",
  "Парашют",
  "Фламинго",
  "Клавиатура",
  "Печенье",
  "Пинг-понг",
  "Зонтик",
  "Кемпинг",
  "Скейтборд",
  "Карусель",
  "Вафля",
  "Программист",
  "Кукуруза",
  "Казино",
  "Сапоги",
  "Облако",
  "Муравей",
  "Телескоп",
  "Термос",
  "Бармен",
  "Пластилин",
  "Почтальон",
  "Бинокль",
];
const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};
function save() {
  if (model) storage.set(DEMO_KEY, JSON.stringify(model));
}
function message(text: string) {
  document.querySelector(".toast")?.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.role = "status";
  node.textContent = text;
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 4200);
}
function getView() {
  if (model) {
    const viewer = ["ready", "play"].includes(model.phase)
      ? (speaker(model)?.id ?? model.owner)
      : model.owner;
    state = view(model, viewer, Date.now());
  }
  return state!;
}
function startDemo(count = 12) {
  live?.leave();
  live = null;
  networkStatus = "";
  roomCode = "ДЕМО";
  model = createGame("demo-0");
  for (let i = 0; i < count; i++)
    addPlayer(model, `demo-${i}`, names[i] ?? `Гость ${i + 1}`);
  frozen = false;
  save();
  screen = "game";
  render();
}
function resumeDemo() {
  try {
    const saved = JSON.parse(storage.get(DEMO_KEY) ?? "null") as Game | null;
    if (!saved || saved.players.length < 4) throw Error();
    model = saved;
    live = null;
    roomCode = "ДЕМО";
    networkStatus = "";
    frozen = false;
    // Pause the demo while its tab is closed, so the next card remains reviewable.
    if (model.phase === "play")
      model.deadline =
        Date.now() +
        (model.round === 1 ? model.duration1 : model.duration2) * 1000;
    screen = "game";
    render();
  } catch {
    startDemo();
  }
}
function send(action: Action) {
  if (pending) return;
  if (model) {
    try {
      const actor = ["correct", "hint", "skip", "begin"].includes(action.type)
        ? speaker(model)!.id
        : model.owner;
      act(model, actor, action, frozen ? freezeAt : Date.now());
      if (action.type === "start") fillDemoWords();
      save();
      render();
    } catch (e) {
      message((e as Error).message);
    }
  } else if (live) {
    pending = true;
    live.send("action", { id: crypto.randomUUID(), action });
    render();
  }
}
function fillDemoWords() {
  if (!model) return;
  model.players
    .slice(1)
    .forEach((p, i) =>
      act(
        model!,
        p.id,
        { type: "words", words: sampleWords.slice(5 + i * 5, 10 + i * 5) },
        Date.now(),
      ),
    );
}
async function connect(name: string, code?: string) {
  if (!endpoint) {
    modal = "online";
    render();
    return;
  }
  pending = true;
  networkStatus = "Подключаемся…";
  render();
  try {
    const client = new Client(endpoint);
    const room = code
      ? await client.joinById(code.trim().toUpperCase(), { name })
      : await client.create("hat", { name });
    attach(room);
    screen = "game";
    render();
  } catch (e) {
    message(`Не удалось подключиться: ${(e as Error).message}`);
    networkStatus = "";
  } finally {
    pending = false;
    render();
  }
}
function attach(room: Room) {
  model = null;
  live = room;
  roomCode = room.roomId;
  networkStatus = "";
  const remember = () =>
    storage.set(
      CONNECTION_KEY,
      JSON.stringify({ token: room.reconnectionToken, endpoint }),
    );
  remember();
  room.onMessage("view", (data: View) => {
    state = data;
    serverOffset = data.serverTime - Date.now();
    pending = false;
    render();
  });
  room.onMessage("rejected", (text: string) => {
    pending = false;
    message(text);
    render();
  });
  room.onLeave(() => {
    networkStatus = "Связь прервалась";
    pending = false;
    render();
  });
  room.onError((_code, text) => message(text ?? "Ошибка соединения"));
  room.send("sync");
}
async function reconnect() {
  try {
    const data = JSON.parse(storage.get(CONNECTION_KEY) ?? "{}");
    if (!data.token || data.endpoint !== endpoint)
      throw new Error("Нет сохранённой комнаты.");
    const room = await new Client(endpoint!).reconnect(data.token);
    attach(room);
    screen = "game";
    render();
  } catch (e) {
    message("Комната уже закрыта или время возврата истекло.");
  }
}
function hatArt(small = false) {
  return `<div class="hat-art ${small ? "small" : ""}" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="paper paper-one">пингвин</div><div class="paper paper-two">ипотека</div><span class="spark spark-one">✳</span><span class="spark spark-two">✦</span><div class="hat-top"></div><div class="hat-band"></div><div class="hat-brim"></div><div class="art-note">Одно слово.<br>Тысяча ассоциаций.</div><span class="scribble-arrow">↗</span></div>`;
}
function header() {
  return `<header class="topbar"><button class="brand" data-do="home" aria-label="Party Games — главная"><span class="brand-icon">p<span>g</span></span><span>party<span class="brand-light">games</span><i></i></span></button><nav><button class="text-button" data-do="rules">Как играть <span class="help-icon">?</span></button><span class="nav-divider"></span><span class="status-dot"></span><span class="nav-caption">В хорошей компании</span></nav></header>`;
}
function footer() {
  return `<footer><span>Меньше рабочих вкладок. Больше общих историй.</span><span>Сделано для своей компании <span class="little-star">✳</span></span></footer>`;
}
function home() {
  return `${header()}<main class="home"><section class="hero-copy"><div class="eyebrow"><span class="mini-star">✳</span> ВЕЧЕР НАЧИНАЕТСЯ ЗДЕСЬ</div><h1>Всё дело<br>в <span class="title-hat">шляпе<span class="underline"></span></span><span class="title-dot">.</span></h1><p class="hero-lead">Объясни. Запомни. Угадай одним словом.<br>Два круга — и у вашей компании<br class="desktop"> появятся новые внутренние шутки.</p><div class="hero-actions"><a class="primary survey-entry" href="?game=survey">Играть в «Угадай ответ»</a><button class="secondary" data-do="demo">Попробовать «Шляпу»</button></div><div class="hero-details">${endpoint ? '<button class="inline-link" data-do="connect">Создать комнату «Шляпы»</button><b>·</b>' : ""}<span>4–15 игроков</span><b>·</b><span>Без камер</span><b>·</b><span>Два круга</span></div>${storage.get(DEMO_KEY) ? '<button class="resume-link" data-do="resume">↶ Продолжить демопартию</button>' : ""}</section><section class="hero-visual">${hatArt()}<div class="visual-label"><span class="status-dot"></span> ШЛЯПА ПОЛНА ИДЕЙ</div></section><section class="how-strip"><div class="strip-intro"><span class="eyebrow">ПРОЩЕ, ЧЕМ ОБЪЯСНИТЬ<br>«ИПОТЕКУ» ОДНИМ СЛОВОМ</span><button class="inline-link" data-do="rules">Правила за минуту ↗</button></div><div class="strip-step"><span class="step-icon">✎</span><div><h3>Пять слов от каждого</h3><p>Складываем ваши идеи в общую шляпу.</p></div></div><div class="strip-step"><span class="step-icon">↗</span><div><h3>Сначала — как угодно</h3><p>Объясняем своей команде за минуту.</p></div></div><div class="strip-step"><span class="step-icon">1</span><div><h3>Потом — одним словом</h3><p>Те же слова. Совсем другие ассоциации.</p></div></div></section><section class="collection"><div><span class="eyebrow">НАША ИГРОВАЯ ПОЛКА</span><h2>Разные игры. Одна компания.</h2></div><div class="game-links"><a class="shelf-card active survey-entry" href="?game=survey"><span><strong>Угадай ответ</strong><small>Предлагаем и голосуем командой</small></span></a><button class="shelf-card active" data-do="demo"><span class="shelf-symbol">✳</span><span><strong>Шляпа</strong><small>Говорим и угадываем</small></span><span class="shelf-arrow">↗</span></button><div class="shelf-card soon"><span class="shelf-symbol">✎</span><span><strong>Рисовач</strong><small>Рисуем и придумываем</small></span><span class="soon-label">Позже</span></div><div class="shelf-card soon"><span class="shelf-symbol">◒</span><span><strong>Прятки</strong><small>Превращаемся и ищем</small></span><span class="soon-label">Позже</span></div></div></section></main>${footer()}`;
}
function teamIcon(team: number) {
  return ["✳", "◒", "✦", "▧"][team] ?? "✳";
}
function teamCards(v: View) {
  return v.teams
    .map(
      (t, i) =>
        `<section class="team-card team-${i} ${v.activeTeam === i && !["lobby", "words", "results"].includes(v.phase) ? "is-active" : ""}"><div class="team-head"><span class="team-mark">${teamIcon(i)}</span><strong>${t.name}</strong>${["lobby", "words"].includes(v.phase) ? `<span class="team-count">${v.players.filter((p) => p.team === i).length}/4</span>` : `<span class="team-score">${t.score1 + t.score2}</span>`}</div><div class="team-members">${v.players
          .filter((p) => p.team === i)
          .map(
            (p) =>
              `<div class="member"><span class="avatar">${escape(p.name[0])}</span><span>${escape(p.name)}${p.id === v.owner ? ' <span class="owner-crown" title="Создатель комнаты">♔</span>' : ""}</span><span class="member-state">${!p.connected ? "○" : v.phase === "words" && v.readyPlayers.includes(p.id) ? "✓" : p.id === v.speakerId && ["ready", "play"].includes(v.phase) ? "Объясняет" : ""}</span></div>`,
          )
          .join("")}</div></section>`,
    )
    .join("");
}
function owner(v: View) {
  return !!model || v.viewerId === v.owner;
}
function game() {
  if (!state && !model)
    return `${header()}<main class="loading">Подключаемся к комнате…</main>`;
  const v = getView();
  const active = v.teams[v.activeTeam];
  const explainer = v.players.find((p) => p.id === v.speakerId);
  const mine = !!model || v.speakerId === v.viewerId;
  const stages = ["Команды", "Ваши слова", "Объясни", "Одно слово", "Итоги"];
  const stage =
    v.phase === "lobby"
      ? 0
      : v.phase === "words"
        ? 1
        : v.phase === "results"
          ? 4
          : v.round === 1 && v.phase !== "break"
            ? 2
            : 3;
  let content = "";
  if (v.phase === "lobby")
    content = `<div class="stage-heading"><div class="eyebrow">СОБИРАЕМСЯ ЗА ОДНИМ СТОЛОМ</div><h1>Все свои?</h1><p>До четырёх человек в команде.<br>Объясняет один, угадывают остальные.</p></div><div class="lobby-illustration">${hatArt(true)}</div><div class="lobby-settings">${model ? `<label>Участников в демо <select id="player-count">${[4, 6, 8, 10, 12, 15].map((n) => `<option ${v.players.length === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>` : `<p>${v.players.length}/15 участников · общайтесь в вашем созвоне</p>`}<button class="secondary compact" data-do="shuffle" ${!owner(v) ? "disabled" : ""}>⤨ Перемешать команды</button></div><button class="primary wide" data-do="start" ${!owner(v) || v.players.length < 4 ? "disabled" : ""}>Все в сборе, поехали <span>→</span></button><p class="under-button">${model ? "Демо: вы управляете всеми командами на одном экране." : "Создатель комнаты запускает партию, когда все подключились."}</p>`;
  if (v.phase === "words")
    content = `<div class="stage-heading"><div class="eyebrow">СЛОЖИМ ИДЕИ В ШЛЯПУ</div><h1>Твои пять слов</h1><p>Предметы, персонажи, явления — что угодно.<br>Выбирай то, что знакомо всей компании.</p></div>${v.readyPlayers.includes(v.viewerId) ? `<div class="waiting-box"><span>✓</span><h2>Слова уже в шляпе</h2><p>Ждём остальных: ${v.readyPlayers.length} из ${v.players.length} готовы.</p></div>` : `<form id="words-form" class="words-form">${Array.from({ length: 5 }, (_, i) => `<label><span>${i + 1}</span><input aria-label="Слово ${i + 1}" name="word${i}" autocomplete="off" required minlength="2" maxlength="40" placeholder="${["Например, пингвин", "Или ипотека", "Что-то из ваших шуток", "Ещё одно слово", "И последнее"][i]}" value="${escape(v.myWords[i] ?? "")}"></label>`).join("")}<div class="form-footer"><button type="button" class="inline-link" data-do="suggest">Подкинуть идеи ↗</button><span>Без повторов</span></div><button class="primary wide" ${pending ? "disabled" : ""}>Отправить в шляпу <span>↓</span></button></form>`}<p class="under-button">${model ? "Остальные участники демо уже добавили свои слова." : `${v.readyPlayers.length} из ${v.players.length} игроков готовы`}</p>`;
  if (v.phase === "ready")
    content = `<div class="stage-heading"><div class="eyebrow">${v.round === 1 ? "ПЕРВЫЙ КРУГ · ОБЪЯСНЯЕМ" : "ВТОРОЙ КРУГ · ОДНО СЛОВО"}</div><h1>${v.streak ? "Продолжайте!" : "Ваш выход,"}<br>${!v.streak ? `<span class="team-text-${v.activeTeam}">${active.name.toLocaleLowerCase()}.</span>` : `<span class="team-text-${v.activeTeam}">${active.name}</span>`}</h1><p>${v.streak ? "Новая карточка, те же объясняющий и команда." : `Объясняет <strong>${escape(explainer?.name)}</strong>. Остальные в команде угадывают.`}</p></div><div class="turn-instruction"><span class="instruction-symbol">${v.round === 1 ? "↗" : "1"}</span><div><h3>${v.round === 1 ? "Объясняй любыми словами" : "Дай подсказку одним словом"}</h3><p>${v.round === 1 ? "Не называй само слово и однокоренные.<br>За 60 секунд можно угадать несколько карточек." : "На карточку — 20 секунд. Угадали — продолжаете.<br>Не угадали — та же карточка переходит дальше."}</p></div></div>${v.message ? `<p class="event-note">${escape(v.message)}</p>` : ""}${v.round === 2 ? streak(v) : ""}<button class="primary wide" data-do="begin" ${!mine && !owner(v) ? "disabled" : ""}>${mine ? "Готов, покажи слово" : "Ждём объясняющего"} <span>→</span></button><p class="under-button">${v.round === 1 ? "Таймер начнётся после нажатия." : `В шляпе осталось ${v.remaining} ${plural(v.remaining, ["слово", "слова", "слов"])}.`}</p>${hintHistory(v)}`;
  if (v.phase === "play")
    content = `<div class="play-heading"><div><div class="eyebrow">${v.round === 1 ? "ОБЪЯСНЯЕМ · КРУГ 1" : "ОДНО СЛОВО · КРУГ 2"}</div><h2 class="team-text-${v.activeTeam}">${active.name}</h2><p>Объясняет ${escape(explainer?.name)}</p></div><div class="timer" aria-label="Осталось времени"><span id="seconds">${seconds(v)}</span><small>секунд</small></div></div><div class="word-card"><div class="card-corner">${v.round === 1 ? "↗" : "1"}</div><span class="eyebrow">${mine ? "СЛОВО ДЛЯ ТВОЕЙ КОМАНДЫ" : "СЛОВО ВИДИТ ОБЪЯСНЯЮЩИЙ"}</span><h1>${mine ? escape(v.currentWord) : "••••••"}</h1><p>${v.round === 1 ? "Объясняй, не называя слово и однокоренные" : "Только одна новая подсказка из одного слова"}</p><span class="card-bottom-star">✳</span></div>${v.round === 2 ? `${streak(v)}${mine && !v.hints.some((h) => h.team === v.activeTeam && h === v.hints.at(-1)) ? `<form id="hint-form"><label class="hint-label" for="hint">Запиши подсказку, чтобы её не повторили</label><div class="hint-row"><input id="hint" name="hint" maxlength="40" autocomplete="off" placeholder="Одно слово…" required pattern="\\S+"><button class="secondary compact">Дать подсказку ↗</button></div></form>` : '<p class="event-note">Подсказка дана. Теперь слушаем догадки команды.</p>'}` : ""}<div class="answer-actions"><button class="primary" data-do="correct" ${!mine || pending || (v.round === 2 && v.hints.at(-1)?.team !== v.activeTeam) ? "disabled" : ""}>✓ Угадали!</button>${v.round === 1 ? `<button class="secondary" data-do="skip" ${!mine ? "disabled" : ""}>Пропустить ↪</button>` : `<span class="round2-side">Ошибка передаст<br>эту карточку дальше</span>`}</div><div class="play-meta"><span>В шляпе: <strong>${v.remaining}</strong></span>${model ? `<button class="text-button" data-do="pause">${frozen ? "Продолжить" : "Пауза"}</button><button class="text-button" data-do="timeout">Время вышло →</button>` : ""}</div>${hintHistory(v)}`;
  if (v.phase === "break")
    content = `<div class="stage-heading"><div class="eyebrow">ПЕРВЫЙ КРУГ ЗАВЕРШЁН</div><h1>А теперь —<br><span class="title-hat">одним словом.</span></h1><p>Все ${v.selected} угаданных ${plural(v.selected, ["слово", "слова", "слов"])} возвращаются в шляпу.<br>Вспоминайте объяснения и ваши ассоциации.</p></div><div class="round-recap">${v.teams.map((t, i) => `<div><span class="team-text-${i}">${teamIcon(i)} ${t.name}</span><strong>${t.score1}</strong></div>`).join("")}</div><div class="turn-instruction"><span class="instruction-symbol">3</span><div><h3>Серия до трёх ответов</h3><p>Угадываете — ход остаётся у вас. После ошибки<br>или трёх ответов играет следующая команда.</p></div></div><button class="primary wide" data-do="round2" ${!owner(v) ? "disabled" : ""}>Начать второй круг <span>→</span></button><p class="under-button">Первыми играют лидеры первого круга. При равенстве сохраняется порядок.</p>`;
  if (v.phase === "results") {
    const sorted = v.teams
      .map((t, i) => ({ ...t, i, total: t.score1 + t.score2 }))
      .sort((a, b) => b.total - a.total);
    const winners = sorted.filter((t) => t.total === sorted[0].total);
    content = `<div class="stage-heading"><span class="results-star">✳</span><div class="eyebrow">ШЛЯПА ОПУСТЕЛА</div><h1>${winners.length > 1 ? "Победила дружба!" : `${sorted[0].name}<br>берут шляпу!`}</h1><p>${v.message && !v.selected ? escape(v.message) : "Слова закончились. Ваши новые шутки — ещё нет."}</p></div><div class="result-table"><div class="result-row result-labels"><span>Команда</span><span>Круг 1</span><span>Круг 2</span><span>Всего</span></div>${sorted.map((t) => `<div class="result-row"><strong class="team-text-${t.i}">${teamIcon(t.i)} ${t.name}</strong><span>${t.score1}</span><span>${t.score2}</span><strong>${t.total}</strong></div>`).join("")}</div>${v.unresolved.length ? `<p class="under-button">Отложены без очков: ${v.unresolved.map(escape).join(", ")}.</p>` : ""}<button class="primary wide" data-do="replay" ${!owner(v) ? "disabled" : ""}>Сыграть ещё <span>↻</span></button><button class="text-button back-home" data-do="home">На игровую полку ↗</button>`;
  }
  return `${header()}<div class="room-bar"><div><span class="status-dot"></span><span>${model ? "Демопартия" : `Комната ${escape(roomCode)}`}</span><span class="bar-divider">/</span><span>${v.players.length} игроков</span></div><div>${model ? '<span class="demo-badge">Управляете всеми командами</span>' : `<button class="text-button" data-do="copy">Пригласить ⧉</button>`}<button class="text-button exit-button" data-do="exit">Выйти ↗</button></div></div>${networkStatus ? `<div class="connection-alert">${escape(networkStatus)} <button data-do="reconnect">Вернуться в комнату</button></div>` : ""}<main class="game-layout"><aside class="sidebar"><div class="sidebar-title"><span class="eyebrow">ЗА СТОЛОМ</span><span>${v.players.length}</span></div>${teamCards(v)}<button class="sidebar-rules" data-do="rules"><span>?</span><div>Забыли правило?<small>Всё поместится на минуту</small></div><b>↗</b></button></aside><section class="game-main"><div class="progress">${stages.map((s, i) => `<span class="${i === stage ? "current" : i < stage ? "done" : ""}"><i>${i < stage ? "✓" : i + 1}</i><b>${s}</b></span>`).join("")}</div><div class="game-content ${v.phase === "play" ? "playing" : ""}">${content}</div></section><aside class="game-side-note"><span>✳</span><p>Хорошая подсказка —<br>та, которую поймут<br>именно ваши.</p></aside></main>${footer()}`;
}
function plural(n: number, forms: string[]) {
  return n % 10 === 1 && n % 100 !== 11
    ? forms[0]
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? forms[1]
      : forms[2];
}
function streak(v: View) {
  return `<div class="streak"><span>Серия команды</span><div>${[1, 2, 3].map((i) => `<i class="${v.streak >= i ? "filled" : ""}">${v.streak >= i ? "✓" : i}</i>`).join("")}</div><span>${v.streak} из 3</span></div>`;
}
function hintHistory(v: View) {
  return v.round === 2 && v.hints.length
    ? `<section class="hint-history"><span class="eyebrow">УЖЕ ПРОЗВУЧАЛО</span><div>${v.hints.map((h) => `<span class="hint-pill team-text-${h.team}">${teamIcon(h.team)} ${escape(h.text)}</span>`).join("")}</div></section>`
    : "";
}
function seconds(v: View) {
  return Math.max(
    0,
    Math.ceil(
      (v.deadline -
        (frozen ? freezeAt : Date.now() + (model ? 0 : serverOffset))) /
        1000,
    ),
  );
}
function dialog() {
  if (!modal) return "";
  let body = "";
  if (modal === "rules")
    body = `<div class="eyebrow">ПРАВИЛА ЗА МИНУТУ</div><h2>Всё в шляпе.</h2><div class="rule-item"><b>✎</b><div><h3>Добавьте по пять слов</h3><p>До 15 игроков, команды по 2–4 человека. Слова знакомы всей компании и не повторяются.</p></div></div><div class="rule-item"><b>↗</b><div><h3>Первый круг — 60 секунд</h3><p>Каждая команда играет один ход. Объясняйте без самого слова и однокоренных. Пропуск возвращает карточку в шляпу.</p></div></div><div class="rule-item"><b>1</b><div><h3>Второй круг — одно слово</h3><p>В шляпе только угаданные слова. 20 секунд на ответ. Подсказку запишите и произнесите, её нельзя повторять. Угадали — новая карточка и продолжение серии.</p></div></div><div class="rule-item"><b>3</b><div><h3>Три подряд — передай ход</h3><p>После ошибки передаётся та же карточка. После трёх ответов — следующая. Начинают лидеры первого круга. За каждое слово — одно очко.</p></div></div><div class="rules-fine">После двух полных кругов без ответа карточку откладываем без очков. Объясняющий меняется при передаче хода, но остаётся прежним, если та же карточка вернулась к команде. Все слушают соперников. Разговаривайте в вашем созвоне.</div><button class="primary wide" data-do="close">Всё понятно <span>✓</span></button>`;
  if (modal === "connect" || modal === "online")
    body = `<div class="eyebrow">СОБЕРИТЕ СВОИХ</div><h2>${endpoint ? "Ваша комната" : "Сначала попробуем?"}</h2>${!endpoint ? `<p class="dialog-lead">На этой версии можно пройти всю «Шляпу», управляя командами на одном экране.</p><div class="info-card"><strong>Сетевая игра — следующий этап</strong><p>Подключение друзей по ссылке станет доступно после размещения игрового сервера.</p></div><button class="primary wide" data-do="demo">Начать демопартию <span>↗</span></button>` : `<form id="connect-form"><label class="field-label">Как тебя зовут?<input name="name" required maxlength="24" placeholder="Имя или прозвище" autocomplete="nickname"></label><label class="field-label">Код комнаты, если пригласили<input name="code" maxlength="32" placeholder="Оставь пустым, чтобы создать свою" value="${escape(new URLSearchParams(location.search).get("room") ?? "")}"></label><button class="primary wide" ${pending ? "disabled" : ""}>Войти в игру <span>→</span></button></form>${storage.get(CONNECTION_KEY) ? '<button class="resume-link" data-do="reconnect">↶ Вернуться в прошлую комнату</button>' : ""}`}`;
  if (modal === "exit")
    body = `<div class="eyebrow">ДО СЛЕДУЮЩЕГО ХОДА</div><h2>Выйти из партии?</h2><p class="dialog-lead">${model ? "Демопартия сохранится в этом браузере. Продолжить можно с главной." : "Ваше место сохранится на время переподключения. Вернуться можно с этого устройства."}</p><button class="primary wide" data-do="leave">Выйти <span>↗</span></button><button class="secondary wide" data-do="close">Остаться</button>`;
  return `<div class="modal-backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-label="${modal === "rules" ? "Правила Шляпы" : "Комната"}"><button class="close-button" data-do="close" aria-label="Закрыть">×</button>${body}</section></div>`;
}
let previousStage = "";
function render() {
  const stageKey = `${screen}-${model?.phase ?? state?.phase ?? ""}`;
  if (stageKey !== previousStage) {
    window.scrollTo({ top: 0 });
    previousStage = stageKey;
  }
  app.innerHTML = (screen === "home" ? home() : game()) + dialog();
  app.innerHTML = app.innerHTML.replaceAll(
    "↗",
    '<span class="arrow-diag" aria-hidden="true"></span>',
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-do]")
    .forEach((el) =>
      el.addEventListener("click", () => handle(el.dataset.do!)),
    );
  document
    .querySelector<HTMLSelectElement>("#player-count")
    ?.addEventListener("change", (e) =>
      startDemo(Number((e.target as HTMLSelectElement).value)),
    );
  document
    .querySelector<HTMLFormElement>("#words-form")
    ?.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget! as HTMLFormElement);
      send({
        type: "words",
        words: Array.from({ length: 5 }, (_, i) => data.get(`word${i}`)),
      });
    });
  document
    .querySelector<HTMLFormElement>("#hint-form")
    ?.addEventListener("submit", (e) => {
      e.preventDefault();
      send({
        type: "hint",
        text: new FormData(e.currentTarget! as HTMLFormElement).get("hint"),
      });
    });
  document
    .querySelector<HTMLFormElement>("#connect-form")
    ?.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget! as HTMLFormElement);
      void connect(
        String(data.get("name")),
        String(data.get("code")) || undefined,
      ).then(() => {
        modal = "";
        render();
      });
    });
  if (modal) {
    const focus = document.querySelector<HTMLElement>(
      ".dialog input, .dialog .primary",
    );
    focus?.focus();
  }
}
function handle(action: string) {
  if (
    [
      "start",
      "shuffle",
      "begin",
      "correct",
      "skip",
      "round2",
      "replay",
    ].includes(action)
  ) {
    send({ type: action });
    return;
  }
  switch (action) {
    case "demo":
      modal = "";
      startDemo();
      break;
    case "resume":
      resumeDemo();
      break;
    case "home":
      if (screen === "game") {
        modal = "exit";
        render();
      } else {
        screen = "home";
        render();
      }
      break;
    case "leave":
      if (model) save();
      else {
        storage.set(
          CONNECTION_KEY,
          JSON.stringify({ token: live?.reconnectionToken, endpoint }),
        );
        live?.connection.close();
        live = null;
        state = null;
      }
      model = null;
      screen = "home";
      modal = "";
      render();
      break;
    case "rules":
      modal = "rules";
      render();
      break;
    case "connect":
      modal = "connect";
      render();
      break;
    case "close":
      modal = "";
      render();
      break;
    case "exit":
      modal = "exit";
      render();
      break;
    case "suggest":
      document
        .querySelectorAll<HTMLInputElement>(".words-form input")
        .forEach((el, i) => {
          el.value = sampleWords[i];
        });
      break;
    case "timeout":
      if (model && model.phase === "play") {
        frozen = false;
        tick(model, model.deadline);
        save();
        render();
      }
      break;
    case "pause":
      if (model) {
        if (frozen) {
          model.deadline += Date.now() - freezeAt;
          frozen = false;
        } else {
          freezeAt = Date.now();
          frozen = true;
        }
        save();
        render();
      }
      break;
    case "copy":
      navigator.clipboard
        ?.writeText(`${location.origin}/?room=${encodeURIComponent(roomCode)}`)
        .then(() => message("Ссылка скопирована"))
        .catch(() => message(`Код комнаты: ${roomCode}`));
      break;
    case "reconnect":
      modal = "";
      void reconnect();
      break;
  }
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal) {
    modal = "";
    render();
  }
  if (e.key === "Tab" && modal) {
    const items = Array.from(
      document.querySelectorAll<HTMLElement>(".dialog button, .dialog input"),
    );
    const first = items[0],
      last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
});
setInterval(() => {
  if (screen !== "game") return;
  if (model && !frozen && tick(model, Date.now())) {
    save();
    render();
    return;
  }
  if (state?.phase === "play") {
    const el = document.querySelector("#seconds");
    if (el) {
      const left = seconds(state);
      el.textContent = String(left);
      el.parentElement?.classList.toggle("urgent", left <= 5);
    }
  }
}, 200);
const params = new URLSearchParams(location.search);
if (params.get("game") === "survey") {
  void import("./survey/demo").then(({ mountSurveyDemo }) => mountSurveyDemo(app));
} else {
  if (endpoint && params.has("room")) modal = "connect";
  render();
}
