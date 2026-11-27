type Point = [number, number];
export type Stroke = {
  color: string;
  width: number;
  erase: boolean;
  points: Point[];
};
function draw(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  from: Point,
  to: Point,
) {
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

export function paintStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  for (const s of strokes)
    s.points.forEach((p, i) => draw(ctx, s, s.points[Math.max(0, i - 1)], p));
}
export function mountCanvas(
  root: HTMLElement,
  target: string | { strokes: Stroke[] },
  complete: () => void,
  problem: (s: string) => void,
) {
  root.innerHTML = `<div class="draw-tools"><label>Цвет <input type="color" value="#30215f"></label>
    <label>Кисть <input aria-label="Ширина кисти" type="range" min="1" max="40" value="5"></label>
    <button type="button" data-erase aria-pressed="false">Ластик</button>
    <button type="button" data-undo title="Ctrl+Z / ⌘Z">Отменить</button></div>
    <div class="draw-canvas-frame"><canvas width="640" height="480" aria-label="Поле для рисования"></canvas><span class="draw-brush-tip" hidden aria-hidden="true"></span></div>
    <button class="primary" data-finish>Готово</button>`;
  const canvas = root.querySelector("canvas")!;
  const ctx = canvas.getContext("2d")!;
  const color = root.querySelector<HTMLInputElement>("[type=color]")!;
  const width = root.querySelector<HTMLInputElement>("[type=range]")!;
  const eraser = root.querySelector<HTMLButtonElement>("[data-erase]")!;
  const undo = root.querySelector<HTMLButtonElement>("[data-undo]")!;
  const finish = root.querySelector<HTMLButtonElement>("[data-finish]")!;
  const tip = root.querySelector<HTMLElement>(".draw-brush-tip")!;
  let hover: { x: number; y: number } | undefined;
  function updateTip() {
    if (!hover) {
      tip.hidden = true;
      return;
    }
    const b = canvas.getBoundingClientRect();
    const x = hover.x - b.left,
      y = hover.y - b.top;
    tip.hidden = x < 0 || y < 0 || x > b.width || y > b.height;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
    tip.style.width = (Number(width.value) * b.width) / canvas.width + "px";
    tip.style.height = (Number(width.value) * b.height) / canvas.height + "px";
    const erase = eraser.getAttribute("aria-pressed") === "true";
    tip.style.backgroundColor = erase ? "transparent" : color.value;
    tip.classList.toggle("is-eraser", erase);
  }
  function preview(e: PointerEvent) {
    hover =
      e.pointerType === "touch" ? undefined : { x: e.clientX, y: e.clientY };
    updateTip();
  }
  canvas.onpointerenter = preview;
  canvas.onpointerleave = () => {
    hover = undefined;
    updateTip();
  };
  const observer = new ResizeObserver(updateTip);
  observer.observe(canvas);
  width.oninput = updateTip;
  const key =
    typeof target === "string" ? "draw.draft." + target.split("/").pop() : null;
  let strokes: Stroke[] = typeof target === "string" ? [] : target.strokes;
  try {
    if (key) strokes = JSON.parse(sessionStorage.getItem(key) ?? "[]");
  } catch {
    /* Empty draft. */
  }
  let active: number | null = null;
  let revision = Date.now() * 1000;
  let sent = 0;
  let busy = false;
  let ended = false;
  let closing = false;
  function repaint() {
    ctx.clearRect(0, 0, 640, 480);
    paintStrokes(ctx, strokes);
    undo.disabled = strokes.length === 0;
  }
  function saveDraft() {
    try {
      if (key) sessionStorage.setItem(key, JSON.stringify(strokes));
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
    preview(e);
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
    draw(ctx, s, p, p);
    revision++;
    undo.disabled = false;
  };
  canvas.onpointermove = (e) => {
    preview(e);
    if (active !== e.pointerId || closing) return;
    const s = strokes[strokes.length - 1],
      p = point(e),
      prev = s.points[s.points.length - 1];
    if (p[0] === prev[0] && p[1] === prev[1]) return;
    draw(ctx, s, prev, p);
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
  color.oninput = () => {
    eraser.setAttribute("aria-pressed", "false");
    updateTip();
  };
  eraser.onclick = () => {
    eraser.setAttribute(
      "aria-pressed",
      String(eraser.getAttribute("aria-pressed") !== "true"),
    );
    updateTip();
  };
  const keydown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" && !e.shiftKey) {
      e.preventDefault();
      back();
    }
  };
  async function flush() {
    if (typeof target !== "string" || busy || ended || sent === revision)
      return;
    busy = true;
    const version = revision;
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw Error();
      const response = await fetch(target + "?v=" + version, {
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
    if (!key || sent === revision) complete();
    else void flush();
  }
  repaint();
  finish.onclick = submit;
  window.addEventListener("keydown", keydown);
  const timer = key && setInterval(() => void flush(), 10000);
  const retryFinal =
    key &&
    setInterval(() => {
      if (closing) void flush();
    }, 800);
  return {
    submit,
    dispose(clear: boolean) {
      ended = true;
      observer.disconnect();
      if (timer) clearInterval(timer);
      if (retryFinal) clearInterval(retryFinal);
      window.removeEventListener("keydown", keydown);
      if (key && clear) {
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* Optional storage. */
        }
      }
    },
  };
}
