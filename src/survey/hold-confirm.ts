const HOLD_MS = 2_000;
const CONFIRM_SELECTOR = "button[data-confirm-proposal]";

type HoldKey = " " | "Enter";
type HoldInput = { pointerId: number } | { key: HoldKey };
type Hold = {
  button: HTMLButtonElement;
  proposalId: number;
  input: HoldInput;
  startedAt: number;
  frame: number;
};

function isHoldKey(key: string): key is HoldKey {
  return key === " " || key === "Enter";
}

export function mountHoldConfirm(root: HTMLElement, confirm: (proposalId: number) => void): () => void {
  const documentView = root.ownerDocument.defaultView;
  if (!documentView) return () => {};
  const view = documentView;

  let active: Hold | null = null;
  let pressedKey: HoldKey | null = null;

  function buttonFor(target: EventTarget | null) {
    const button = target instanceof Element ? target.closest<HTMLButtonElement>(CONFIRM_SELECTOR) : null;
    return button && root.contains(button) ? button : null;
  }

  function proposalIdFor(button: HTMLButtonElement) {
    const value = button.dataset.confirmProposal;
    if (!value || !button.isConnected || !root.contains(button) || button.matches(":disabled")) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id >= 0 ? id : null;
  }

  function reset() {
    const hold = active;
    if (!hold) return;
    active = null;
    view.cancelAnimationFrame(hold.frame);
    hold.button.style.removeProperty("--hold-progress");
    if ("pointerId" in hold.input && hold.button.hasPointerCapture(hold.input.pointerId)) {
      hold.button.releasePointerCapture(hold.input.pointerId);
    }
  }

  function showProgress(now: number) {
    const hold = active;
    if (!hold) return;
    if (proposalIdFor(hold.button) !== hold.proposalId) {
      reset();
      return;
    }

    const progress = (now - hold.startedAt) / HOLD_MS;
    if (progress >= 1) {
      reset();
      confirm(hold.proposalId);
      return;
    }

    hold.button.style.setProperty("--hold-progress", String(Math.max(0, progress)));
    hold.frame = view.requestAnimationFrame(showProgress);
  }

  function start(button: HTMLButtonElement, input: HoldInput) {
    const proposalId = proposalIdFor(button);
    if (active || proposalId === null) return false;
    button.style.setProperty("--hold-progress", "0");
    active = {
      button,
      proposalId,
      input,
      startedAt: view.performance.now(),
      frame: view.requestAnimationFrame(showProgress),
    };
    return true;
  }

  root.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const button = buttonFor(event.target);
    if (!button || !start(button, { pointerId: event.pointerId })) return;
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // The window listeners also handle pointers that cannot be captured.
    }
  });

  function pendingPointer(event: PointerEvent) {
    return active && "pointerId" in active.input && active.input.pointerId === event.pointerId
      ? active
      : null;
  }

  function stopPointer(event: PointerEvent) {
    if (pendingPointer(event)) reset();
  }

  view.addEventListener("pointermove", (event) => {
    const hold = pendingPointer(event);
    if (!hold) return;
    const bounds = hold.button.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) reset();
  }, true);
  view.addEventListener("pointerup", stopPointer, true);
  view.addEventListener("pointercancel", stopPointer, true);
  root.addEventListener("lostpointercapture", (event) => {
    if (pendingPointer(event)?.button === event.target) reset();
  });
  root.addEventListener("pointerleave", (event) => {
    if (pendingPointer(event)?.button === event.target) reset();
  }, true);
  root.addEventListener("contextmenu", (event) => {
    if (active && "pointerId" in active.input && active.button === buttonFor(event.target)) {
      event.preventDefault();
    }
  });

  view.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && active) {
      reset();
      return;
    }
    if (!isHoldKey(event.key)) return;
    if (event.repeat && event.key === pressedKey) {
      event.preventDefault();
      return;
    }
    const button = buttonFor(event.target);
    if (!button || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (!event.repeat && start(button, { key: event.key })) pressedKey = event.key;
  }, true);
  view.addEventListener("keyup", (event) => {
    if (event.key !== pressedKey) return;
    event.preventDefault();
    pressedKey = null;
    if (active && "key" in active.input && active.input.key === event.key) reset();
  }, true);
  root.addEventListener("blur", (event) => {
    if (active?.button === event.target) reset();
  }, true);

  function clearOnBlur() {
    pressedKey = null;
    reset();
  }
  view.addEventListener("blur", clearOnBlur);
  root.ownerDocument.addEventListener("visibilitychange", () => {
    if (root.ownerDocument.hidden) clearOnBlur();
  });

  return reset;
}
