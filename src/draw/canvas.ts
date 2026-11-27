type Point = [number, number];
type Stroke = { color: string; width: number; erase: boolean; points: Point[] };
export function mountCanvas(
  root: HTMLElement,
  uploadUrl: string,
  complete: () => void,
  problem: (s: string) => void,
) {
  root.innerHTML = `<div class="draw-tools"><label>Цвет <input type="color" value="#30215f"></label>
    <label>Кисть <input aria-label="Ширина кисти" type="range" min="1" max="40" value="5"></label>
    <button type="button" data-erase aria-pressed="false">Ластик</button>
    <button type="button" data-undo title="Ctrl+Z / ⌘Z">Отменить</button></div>
    <canvas width="640" height="480" aria-label="Поле для рисования"></canvas>
    <button class="primary" data-finish>Готово</button>`;
  const canvas = root.querySelector("canvas")!;
  const ctx = canvas.getContext("2d")!;
  const color = root.querySelector<HTMLInputElement>("[type=color]")!;
  const width = root.querySelector<HTMLInputElement>("[type=range]")!;
  const eraser = root.querySelector<HTMLButtonElement>("[data-erase]")!;
  const undo = root.querySelector<HTMLButtonElement>("[data-undo]")!;
  const finish = root.querySelector<HTMLButtonElement>("[data-finish]")!;
  const key = "draw.draft." + uploadUrl.split("/").pop();
  let strokes: Stroke[] = [];
  try {
    strokes = JSON.parse(sessionStorage.getItem(key) ?? "[]");
  } catch {
    /* Empty draft. */
  }
  let active: number | null = null;
  let revision = Date.now() * 1000;
  let sent = 0;
  let busy = false;
  let ended = false;
  let closing = false;
  function draw(s: Stroke, from: Point, to: Point) {
    ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
    ctx.strokeStyle = ctx.fillStyle = s.color;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = s.width;
    ctx.beginPath();
    if (from[0] === to[0] && from[1] === to[1]) {
      ctx.arc(to[0], to[1], s.width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(...from);
      ctx.lineTo(...to);
      ctx.stroke();
    }
  }
  function repaint() {
    ctx.clearRect(0, 0, 640, 480);
    for (const s of strokes)
      s.points.forEach((p, i) => draw(s, s.points[Math.max(0, i - 1)], p));
    undo.disabled = strokes.length === 0;
  }
  function saveDraft() {
    try {
      sessionStorage.setItem(key, JSON.stringify(strokes));
    } catch {
      /* Server also receives snapshots. */
    }
  }
  function point(e: PointerEvent): Point {
    const b = canvas.getBoundingClientRect();
    return [
      Math.round(((e.clientX - b.left) * 640) / b.width),
      Math.round(((e.clientY - b.top) * 480) / b.height),
    ];
  }
  function stopStroke() {
    active = null;
    saveDraft();
  }
  canvas.onpointerdown = (e) => {
    if (closing || active !== null || e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    active = e.pointerId;
    const p = point(e);
    const s = {
      color: color.value,
      width: Number(width.value),
      erase: eraser.getAttribute("aria-pressed") === "true",
      points: [p],
    };
    strokes.push(s);
    draw(s, p, p);
    revision++;
    undo.disabled = false;
  };
  canvas.onpointermove = (e) => {
    if (active !== e.pointerId || closing) return;
    const s = strokes[strokes.length - 1],
      p = point(e),
      prev = s.points[s.points.length - 1];
    if (p[0] === prev[0] && p[1] === prev[1]) return;
    draw(s, prev, p);
    s.points.push(p);
    revision++;
  };
  canvas.onpointerup =
    canvas.onpointercancel =
    canvas.onlostpointercapture =
      (e) => {
        if (e.pointerId === active) stopStroke();
      };
  function back() {
    if (closing || !strokes.length) return;
    active = null;
    strokes.pop();
    revision++;
    repaint();
    saveDraft();
  }
  undo.onclick = back;
  color.oninput = () => eraser.setAttribute("aria-pressed", "false");
  eraser.onclick = () =>
    eraser.setAttribute(
      "aria-pressed",
      String(eraser.getAttribute("aria-pressed") !== "true"),
    );
  const keydown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" && !e.shiftKey) {
      e.preventDefault();
      back();
    }
  };
  async function flush() {
    if (busy || ended || sent === revision) return;
    busy = true;
    const version = revision;
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw Error();
      const response = await fetch(uploadUrl + "?v=" + version, {
        method: "POST",
        body: blob,
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw Error();
      sent = version;
    } catch {
      if (!ended)
        problem("Рисунок сохранён на устройстве. Повторяем отправку.");
    } finally {
      busy = false;
    }
    if (closing && !ended) {
      if (sent === revision) complete();
      else if (sent === version) void flush();
    }
  }
  function submit() {
    if (ended || closing) return;
    closing = true;
    finish.disabled = true;
    finish.textContent = "Отправляем…";
    stopStroke();
    if (sent === revision) complete();
    else void flush();
  }
  repaint();
  finish.onclick = submit;
  window.addEventListener("keydown", keydown);
  const timer = setInterval(() => void flush(), 10000);
  const retryFinal = setInterval(() => {
    if (closing) void flush();
  }, 800);
  return {
    submit,
    dispose(clear: boolean) {
      ended = true;
      clearInterval(timer);
      clearInterval(retryFinal);
      window.removeEventListener("keydown", keydown);
      if (clear) {
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* Optional storage. */
        }
      }
    },
  };
}
