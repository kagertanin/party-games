import "./home.css";
import logo from "./home-art/logo.webp";
import survey from "./home-art/survey.webp";
import hat from "./home-art/hat.webp";
import draw from "./home-art/draw.webp";
import hide from "./home-art/hide.webp";

export function mountHome(app: HTMLElement) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#ede7fb");
  app.innerHTML = `
    <main class="patch-home">
      <h1 class="patch-home-brand">
        <img src="${logo}" width="550" height="204" alt="И.Г.Р.Ы.">
      </h1>
      <ul class="game-patches" aria-label="Игры">
        <li>
          <a class="game-patch" href="?game=survey">
            <img src="${survey}" width="510" height="640" fetchpriority="high" alt="Сто к одному">
          </a>
        </li>
        <li>
          <button type="button" class="game-patch" disabled>
            <img src="${hat}" width="345" height="640" alt="Шляпа">
          </button>
        </li>
        <li>
          <button type="button" class="game-patch" disabled>
            <img src="${draw}" width="355" height="640" alt="Рисовач">
          </button>
        </li>
        <li>
          <a class="game-patch" href="?game=hide">
            <img src="${hide}" width="375" height="640" alt="Прятки">
          </a>
        </li>
      </ul>
    </main>`;
}
