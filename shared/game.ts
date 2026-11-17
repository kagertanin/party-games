export type Phase = "lobby" | "words" | "ready" | "play" | "break" | "results";
export interface Player {
  id: string;
  name: string;
  team: number;
  connected: boolean;
  words: string[];
}
export interface Team {
  name: string;
  score1: number;
  score2: number;
  speaker: number;
}
export interface Card {
  id: number;
  word: string;
}
export interface Hint {
  team: number;
  text: string;
}
export interface Game {
  phase: Phase;
  owner: string;
  players: Player[];
  teams: Team[];
  round: 1 | 2;
  activeTeam: number;
  order: number[];
  turn: number;
  streak: number;
  deck: Card[];
  guessed: Card[];
  current: Card | null;
  deadline: number;
  duration1: number;
  duration2: number;
  hints: Hint[];
  attempts: number;
  exposed: Record<number, string>;
  unresolved: string[];
  message: string;
  revision: number;
}
export type Action = { type: string; [key: string]: unknown };
export const TEAM_NAMES = ["Зелёные", "Апельсины", "Сиреневые", "Синие"];
export const normalize = (s: string) =>
  s.trim().toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ");
export function createGame(owner: string): Game {
  return {
    phase: "lobby",
    owner,
    players: [],
    teams: [],
    round: 1,
    activeTeam: 0,
    order: [],
    turn: 0,
    streak: 0,
    deck: [],
    guessed: [],
    current: null,
    deadline: 0,
    duration1: 60,
    duration2: 20,
    hints: [],
    attempts: 0,
    exposed: {},
    unresolved: [],
    message: "",
    revision: 0,
  };
}
export function addPlayer(g: Game, id: string, name: string) {
  if (g.phase !== "lobby")
    throw new Error("Партия уже началась. Дождитесь следующей.");
  if (g.players.length >= 15) throw new Error("В комнате уже 15 игроков.");
  const clean = name.trim().slice(0, 24);
  if (!clean) throw new Error("Введите имя.");
  if (g.players.some((p) => p.id === id)) throw new Error("Вы уже в комнате.");
  g.players.push({ id, name: clean, team: 0, connected: true, words: [] });
  balanceTeams(g);
  g.revision++;
}
export function balanceTeams(g: Game) {
  const count = Math.max(2, Math.ceil(g.players.length / 4));
  g.teams = Array.from({ length: count }, (_, i) => ({
    name: TEAM_NAMES[i],
    score1: 0,
    score2: 0,
    speaker: 0,
  }));
  g.players.forEach((p, i) => {
    p.team = i % count;
  });
  g.order = g.teams.map((_, i) => i);
}
export function members(g: Game, team: number) {
  return g.players.filter((p) => p.team === team);
}
export function speaker(g: Game) {
  const list = members(g, g.activeTeam);
  return list[g.teams[g.activeTeam]?.speaker % list.length];
}
function shuffle<T>(list: T[], random: () => number) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function nextSpeaker(g: Game, team: number) {
  g.teams[team].speaker = (g.teams[team].speaker + 1) % members(g, team).length;
}
function finish(g: Game) {
  g.phase = "results";
  g.current = null;
  g.deadline = 0;
}
function nextTeam(g: Game) {
  g.turn++;
  g.activeTeam = g.order[g.turn % g.order.length];
  g.streak = 0;
  // A failed card keeps the same explainer when it returns to their team.
  const known = g.exposed[g.activeTeam];
  if (known)
    g.teams[g.activeTeam].speaker = members(g, g.activeTeam).findIndex(
      (p) => p.id === known,
    );
  else nextSpeaker(g, g.activeTeam);
  g.phase = "ready";
  g.deadline = 0;
}
function finishFirstTurn(g: Game) {
  if (g.current) {
    g.deck.push(g.current);
    g.current = null;
  }
  g.deadline = 0;
  g.turn++;
  if (g.turn >= g.teams.length || !g.deck.length) {
    g.phase = g.guessed.length ? "break" : "results";
    g.message = g.guessed.length
      ? "В шляпу вернутся только угаданные слова."
      : "Ни одного угаданного слова. Сыграем ещё?";
  } else {
    g.activeTeam = g.order[g.turn];
    g.phase = "ready";
  }
}
export function tick(g: Game, now: number) {
  if (g.phase !== "play" || now < g.deadline) return false;
  if (g.round === 1) finishFirstTurn(g);
  else {
    g.attempts++;
    if (g.attempts >= g.teams.length * 2) {
      g.unresolved.push(g.current!.word);
      g.current = null;
      g.hints = [];
      g.exposed = {};
      g.attempts = 0;
      g.message = "Два полных круга без ответа — карточка отложена без очков.";
    } else g.message = "Время вышло. Та же карточка — следующей команде.";
    if (!g.current && !g.deck.length) finish(g);
    else nextTeam(g);
  }
  g.revision++;
  return true;
}
export function act(
  g: Game,
  actor: string,
  action: Action,
  now: number,
  random = Math.random,
) {
  tick(g, now);
  const player = g.players.find((p) => p.id === actor);
  if (!player) throw new Error("Игрок не найден.");
  const host = actor === g.owner;
  const explains = speaker(g)?.id === actor;
  switch (action.type) {
    case "shuffle": {
      if (!host || g.phase !== "lobby")
        throw new Error("Команды перемешивает создатель комнаты.");
      g.players = shuffle(g.players, random);
      balanceTeams(g);
      break;
    }
    case "start": {
      if (!host || g.phase !== "lobby")
        throw new Error("Партию запускает создатель комнаты.");
      if (g.players.length < 4 || g.players.some((p) => !p.connected))
        throw new Error("Нужно хотя бы 4 подключённых игрока.");
      g.phase = "words";
      break;
    }
    case "words": {
      if (g.phase !== "words") throw new Error("Сбор слов уже завершён.");
      if (
        !Array.isArray(action.words) ||
        action.words.length !== 5 ||
        action.words.some((w) => typeof w !== "string")
      )
        throw new Error("Нужно пять слов.");
      const words = (action.words as string[]).map((w) =>
        w.trim().replace(/\s+/g, " "),
      );
      if (words.some((w) => w.length < 2 || w.length > 40))
        throw new Error("Каждое слово — от 2 до 40 символов.");
      const others = g.players
        .filter((p) => p.id !== actor)
        .flatMap((p) => p.words)
        .map(normalize);
      const keys = words.map(normalize);
      if (new Set(keys).size < 5 || keys.some((w) => others.includes(w)))
        throw new Error("Есть повтор. Замените совпавшее слово.");
      player.words = words;
      if (g.players.every((p) => p.words.length === 5)) {
        g.deck = shuffle(
          g.players.flatMap((p) => p.words).map((word, id) => ({ word, id })),
          random,
        );
        g.phase = "ready";
        g.message =
          "Первый круг: объясняйте любыми словами, кроме однокоренных.";
      }
      break;
    }
    case "begin": {
      if (g.phase !== "ready" || (!explains && !host))
        throw new Error("Сейчас ход другой команды.");
      if (!g.current) {
        g.current = g.deck.shift() ?? null;
        g.hints = [];
        g.exposed = {};
        g.attempts = 0;
      }
      if (!g.current) {
        finish(g);
        break;
      }
      g.exposed[g.activeTeam] = speaker(g).id;
      g.phase = "play";
      g.deadline = now + (g.round === 1 ? g.duration1 : g.duration2) * 1000;
      g.message = "";
      break;
    }
    case "hint": {
      if (g.phase !== "play" || g.round !== 2 || !explains)
        throw new Error("Подсказку даёт объясняющий.");
      const hint = typeof action.text === "string" ? action.text.trim() : "";
      if (!hint || hint.length > 40 || /\s/.test(hint))
        throw new Error("Подсказка — ровно одно слово.");
      if (g.hints.some((h) => normalize(h.text) === normalize(hint)))
        throw new Error("Эта подсказка уже была.");
      if (normalize(hint) === normalize(g.current!.word))
        throw new Error("Нельзя называть загаданное слово.");
      if (
        g.hints.some((h) => h.team === g.activeTeam && h === g.hints.at(-1))
      ) {
        // A team may hint again only after the card has visited another team.
        throw new Error("Подсказка уже дана. Ждите ответа команды.");
      }
      g.hints.push({ team: g.activeTeam, text: hint });
      break;
    }
    case "correct": {
      if (g.phase !== "play" || !explains)
        throw new Error("Ответ отмечает объясняющий во время хода.");
      if (g.round === 2 && g.hints.at(-1)?.team !== g.activeTeam)
        throw new Error("Сначала дайте подсказку одним словом.");
      const team = g.teams[g.activeTeam];
      if (g.round === 1) {
        team.score1++;
        g.guessed.push(g.current!);
        g.current = g.deck.shift() ?? null;
        if (!g.current) finishFirstTurn(g);
      } else {
        team.score2++;
        g.streak++;
        g.current = null;
        g.hints = [];
        g.exposed = {};
        g.attempts = 0;
        if (!g.deck.length) finish(g);
        else if (g.streak >= 3) {
          g.message = "Три подряд! Следующая карточка — другой команде.";
          nextTeam(g);
        } else {
          g.phase = "ready";
          g.deadline = 0;
          g.message = "Угадали! Ваша команда продолжает серию.";
        }
      }
      break;
    }
    case "skip": {
      if (g.phase !== "play" || g.round !== 1 || !explains)
        throw new Error("Пропуск доступен в первом круге.");
      g.deck.push(g.current!);
      g.current = g.deck.shift()!;
      break;
    }
    case "round2": {
      if (!host || g.phase !== "break")
        throw new Error("Второй круг начинает создатель комнаты.");
      g.round = 2;
      g.deck = shuffle(g.guessed, random);
      g.current = null;
      g.order.sort((a, b) => g.teams[b].score1 - g.teams[a].score1 || a - b);
      g.turn = 0;
      g.activeTeam = g.order[0];
      g.streak = 0;
      g.teams.forEach((_, i) => nextSpeaker(g, i));
      g.phase = "ready";
      g.message = "Теперь объясняйте одним словом.";
      break;
    }
    case "replay": {
      if (!host || g.phase !== "results")
        throw new Error("Новую партию начинает создатель комнаты.");
      const revision = g.revision;
      Object.assign(g, createGame(g.owner), {
        revision,
        players: g.players
          .filter((p) => p.connected)
          .map((p) => ({ ...p, words: [] })),
      });
      balanceTeams(g);
      break;
    }
    default:
      throw new Error("Неизвестное действие.");
  }
  g.revision++;
}
export interface View extends Omit<
  Game,
  "deck" | "guessed" | "current" | "players" | "exposed"
> {
  players: Omit<Player, "words">[];
  readyPlayers: string[];
  myWords: string[];
  currentWord: string | null;
  remaining: number;
  selected: number;
  speakerId: string | null;
  serverTime: number;
  viewerId: string;
}
export function view(g: Game, viewerId: string, now: number): View {
  const { deck, guessed, current, players, exposed, ...publicState } = g;
  const explaining = speaker(g);
  return {
    ...publicState,
    players: players.map(({ words, ...p }) => p),
    readyPlayers: players.filter((p) => p.words.length === 5).map((p) => p.id),
    myWords: players.find((p) => p.id === viewerId)?.words ?? [],
    currentWord:
      g.phase === "play" && explaining?.id === viewerId
        ? (current?.word ?? null)
        : null,
    remaining: deck.length + (current ? 1 : 0),
    selected: guessed.length,
    speakerId: explaining?.id ?? null,
    serverTime: now,
    viewerId,
  };
}
