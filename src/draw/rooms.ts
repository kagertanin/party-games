import { roomForm, roomHeading, roomFooter, escape } from "../rooms/ui";
import { DRAW_MAX, DRAW_MIN, type DrawView } from "../../shared/draw";

export function openDrawForm(
  parent: HTMLElement,
  name: string,
  invited: string,
  submit: (name: string, code?: string) => Promise<void>,
) {
  const dialog = document.createElement("dialog");
  dialog.className = "survey-start-dialog survey-online-dialog";
  dialog.setAttribute("aria-labelledby", "survey-online-title");
  dialog.innerHTML = roomForm("R", name, invited);
  const form = dialog.querySelector("form")!;
  const code = form.elements.namedItem("code") as HTMLInputElement;
  const nick = form.elements.namedItem("name") as HTMLInputElement;
  const send = form.querySelector<HTMLButtonElement>("[type=submit]")!;
  const feedback = form.querySelector<HTMLElement>("[data-room-error]")!;
  const controls = [
    ...form.querySelectorAll<HTMLButtonElement>("[data-room-action]"),
  ];
  let join = Boolean(invited);
  let busy = false;
  function update() {
    code.disabled = busy || !join;
    code.closest("label")!.hidden = !join;
    nick.disabled = busy;
    send.disabled = busy;
    send.textContent = busy
      ? "Подключаемся…"
      : join
        ? "Присоединиться"
        : "Создать комнату";
    for (const b of controls) {
      b.disabled = busy;
      if (b.dataset.roomAction !== "close")
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.roomAction === (join ? "join" : "create")),
        );
    }
  }
  controls.forEach(
    (b) =>
      (b.onclick = () => {
        if (b.dataset.roomAction === "close") dialog.close();
        else {
          join = b.dataset.roomAction === "join";
          feedback.hidden = true;
          update();
        }
      }),
  );
  dialog.oncancel = (event) => {
    if (busy) event.preventDefault();
  };
  dialog.onclose = () => dialog.remove();
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    feedback.hidden = true;
    update();
    try {
      await submit(
        nick.value.trim(),
        join ? code.value.trim().toUpperCase() : undefined,
      );
      dialog.close();
    } catch (error) {
      feedback.textContent =
        error instanceof Error ? error.message : "Не удалось подключиться.";
      feedback.hidden = false;
    } finally {
      busy = false;
      update();
    }
  };
  parent.append(dialog);
  update();
  dialog.showModal();
}

export function lobbyMarkup(v: DrawView, removing: string) {
  const connected = v.players.filter((p) => p.connected).length;
  const host = v.you === v.host;
  const roster = v.players
    .map((p) => {
      const tag = [
        p.id === v.host ? "Ведущий" : "",
        p.id === v.you ? "Вы" : "",
        p.connected ? "" : "Переподключается",
      ]
        .filter(Boolean)
        .join(" · ");
      const name = escape(p.name),
        id = escape(p.id);
      return `<li><div class="draw-person"><i aria-hidden="true">${escape(Array.from(p.name)[0] || "•")}</i>
      <div><strong>${name}</strong>${tag ? `<small>${tag}</small>` : ""}</div></div>
      ${host && p.id !== v.you ? (removing === p.id ? `<div class="draw-member-actions"><span>Исключить игрока?</span><button data-cancel>Отмена</button><button data-kick="${id}">Исключить</button></div>` : `<button data-manage="${id}" aria-label="Исключить игрока ${name}">Исключить</button>`) : ""}</li>`;
    })
    .join("");
  return `<main class="survey-wrap survey-online-lobby" aria-labelledby="survey-online-lobby-title">
    ${roomHeading(v.code, connected, DRAW_MAX, "")}
    <section class="survey-online-team draw-players"><h2>Игроки</h2><ul>${roster}</ul></section>
    ${roomFooter(connected < DRAW_MIN ? "Для старта нужны хотя бы три игрока." : host ? "Можно начинать." : "Ведущий начнёт игру.", host, connected >= DRAW_MIN, true)}</main>`;
}
