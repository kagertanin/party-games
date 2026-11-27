import type { DrawPlayer } from "../../shared/draw";
import { escape } from "../rooms/ui";

export function drawServerUrl() {
  const url =
    import.meta.env.VITE_SERVER_URL ||
    (location.hostname.endsWith(".chatgpt.site")
      ? "https://party-games-kagertanin.waw0.amvera.tech"
      : import.meta.env.DEV
        ? location.protocol + "//" + location.hostname + ":2567"
        : location.origin);
  return String(url).replace(/^ws/, "http").replace(/\/$/, "");
}

export function avatarMarkup(player: DrawPlayer) {
  if (!player.avatar) return "";
  const url = player.avatar.startsWith("/draw-picture/")
    ? drawServerUrl() + player.avatar
    : player.avatar;
  return `<img class="draw-avatar" src="${escape(url)}" alt="" draggable="false" width="96" height="72">`;
}
