import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { Room, Server, type Client } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import {
  act,
  addPlayer,
  balanceTeams,
  createGame,
  tick,
  view,
  type Action,
} from "../shared/game.js";

export class HatRoom extends Room {
  game = createGame("");
  private results = new Map<string, Map<string, string | null>>();
  private emptyTimer?: ReturnType<typeof setTimeout>;
  onCreate() {
    this.roomId = randomBytes(4).toString("hex").toUpperCase();
    this.maxClients = 15;
    this.autoDispose = false;
    this.setPrivate(true);
    // Private rooms are invited by their short ID, never listed publicly.
    this.onMessage("sync", (client) => this.sendView(client));
    this.onMessage(
      "action",
      (client, envelope: { id?: string; action?: Action }) => {
        if (
          !envelope ||
          typeof envelope.id !== "string" ||
          envelope.id.length > 80 ||
          !envelope.action ||
          typeof envelope.action.type !== "string"
        ) {
          client.send("rejected", "Некорректная команда.");
          return;
        }
        let history = this.results.get(client.sessionId);
        if (!history) {
          history = new Map();
          this.results.set(client.sessionId, history);
        }
        const signature = JSON.stringify(envelope.action);
        const entry = history.get(envelope.id);
        if (entry !== undefined || history.has(envelope.id)) {
          if (entry !== signature)
            client.send("rejected", "Номер команды уже использован.");
          this.sendView(client);
          return;
        }
        if (history.size >= 4096) {
          client.send(
            "rejected",
            "Лимит действий достигнут. Начните новую комнату.",
          );
          return;
        }
        try {
          act(this.game, client.sessionId, envelope.action, Date.now());
          history.set(envelope.id, signature);
        } catch (e) {
          client.send("rejected", (e as Error).message);
        }
        this.sendAll();
      },
    );
    this.setSimulationInterval(() => {
      if (tick(this.game, Date.now())) this.sendAll();
    }, 100);
  }
  onJoin(client: Client, options: { name?: unknown }) {
    clearTimeout(this.emptyTimer);
    if (typeof options.name !== "string") throw new Error("Введите имя.");
    if (!this.game.owner) this.game.owner = client.sessionId;
    addPlayer(this.game, client.sessionId, options.name);
    this.sendAll();
  }
  async onLeave(client: Client, consented: boolean) {
    const player = this.game.players.find((p) => p.id === client.sessionId);
    if (!player) return;
    player.connected = false;
    this.game.revision++;
    this.sendAll();
    if (this.game.players.every((p) => !p.connected))
      this.emptyTimer = setTimeout(() => void this.disconnect(), 300_000);
    try {
      if (consented) throw new Error("Игрок вышел");
      await this.allowReconnection(client, 300);
      clearTimeout(this.emptyTimer);
      player.connected = true;
      this.game.revision++;
      this.sendAll();
    } catch {
      if (this.game.phase === "lobby") {
        this.game.players = this.game.players.filter(
          (p) => p.id !== client.sessionId,
        );
        balanceTeams(this.game);
      }
      if (this.game.owner === client.sessionId)
        this.game.owner =
          this.game.players.find((p) => p.connected)?.id ?? this.game.owner;
      this.game.revision++;
      this.sendAll();
    }
  }
  onDispose() {
    clearTimeout(this.emptyTimer);
  }
  private sendView(client: Client) {
    client.send("view", view(this.game, client.sessionId, Date.now()));
  }
  private sendAll() {
    for (const client of this.clients) this.sendView(client);
  }
}
export async function startServer(port = Number(process.env.PORT || 2567)) {
  const root = resolve("dist");
  const http = createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(req.url || "/", "http://localhost").pathname,
      );
      const file = resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!file.startsWith(root + "/")) {
        res.writeHead(403);
        res.end();
        return;
      }
      const body = await readFile(file);
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".woff2": "font/woff2",
      };
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  const server = new Server({
    transport: new WebSocketTransport({ server: http, maxPayload: 16_384 }),
  });
  server.define("hat", HatRoom);
  await server.listen(port, "0.0.0.0");
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const server = await startServer();
  console.log(`Party Games listening on ${process.env.PORT || 2567}`);
  process.on("SIGTERM", () => void server.gracefullyShutdown(false));
  process.on("SIGINT", () => void server.gracefullyShutdown(false));
}
