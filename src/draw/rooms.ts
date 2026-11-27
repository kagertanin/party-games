import { roomForm, roomHeading, roomFooter, escape } from "../rooms/ui";
import {
  DRAW_MAX,
  DRAW_MIN,
  type DrawPlayer,
  type DrawView,
} from "../../shared/draw";
import { avatarMarkup } from "./avatar";
import { mountCanvas } from "./canvas";

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

function memberActions(p: DrawPlayer, v: DrawView, removing: string) {
  if (v.host !== v.you || p.id === v.you) return "";
  return removing === p.id
    ? `<div class="portrait-actions"><span>Исключить игрока?</span><button data-cancel>Отмена</button><button data-kick="${escape(p.id)}">Исключить</button></div>`
    : `<button class="portrait-manage" data-manage="${escape(p.id)}" aria-label="Исключить игрока ${escape(p.name)}" title="Исключить игрока">×</button>`;
}

export function mountDrawLobby(
  root: HTMLElement,
  initial: DrawView,
  server: string,
  act: (type: string, extra?: Record<string, unknown>) => void,
  leave: () => void,
  problem: (s: string) => void,
) {
  let view = initial;
  let removing = "";
  let drawer: ReturnType<typeof mountCanvas> | undefined;
  root.innerHTML = `<main class="survey-wrap survey-online-lobby draw-portrait-room" aria-labelledby="survey-online-lobby-title">
    ${roomHeading(initial.code, 1, DRAW_MAX, "")}
    <div class="portrait-workspace">
      <section class="portrait-studio risovach" hidden><h2>Нарисуй свою аватарку</h2>
        <div class="drawing-pad"></div></section>
      <section class="portrait-gallery" aria-labelledby="draw-gallery-title">
        <h2 id="draw-gallery-title">Игроки</h2><ul class="portrait-wall"></ul>
        <div class="portrait-pending"></div></section>
    </div><div data-lobby-footer></div></main>`;
  const studio = root.querySelector<HTMLElement>(".portrait-studio")!;
  const wall = root.querySelector<HTMLElement>(".portrait-wall")!;
  const pendingList = root.querySelector<HTMLElement>(".portrait-pending")!;
  function update(v: DrawView) {
    view = v;
    const host = v.host === v.you;
    const connected = v.players.filter((p) => p.connected);
    const pending = v.players.filter((p) => !p.avatar);
    const ready = connected.filter((p) => p.avatar).length;
    const canStart = ready === connected.length && ready >= DRAW_MIN;
    root.querySelector(".survey-online-overview [role=status]")!.textContent =
      `Подключились ${connected.length} из ${DRAW_MAX} · Готовы ${ready} из ${connected.length}`;
    if (v.avatarUpload && !drawer) {
      studio.hidden = false;
      drawer = mountCanvas(
        studio.querySelector(".drawing-pad")!,
        { avatarUpload: server + v.avatarUpload },
        () => act("avatar"),
        problem,
      );
    } else if (!v.avatarUpload && drawer) {
      drawer.dispose(true);
      drawer = undefined;
      studio.querySelector(".drawing-pad")!.replaceChildren();
      studio.hidden = true;
    }
    const portraits = v.players.filter((p) => p.avatar);
    wall.innerHTML = portraits
      .map((p) => {
        const tags = [
          p.id === v.host ? "Ведущий" : "",
          p.id === v.you ? "Вы" : "",
          p.connected ? "" : "Переподключается",
        ].filter(Boolean);
        return `<li><figure>${avatarMarkup(p)}<figcaption><strong>${escape(p.name)}</strong>${tags.length ? `<small>${tags.join(" · ")}</small>` : ""}</figcaption></figure>${memberActions(p, v, removing)}</li>`;
      })
      .join("");
    wall.hidden = !portraits.length;
    // Pending players appear on the host's moderation list, never as public portraits.
    pendingList.innerHTML =
      host && pending.some((p) => p.id !== v.you)
        ? `<p>Рисуют аватарки</p><ul>${pending
            .filter((p) => p.id !== v.you)
            .map(
              (p) =>
                `<li><span>${escape(p.name)}</span>${memberActions(p, v, removing)}</li>`,
            )
            .join("")}</ul>`
        : "";
    const gallery = root.querySelector<HTMLElement>(".portrait-gallery")!;
    gallery.hidden = !portraits.length && !pendingList.childElementCount;
    const message =
      connected.length < DRAW_MIN
        ? "Для старта нужны хотя бы три игрока."
        : ready < connected.length
          ? "Ждём, когда все закончат аватарки."
          : host
            ? "Все готовы."
            : "Ведущий начнёт игру.";
    root.querySelector("[data-lobby-footer]")!.innerHTML = roomFooter(
      message,
      host,
      canStart,
      true,
    );
  }
  root.onclick = async (event) => {
    const b = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button",
    );
    if (!b || b.disabled) return;
    if (b.hasAttribute("data-manage") || b.hasAttribute("data-cancel")) {
      removing = b.dataset.manage ?? "";
      update(view);
    } else if (b.dataset.kick) {
      removing = "";
      act("kick", { member: b.dataset.kick });
    } else if (b.dataset.roomAction === "start") {
      act("start");
    } else if (b.dataset.roomAction === "leave") {
      leave();
    } else if (
      b.dataset.roomAction === "copy-code" ||
      b.dataset.roomAction === "copy-link"
    ) {
      const value =
        b.dataset.roomAction === "copy-code" ? view.code : location.href;
      const notice = root.querySelector<HTMLElement>("[data-room-notice]")!;
      try {
        await navigator.clipboard.writeText(value);
        notice.textContent = "Скопировано.";
      } catch {
        const field = root.querySelector<HTMLInputElement>(
          ".survey-online-code input",
        )!;
        field.value = value;
        field.select();
        notice.textContent = "Скопируйте выделенный текст.";
        field.onblur = () => {
          field.value = view.code;
        };
      }
    }
  };
  update(initial);
  return {
    update,
    retryAvatar: () => drawer?.resume(),
    dispose(clear: boolean) {
      drawer?.dispose(clear);
      root.onclick = null;
    },
  };
}
