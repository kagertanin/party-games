import { getVolume, playSound, prepareSound, setVolume, syncVolume, toggleSound, unlockSound } from "./sound";
import "./control.css";

const controls = "a[href],button,select,summary,input[type=button],input[type=submit],input[type=checkbox],input[type=radio],[role=button]";
const toElement = (target: EventTarget | null) => target instanceof Element ? target : null;
function activeControl(target: EventTarget | null) {
  const el = toElement(target);
  if (el?.closest("[inert], :disabled, [aria-disabled=true]")) return null;
  return el?.closest(controls);
}

export function mountSoundControl() {
  const panel = document.createElement("div");
  panel.className = "fabric-sound";
  panel.innerHTML = `<button type="button" class="fabric-speaker" aria-controls="fabric-volume-panel">
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor"/>
      <path class="volume-waves" d="M15 8.5a5 5 0 0 1 0 7M18 5.5a9 9 0 0 1 0 13"/>
      <path class="volume-cross" d="m16 9 5 6m0-6-5 6"/>
    </svg></button><div id="fabric-volume-panel" hidden><input type="range" min="0" max="100" step="1" aria-label="Громкость"></div>`;
  document.body.append(panel);
  const button = panel.querySelector("button")!;
  const slider = panel.querySelector("input")!;
  const pop = slider.parentElement!;
  function open(on: boolean) {
    pop.hidden = !on;
    button.setAttribute("aria-expanded", String(on));
  }
  function refresh() {
    const value = getVolume();
    slider.value = String(value);
    panel.classList.toggle("is-muted", !value);
    button.setAttribute("aria-label", value ? "Выключить звук" : "Включить звук");
    button.setAttribute("aria-pressed", String(value > 0));
    slider.setAttribute("aria-valuetext", value + "%");
  }
  open(false);
  refresh();
  let restore = getVolume();
  slider.addEventListener("pointerdown", () => { restore = getVolume(); });
  slider.addEventListener("focus", () => { restore = getVolume(); });
  slider.oninput = () => { unlockSound(); setVolume(slider.valueAsNumber, restore); refresh(); };
  slider.onchange = () => playSound("press");
  button.onclick = () => { unlockSound(); toggleSound(); refresh(); open(true); playSound("press"); };
  panel.onpointerenter = e => { if (e.pointerType === "mouse") open(true); };
  panel.onpointerleave = e => { if (e.pointerType === "mouse" && document.activeElement !== slider) open(false); };
  panel.addEventListener("focusin", () => open(true));
  panel.addEventListener("focusout", e => { if (!panel.contains(toElement(e.relatedTarget))) open(false); });
  panel.onkeydown = e => {
    if (e.key === "Escape") { button.focus(); open(false); e.stopPropagation(); }
  };
  window.addEventListener("storage", e => {
    if (!e.key || e.key === "party-games.sound.v1") { syncVolume(); refresh(); }
  });

  // Native modal dialogs sit above fixed page elements and make their siblings inert.
  const place = () => {
    const host = Array.from(document.querySelectorAll("dialog:modal")).at(-1) ?? document.body;
    if (panel.parentElement !== host) host.append(panel);
  };
  document.addEventListener("toggle", e => { if (e.target instanceof HTMLDialogElement) place(); }, true);
  document.addEventListener("close", place, true);
  const removedDialog = new MutationObserver(() => { if (!panel.isConnected) place(); });
  removedDialog.observe(document.body, { childList: true, subtree: true });

  document.addEventListener("pointerover", e => {
    const control = activeControl(e.target);
    if (e.pointerType === "mouse" && control && !control.contains(toElement(e.relatedTarget))) playSound("hover");
  }, true);
  const tap = (target: EventTarget | null) => {
    const el = toElement(target);
    if (!el || el.closest(".fabric-sound, :disabled, [aria-disabled=true], [inert]")) return;
    playSound(activeControl(el) ? "press" : "background");
  };
  document.addEventListener("pointerdown", e => {
    if (!e.isPrimary || e.button !== 0) return;
    unlockSound();
    if (!panel.contains(toElement(e.target))) open(false);
    if (e.pointerType === "mouse") tap(e.target);
  }, true);
  document.addEventListener("click", e => {
    if (e.button !== 0) return;
    if (!e.detail || (e as PointerEvent).pointerType === "touch" || (e as PointerEvent).pointerType === "pen") {
      unlockSound(); tap(e.target);
    }
  }, true);
  document.addEventListener("keydown", e => { if (!e.repeat) unlockSound(); }, true);
  prepareSound();
}
