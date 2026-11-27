type AwardContext = {
  key: string;
  label: string;
  points: number;
  teams: readonly { name: string }[];
};

export function mountAnswerAward(
  app: HTMLElement,
  current: (answerIndex: number) => AwardContext | undefined,
  award: (answerIndex: number, team: number) => void,
) {
  let drag: { answerIndex: number; key: string } | null = null;
  let highlighted: HTMLElement | null = null;
  let prompt: { element: HTMLDialogElement; answerIndex: number; key: string } | null = null;

  function highlight(target: HTMLElement | null) {
    if (target === highlighted) return;
    highlighted?.classList.remove("is-award-target");
    highlighted = target;
    highlighted?.classList.add("is-award-target");
  }

  function clearDrag() {
    drag = null;
    highlight(null);
    app.classList.remove("is-dragging-award");
  }

  function closePrompt(restoreFocus: boolean) {
    if (!prompt) return;
    const { element, answerIndex } = prompt;
    prompt = null;
    element.close();
    element.remove();
    if (restoreFocus) {
      app.querySelector<HTMLButtonElement>(
        `[data-award-card="${answerIndex}"], [data-survey="next-question"]`,
      )?.focus({ preventScroll: true });
    }
  }

  function openPrompt(answerIndex: number, team?: number) {
    const context = current(answerIndex);
    if (!context || (team !== undefined && !context.teams[team])) return;
    closePrompt(false);

    const element = document.createElement("dialog");
    element.className = "survey-app survey-start-dialog survey-award-dialog";
    element.setAttribute("aria-labelledby", "survey-award-title");
    element.innerHTML = `
      <form class="survey-start-form">
        <h2 id="survey-award-title">Засчитать ответ?</h2>
        <p data-award-summary></p>
        <label>Команда <select name="team" required><option value="">Выберите команду</option></select></label>
        <div class="survey-dialog-actions">
          <button class="survey-button secondary-action" type="button">Нет, не добавлять</button>
          <button class="survey-button primary-action" type="submit">Да, добавить</button>
        </div>
      </form>`;
    const form = element.querySelector("form")!;
    const summary = form.querySelector<HTMLElement>("[data-award-summary]")!;
    const select = form.querySelector("select")!;
    const cancel = form.querySelector<HTMLButtonElement>('[type="button"]')!;
    const confirm = form.querySelector<HTMLButtonElement>('[type="submit"]')!;

    context.teams.forEach(({ name }, index) => select.add(new Option(name, String(index))));
    select.closest("label")!.hidden = team !== undefined;
    if (team !== undefined) select.value = String(team);
    const updateSummary = () => {
      const target = select.value === "" ? undefined : context.teams[Number(select.value)];
      const plural = new Intl.PluralRules("ru").select(context.points);
      const count = `${context.points} ${plural === "one" ? "очко" : plural === "few" ? "очка" : "очков"}`;
      summary.textContent = target
        ? `Добавить команде «${target.name}» ${count} за ответ «${context.label}»?`
        : `«${context.label}» · ${count}`;
      confirm.disabled = !target;
    };
    updateSummary();
    select.addEventListener("change", updateSummary);
    cancel.addEventListener("click", () => closePrompt(true));
    element.addEventListener("cancel", (event) => {
      event.preventDefault();
      closePrompt(true);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (select.value === "" || current(answerIndex)?.key !== context.key) return;
      const target = Number(select.value);
      closePrompt(true);
      award(answerIndex, target);
    });

    prompt = { element, answerIndex, key: context.key };
    document.body.append(element);
    element.showModal();
    (team === undefined ? select : cancel).focus({ preventScroll: true });
  }

  app.addEventListener("click", (event) => {
    const card = (event.target as Element | null)?.closest<HTMLElement>("[data-award-card]");
    if (card) openPrompt(Number(card.dataset.awardCard));
  });

  app.addEventListener("dragstart", (event) => {
    const card = (event.target as Element | null)?.closest<HTMLElement>("[data-award-card]");
    if (!card) return;
    const answerIndex = Number(card.dataset.awardCard);
    const context = current(answerIndex);
    if (!context || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", context.label);
    drag = { answerIndex, key: context.key };
    app.classList.add("is-dragging-award");
  });

  const targetTeam = (event: DragEvent) =>
    (event.target as Element | null)?.closest<HTMLElement>("[data-award-team]") ?? null;

  app.addEventListener("dragover", (event) => {
    if (!drag) return;
    const target = targetTeam(event);
    highlight(target);
    if (!target) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  });

  app.addEventListener("drop", (event) => {
    const target = targetTeam(event);
    if (!drag || !target) return;
    event.preventDefault();
    const { answerIndex, key } = drag;
    clearDrag();
    if (current(answerIndex)?.key === key) openPrompt(answerIndex, Number(target.dataset.awardTeam));
  });

  document.addEventListener("dragend", clearDrag);
  return () => {
    clearDrag();
    if (prompt && current(prompt.answerIndex)?.key !== prompt.key) closePrompt(false);
  };
}
