export const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );

export function roomForm(prefix: "S" | "R", name: string, code: string) {
  return `
      <form class="survey-start-form" id="survey-online-form">
        <h2 id="survey-online-title">Играть с друзьями</h2>
        <div class="survey-online-modes" role="group" aria-label="Вход в комнату">
          <button class="survey-button secondary-action" type="button" data-room-action="create">Новая комната</button>
          <button class="survey-button secondary-action" type="button" data-room-action="join">Войти по коду</button>
        </div>
        <label>Ваше имя <input name="name" maxlength="24" required autocomplete="nickname"
          value="${escape(name)}" autofocus></label>
        <label data-room-fields="join">Код комнаты <input name="code" maxlength="7" autocapitalize="characters" spellcheck="false"
          pattern="[${prefix.toLowerCase()}${prefix}][0-9A-Fa-f]{6}" title="Семь символов, начиная с ${prefix}" autocomplete="off" required
          value="${escape(code.slice(0, 7))}" placeholder="${prefix}123ABC"></label>
        <p class="survey-online-error" data-room-error role="status" hidden></p>
        <div class="survey-dialog-actions">
          <button class="survey-button secondary-action" type="button" data-room-action="close">Назад</button>
          <button class="survey-button primary-action" type="submit"></button>
        </div>
      </form>`;
}

export function roomHeading(
  code: string,
  connected: number,
  seats: number,
  notice: string,
  overview = "",
) {
  return `      <header class="survey-online-heading">
        <div class="survey-online-overview">
          <h1 id="survey-online-lobby-title" tabindex="-1">Комната ожидания</h1>
          <p class="survey-muted" role="status">Подключились ${connected} из ${seats}</p>
${overview}
        </div>
        <div class="survey-online-invites">
          <label class="survey-online-code">Код комнаты <input aria-label="Код комнаты" value="${escape(code)}" readonly></label>
          <div class="survey-online-copy">
            <button class="survey-button secondary-action" type="button" data-room-action="copy-code">Скопировать код</button>
            <button class="survey-button secondary-action" type="button" data-room-action="copy-link">Скопировать ссылку</button>
          </div>
          <p class="survey-muted" data-room-notice role="status">${escape(notice)}</p>
        </div>
      </header>`;
}

export function roomFooter(
  startMessage: string,
  isHost: boolean,
  canStart: boolean,
  canLeave: boolean,
) {
  return `      <footer class="survey-online-footer">
        <p class="survey-muted">${escape(startMessage)}</p>
        <div class="survey-dialog-actions">
          ${canLeave ? '<button class="survey-button secondary-action" type="button" data-room-action="leave">Выйти из комнаты</button>' : ""}
          ${isHost ? `<button class="survey-button primary-action" type="button" data-room-action="start" ${canStart ? "" : "disabled"}>Начать игру</button>` : ""}
        </div>
      </footer>`;
}
