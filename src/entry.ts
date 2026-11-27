const app = document.querySelector<HTMLDivElement>("#app")!;

async function loadGame() {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get("game") === "hide") {
      document.title = "Прятки · Party Games";
      (await import("./hide/client")).mount(app);
    } else if (params.get("game") === "survey") {
      document.title = "Сто к одному · Party Games";
      const { mountSurveyDemo } = await import("./survey-entry");
      mountSurveyDemo(app);
    } else if (params.has("room") || params.get("game") === "hat") {
      document.title = "Шляпа · Party Games";
      await import("./main");
    } else {
      const { mountHome } = await import("./home");
      mountHome(app);
    }
  } catch (error) {
    console.error("Не удалось загрузить игру", error);
    const loading = app.querySelector(".game-loading");
    loading?.classList.add("is-error");
    const status = loading?.querySelector('[role="status"]');
    if (status) status.textContent = "Игра не загрузилась. Проверьте подключение и попробуйте ещё раз.";
  }
}

void loadGame();
