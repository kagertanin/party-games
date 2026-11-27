import { playSound } from "../audio/sound";
import type { DrawView, RevealAward, RevealFrame } from "../../shared/draw";
import { avatarMarkup } from "./avatar";
import { escape } from "../rooms/ui";

const fmt = (value: number) => value.toLocaleString("ru-RU");
const flightDuration = 2000;

function awardReason(a: RevealAward) {
  if (a.reason === "artist") return "художнику за разгадки";
  if (a.reason === "fooled") return "за убедительную подпись";
  return a.bonus ? `за разгадку, включая +${a.bonus} за серию` : "за разгадку";
}

export function mountReveal(
  root: HTMLElement,
  v: DrawView,
  picture: string,
  like: (id: string, liked: boolean) => void,
) {
  root.innerHTML = `<div class="draw-recap">
    <header class="recap-heading" aria-hidden="true"><span>Рисунок ${v.turn + 1} из ${v.total}</span>
    <h1>Подсчёт итогов</h1><p class="review-window" hidden>Отметь любимые фразы <b class="draw-clock" aria-label="Осталось времени на сердечки"></b></p></header>
    <div class="recap-rail"><figure class="recap-picture">${picture}</figure>
    <aside class="draw-ranking" hidden><h2>Таблица очков</h2><ol></ol></aside></div>
    <section class="recap-answers"><ol class="answer-trail" aria-live="polite" aria-relevant="additions text"></ol></section></div>`;
  const board = root.querySelector<HTMLOListElement>(".answer-trail")!;
  const ranking = root.querySelector<HTMLOListElement>(".draw-ranking ol")!;
  const people = new Map(v.players.map((p) => [p.id, p]));
  const name = (id: string) => escape(people.get(id)?.name ?? "Игрок");
  const tiles = new Map<number, HTMLElement>();
  const rows = new Map<string, HTMLElement>();
  let last = "";
  const flights = new Set<Animation>();
  function dispose() {
    for (const flight of flights) flight.cancel();
    flights.clear();
  }

  function drawTile(frame: RevealFrame, animate: boolean) {
    if (frame.step < 0) return;
    const title = frame.titles[0];
    let tile = tiles.get(frame.step);
    if (!tile) {
      tile = document.createElement("li");
      const height = Math.ceil(frame.total / 2),
        right = Math.floor(frame.total / 2);
      const onRight = frame.step < right;
      tile.style.setProperty("--col", onRight ? "2" : "1");
      tile.style.setProperty(
        "--row",
        String(height - (onRight ? frame.step : frame.step - right)),
      );
      tile.style.setProperty("--single-row", String(frame.total - frame.step));
      tile.innerHTML = `<div class="answer-card"><div class="answer-bubble">
        <h2>${escape(title.text)}</h2><div class="voter-marks"></div></div></div>
        <div class="draw-awards"></div>`;
      // Keep DOM/tab order in final reading order even as the visual board fills upwards.
      board.prepend(tile);
      if (animate) tile.classList.add("new-answer");
      tiles.set(frame.step, tile);
    }
    const marks = tile.querySelector<HTMLElement>(".voter-marks")!;
    for (const id of title.voters.slice(marks.childElementCount)) {
      const stamp = document.createElement("span");
      stamp.dataset.voter = id;
      stamp.innerHTML = `<i aria-hidden="true">✓</i>${name(id)}`;
      if (animate) stamp.className = "new-vote";
      marks.append(stamp);
    }
    if (
      tile.dataset.kind === frame.kind ||
      (frame.kind === "ballots" && tile.dataset.kind)
    )
      return;
    tile.dataset.kind = frame.kind;
    if (!title.author) return;
    const author = people.get(title.author);
    const signature = document.createElement("div");
    signature.className = "answer-signature";
    signature.setAttribute("aria-label", "Автор фразы");
    signature.innerHTML = `${author ? avatarMarkup(author) : ""}<strong>${name(title.author)}</strong>`;
    tile.querySelector(".answer-card")!.prepend(signature);
    if (frame.kind === "truth") {
      const label = document.createElement("small");
      label.className = "original-phrase";
      label.textContent = "Исходная фраза";
      tile.querySelector(".answer-bubble")!.prepend(label);
    }
    const totals = new Map<string, { award: RevealAward; amount: number }>();
    for (const award of frame.awards) {
      const entry = totals.get(award.player);
      if (entry) entry.amount += award.amount;
      else totals.set(award.player, { award, amount: award.amount });
    }
    const awards = tile.querySelector<HTMLElement>(".draw-awards")!;
    awards.innerHTML = [...totals.values()]
      .map(
        ({ award, amount }) =>
          `<span><b>+${fmt(amount)}</b> ${name(award.player)} <small>${awardReason(award)}</small></span>`,
      )
      .join("");
    if (animate) {
      signature.classList.add("ink-in");
      awards.classList.add("ink-in");
    }
  }

  function paintRanking(next: DrawView, scores: Map<string, number>) {
    const sorted = [...next.players].sort(
      (a, b) => scores.get(b.id)! - scores.get(a.id)!,
    );
    for (const [index, player] of sorted.entries()) {
      let row = rows.get(player.id);
      if (!row) {
        row = document.createElement("li");
        row.innerHTML =
          '<span class="rank-place"></span><span class="rank-name"></span><strong></strong>';
        row.children[1].textContent = player.name;
        rows.set(player.id, row);
      }
      row.children[0].textContent = String(index + 1);
      row.children[2].textContent = fmt(scores.get(player.id)!);
      ranking.append(row);
    }
  }

  function score(next: DrawView, frame: RevealFrame, animate: boolean) {
    const scores = new Map(next.players.map((p) => [p.id, p.points]));
    if (animate)
      for (const a of frame.awards)
        scores.set(a.player, scores.get(a.player)! - a.amount);
    paintRanking(next, scores);
    if (!animate || !frame.awards.length) return;
    const card = tiles.get(frame.step)!;
    let landed = 0;
    // Keep the target rows still until every token from this answer has landed.
    frame.awards.forEach((a, index) => {
      const from = card
        .querySelector<HTMLElement>(`[data-voter="${CSS.escape(a.voter)}"] i`)!
        .getBoundingClientRect();
      const row = rows.get(a.player)!;
      const target = row.children[2].getBoundingClientRect();
      const dx = target.left + target.width / 2 - from.left - from.width / 2;
      const dy = target.top + target.height / 2 - from.top - from.height / 2;
      const chip = document.createElement("b");
      chip.className = "draw-flying-credit";
      chip.setAttribute("aria-hidden", "true");
      chip.textContent = "+" + fmt(a.amount);
      chip.style.left = from.left + from.width / 2 + "px";
      chip.style.top = from.top + from.height / 2 + "px";
      document.body.append(chip);
      const flight = chip.animate(
        [
          { opacity: 0, transform: "translate(-50%,-50%) scale(.75)" },
          { opacity: 1, offset: 0.14 },
          {
            opacity: 1,
            offset: 0.46,
            transform: `translate(calc(-50% + ${dx * 0.38}px),calc(-50% + ${dy * 0.38 - 38}px)) scale(1.1)`,
          },
          { opacity: 1, offset: 0.93 },
          {
            opacity: 0,
            transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.85)`,
          },
        ],
        {
          duration: flightDuration,
          delay: 350 + index * 20,
          fill: "both",
          easing: "ease-in-out",
        },
      );
      flights.add(flight);
      flight.oncancel = () => {
        chip.remove();
        flights.delete(flight);
      };
      flight.onfinish = () => {
        chip.remove();
        flights.delete(flight);
        playSound("points", index);
        scores.set(a.player, scores.get(a.player)! + a.amount);
        row.children[2].textContent = fmt(scores.get(a.player)!);
        row.children[2].animate(
          [
            { color: "#23724f", transform: "scale(1.18)" },
            { transform: "scale(1)" },
          ],
          { duration: 380 },
        );
        if (++landed === frame.awards.length) paintRanking(next, scores);
      };
    });
  }

  function favorites(next: DrawView) {
    for (const frame of next.revealed ?? []) {
      const title = frame.titles[0],
        tile = tiles.get(frame.step)!;
      let b = tile.querySelector<HTMLButtonElement>(".review-heart");
      if (!b) {
        b = document.createElement("button");
        b.type = "button";
        b.className = "review-heart";
        b.disabled = title.author === next.you;
        b.setAttribute("aria-label", "Сердечко за фразу «" + title.text + "»");
        b.onclick = () =>
          like(title.id, b!.getAttribute("aria-pressed") !== "true");
        tile.append(b);
      }
      const liked = next.liked?.includes(title.id) ?? false;
      b.setAttribute("aria-pressed", String(liked));
      b.textContent =
        (liked ? "♥" : "♡") + " " + (next.heartCounts?.[title.id] ?? 0);
    }
  }

  function update(next: DrawView) {
    const frame = next.reveal!;
    if (frame.kind === "opening") return;
    const key =
      frame.kind +
      "." +
      frame.step +
      "." +
      (frame.titles[0]?.voters.length ?? 0);
    if (key !== last) {
      dispose();
      last = key;
      const animate =
        next.now - next.startedAt < 900 &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches;
      root.querySelector(".recap-heading")!.removeAttribute("aria-hidden");
      board.style.setProperty("--rows", String(Math.ceil(frame.total / 2)));
      board.style.setProperty("--answers", String(frame.total));
      for (const previous of next.revealed ?? []) drawTile(previous, false);
      drawTile(frame, animate);
      const showRanking = frame.kind !== "ballots";
      root.querySelector<HTMLElement>(".draw-ranking")!.hidden = !showRanking;
      if (showRanking) score(next, frame, animate);
      root.querySelector<HTMLElement>(".review-window")!.hidden =
        frame.kind !== "favorites";
    }
    if (frame.kind === "favorites") favorites(next);
  }
  return { update, dispose };
}
