const app = document.querySelector<HTMLDivElement>("#app")!;

async function loadGame() {
  try {
    if (new URLSearchParams(location.search).get("game") === "survey") {
      document.title = "Сто к одному · Party Games";
      const { mountSurveyDemo } = await import("./survey-entry");
      mountSurveyDemo(app);
    } else {
      await import("./main");
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
