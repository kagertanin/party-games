import type { DrawPlayer } from "../../shared/draw";
import { escape } from "../rooms/ui";
import { avatarMarkup } from "./avatar";

export function finalStandings(players: DrawPlayer[]) {
  // Stable sort keeps lobby order when all tie-breaks match.
  const ranked = [...players].sort(
    (a, b) => b.points - a.points || b.guesses - a.guesses || b.likes - a.likes,
  );
  const favorite = ranked.reduce<DrawPlayer | undefined>(
    (best, p) => (p.likes > (best?.likes ?? 0) ? p : best),
    undefined,
  );
  return { ranked, favorite };
}

function awardPortrait(player: DrawPlayer, mark: string) {
  return `<span class="award-portrait">${avatarMarkup(player)}<span class="award-pin" aria-hidden="true">${mark}</span></span>`;
}

export function finale(players: DrawPlayer[], canRestart: boolean) {
  const { ranked, favorite } = finalStandings(players);
  const winner = ranked[0],
    fmt = (n: number) => n.toLocaleString("ru-RU");
  return `<main class="draw-finale"><header class="final-heading"><h1>Итоги партии</h1></header>
    <div class="final-patches">
      <section class="final-patch final-winner">${awardPortrait(winner, "1")}
      <div><h2>Первое место</h2><strong>${escape(winner.name)}</strong><p><b>${fmt(winner.points)}</b> очков</p></div></section>
      ${
        favorite
          ? `<section class="final-patch final-favorite">${awardPortrait(favorite, "♥")}
      <div><h2>Любимец компании</h2><strong>${escape(favorite.name)}</strong><p><b>♥ ${fmt(favorite.likes)}</b> · Больше всего сердечек за фразы</p></div></section>`
          : ""
      }
    </div>
    <section class="final-ledger"><h2>Таблица очков</h2><ol>${ranked
      .map(
        (p, i) =>
          `<li${i === 0 ? ' class="first-place"' : ""}><span class="final-place">${i + 1}</span><span class="final-player">${avatarMarkup(p)}<span>${escape(p.name)}</span></span><strong>${fmt(p.points)}</strong></li>`,
      )
      .join("")}</ol></section>
    ${canRestart ? '<button class="primary" data-again>Ещё партия</button>' : ""}</main>`;
}
