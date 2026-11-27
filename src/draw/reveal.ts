import type { DrawView, RevealAward, RevealFrame } from "../../shared/draw";
import { escape } from "../rooms/ui";

const ru = new Intl.PluralRules("ru");
const plural = (n: number, one: string, few: string, many: string) =>
  (({ one, few, many }) as Record<string, string>)[ru.select(n)] || many;
export function mountReveal(root: HTMLElement, v: DrawView, picture: string) {
  root.innerHTML = `<div class="draw-recap"><div class="recap-rail"><figure class="recap-picture">${picture}</figure>
    <aside class="draw-ranking" hidden><h2>Таблица очков</h2><ol></ol></aside></div>
    <section class="recap-answers"><header hidden><span>Рисунок ${v.turn + 1} из ${v.total}</span><h1>Подсчёт итогов</h1></header>
    <ol class="answer-trail" aria-live="polite" aria-relevant="additions text"></ol></section></div>`;
  const trail = root.querySelector<HTMLOListElement>(".answer-trail")!;
  const tiles = new Map<number, HTMLElement>();
  const ranking = root.querySelector<HTMLOListElement>(".draw-ranking ol")!;
  const players = new Map(v.players.map((p) => [p.id, p]));
  const who = (id: string) => escape(players.get(id)?.name ?? "Игрок");
  let last = "";
  const rows = new Map<string, HTMLElement>();
  let animations: Animation[] = [];
  let settlements: ReturnType<typeof setTimeout>[] = [];
  function reason(a: RevealAward) {
    if (a.reason === "artist") return "художнику";
    if (a.reason === "fooled") return "за убедительную подпись";
    return a.bonus
      ? `за разгадку, включая +${a.bonus} за серию`
      : "за разгадку";
  }
  function showAnswer(f: RevealFrame, fresh: boolean) {
    if (f.kind === "opening") return;
    let tile = tiles.get(f.step);
    if (tile?.dataset.kind === f.kind) return tile;
    if (!tile) {
      tile = document.createElement("li");
      tiles.set(f.step, tile);
      tile.innerHTML = '<h2></h2><div class="answer-details"></div>';
      tile.querySelector("h2")!.textContent = f.titles[0].text;
      trail.append(tile);
      if (fresh) tile.classList.add("new-answer");
    }
    const o = f.titles[0];
    tile.dataset.kind = f.kind;
    const voters = o.voters.map(who).join(", ");
    const credits = f.awards
      .map(
        (a) =>
          `<span data-credit="${escape(a.player)}"><b>+${a.amount}</b> ${who(a.player)} <small>${reason(a)}</small></span>`,
      )
      .join("");
    const author = o.author
      ? `<p class="answer-author">${f.kind === "truth" ? "Исходная фраза · Художник" : "Автор подписи"} <strong>${who(o.author)}</strong></p>`
      : "";
    tile.querySelector(".answer-details")!.innerHTML =
      `${author}<p class="answer-votes"><b>${o.voters.length} ${plural(o.voters.length, "голос", "голоса", "голосов")}</b>${voters ? " · " + voters : ""}${o.likes ? ` <span class="answer-hearts">♥ ${o.likes}</span>` : ""}</p>${credits ? `<div class="draw-awards">${credits}</div>` : ""}`;
    if (fresh && f.kind !== "suspense")
      tile.querySelector(".answer-details")!.classList.add("ink-in");
    return tile;
  }
  function update(next: DrawView) {
    const f = next.reveal!;
    if (f.kind === "opening") return;
    const key = f.step + "." + f.kind;
    if (last === key) return;
    const fresh = next.now - next.startedAt < 900;
    last = key;
    settlements.forEach(clearTimeout);
    settlements = [];
    animations.forEach((a) => a.cancel());
    animations = [];
    root.querySelector<HTMLElement>(".draw-ranking")!.hidden = false;
    root.querySelector<HTMLElement>(".recap-answers header")!.hidden = false;
    const old = new Map(
      [...rows].map(([id, row]) => [id, row.getBoundingClientRect().top]),
    );
    const sorted = [...next.players].sort((a, b) => b.points - a.points);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = fresh && !reduce;
    sorted.forEach((p, i) => {
      let row = rows.get(p.id);
      if (!row) {
        row = document.createElement("li");
        row.innerHTML =
          '<span class="rank-place"></span><span class="rank-name"></span><strong></strong>';
        rows.set(p.id, row);
      }
      row.children[0].textContent = String(i + 1);
      row.children[1].textContent = p.name;
      const awardIndex = f.awards.findIndex((a) => a.player === p.id);
      const amount = f.awards[awardIndex]?.amount ?? 0;
      const score = row.children[2];
      score.textContent = (
        animate ? p.points - amount : p.points
      ).toLocaleString("ru-RU");
      if (animate && amount)
        settlements.push(
          setTimeout(
            () => {
              score.textContent = p.points.toLocaleString("ru-RU");
              animations.push(
                score.animate(
                  [{ transform: "scale(1.22)" }, { transform: "scale(1)" }],
                  { duration: 300 },
                ),
              );
            },
            1000 + awardIndex * 45,
          ),
        );
      row.classList.toggle("rank-gain", Boolean(amount));
      ranking.append(row);
    });
    for (const frame of next.revealed ?? []) {
      if (
        !tiles.has(frame.step) ||
        tiles.get(frame.step)?.dataset.kind === "suspense"
      )
        showAnswer(frame, false);
    }
    const card = showAnswer(f, animate)!;
    if (!animate) return;
    rows.forEach((row, id) => {
      const before = old.get(id),
        now = row.getBoundingClientRect().top;
      if (before !== undefined && Math.abs(before - now) > 1)
        animations.push(
          row.animate(
            [
              { transform: `translateY(${before - now}px)` },
              { transform: "translateY(0)" },
            ],
            { duration: 480, easing: "ease-out" },
          ),
        );
    });
    card.querySelectorAll<HTMLElement>("[data-credit]").forEach((credit, i) => {
      const target = rows.get(credit.dataset.credit!)!.lastElementChild!;
      const to = target.getBoundingClientRect(),
        from = credit.querySelector("b")!.getBoundingClientRect();
      if (!from.width || !to.width) return;
      const token = document.createElement("b");
      token.className = "draw-flying-credit";
      token.textContent = credit.querySelector("b")!.textContent;
      token.setAttribute("aria-hidden", "true");
      root.append(token);
      token.style.left = from.left + "px";
      token.style.top = from.top + "px";
      const flight = token.animate(
        [
          { opacity: 0, transform: "translate(0,0) scale(.9)" },
          { opacity: 1, offset: 0.15 },
          { opacity: 1, offset: 0.8 },
          {
            opacity: 0,
            transform: `translate(${to.left - from.left}px,${to.top - from.top}px) scale(.75)`,
          },
        ],
        {
          duration: 750,
          delay: 250 + i * 45,
          easing: "cubic-bezier(.42,0,.38,1)",
          fill: "both",
        },
      );
      flight.onfinish = flight.oncancel = () => token.remove();
      animations.push(flight);
    });
  }
  update(v);
  return update;
}
