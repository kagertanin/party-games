import {
  normalizeCaption,
  prepareReveal,
  setHeart,
  heartCounts,
  revealedBefore,
  applyRevealFrame,
  type DrawOption as Option,
} from "../shared/draw-reveal.js";
import { Room, type Client } from "@colyseus/core";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  DRAW_MIN,
  DRAW_KICKED,
  drawIntro,
  DRAW_MAX,
  DRAW_TIMES,
  type Phase,
  type DrawView,
  type DrawPlayer,
} from "../shared/draw.js";
import { pictureSlot } from "./draw-images.js";
import { prompts } from "./draw-prompts.js";

function shuffle<T>(values: T[]) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; --i) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
type Picture = { prompt: string; slot: ReturnType<typeof pictureSlot> };
export class DrawRoom extends Room {
  private phase: Phase = "lobby";
  private epoch = 0;
  private deadline = 0;
  private host = "";
  private members = new Map<string, DrawPlayer>();
  private reconnecting = new Map<
    string,
    ReturnType<DrawRoom["allowReconnection"]>
  >();
  private pictures = new Map<string, Picture>();
  private order: string[] = [];
  private turn = 0;
  private submitted = new Set<string>();
  private captions = new Map<string, string>();
  private choices: Option[] = [];
  private votes = new Map<string, string>();
  private hearts = new Map<string, Set<string>>();
  private startedAt = 0;
  private beats: ReturnType<typeof prepareReveal> = [];
  private beat = 0;
  onCreate() {
    this.roomId = "R" + randomBytes(3).toString("hex").toUpperCase();
    this.maxClients = DRAW_MAX;
    this.setPrivate(true);
    this.onMessage("sync", (client) => this.sendView(client));
    this.onMessage("play", (client, msg) => {
      if (
        !msg ||
        msg.epoch !== this.epoch ||
        !this.members.has(client.sessionId)
      )
        return this.sendView(client);
      if (this.expired()) {
        this.advance();
        return;
      }
      try {
        this.action(client.sessionId, msg);
      } catch (error) {
        client.send("problem", (error as Error).message);
        return;
      }
      this.update();
    });
    this.setSimulationInterval(() => {
      if (this.expired()) this.advance();
    }, 150);
  }
  onJoin(client: Client, opts: { name?: unknown }) {
    const name =
      typeof opts?.name === "string" ? opts.name.trim().slice(0, 24) : "";
    if (this.phase !== "lobby" || !name)
      throw Error("Комната недоступна или не указано имя.");
    const id = client.sessionId;
    this.members.set(id, {
      id,
      name,
      connected: true,
      points: 0,
      guesses: 0,
      fooled: 0,
      likes: 0,
      streak: 0,
    });
    this.host ||= id;
    this.broadcastView();
  }
  async onLeave(client: Client, consented: boolean) {
    const p = this.members.get(client.sessionId);
    if (!p) return;
    p.connected = false;
    if (this.host === p.id)
      this.host = [...this.members.values()].find((m) => m.connected)?.id ?? "";
    this.broadcastView();
    if (!consented) {
      try {
        const reservation = this.allowReconnection(client, 180);
        this.reconnecting.set(p.id, reservation);
        const resumed = await reservation;
        if (!this.members.has(p.id)) {
          void resumed.leave(4002);
          return;
        }
        p.connected = true;
        this.host ||= p.id;
        this.broadcastView();
        return;
      } catch {
        /* The seat expired or the host removed it. */
      } finally {
        this.reconnecting.delete(p.id);
      }
    }
    if (this.phase === "lobby") this.members.delete(p.id);
    this.broadcastView();
  }
  onDispose() {
    this.clearPictures();
  }
  private clearPictures() {
    for (const p of this.pictures.values()) p.slot.dispose();
    this.pictures.clear();
  }
  private setStage(phase: Phase) {
    this.phase = phase;
    this.epoch++;
    this.startedAt = Date.now();
    this.deadline =
      phase === "lobby" || phase === "results"
        ? 0
        : this.startedAt + DRAW_TIMES[phase] + drawIntro(phase);
  }
  private start() {
    const players = [...this.members.values()].filter((p) => p.connected);
    if (players.length < DRAW_MIN) throw Error("Нужно минимум три игрока.");
    this.lock();
    for (const [id, player] of this.members)
      if (!player.connected) this.members.delete(id);
    this.clearPictures();
    const phrases = shuffle(prompts);
    this.order = shuffle(players.map((p) => p.id));
    this.turn = 0;
    this.submitted.clear();
    this.setStage("drawing");
    for (const id of this.order) {
      const slot = pictureSlot(
        () =>
          this.phase === "drawing" &&
          !this.submitted.has(id) &&
          !this.expired(),
      );
      this.pictures.set(id, { prompt: phrases.pop()!, slot });
    }
  }
  private expired() {
    return (
      this.deadline > 0 &&
      Date.now() >= this.deadline + (this.phase === "drawing" ? 2000 : 0)
    );
  }
  private get artist() {
    return this.order[this.turn];
  }
  private action(
    id: string,
    msg: {
      type?: unknown;
      text?: unknown;
      choice?: unknown;
      likes?: unknown;
      member?: unknown;
    },
  ) {
    if (this.phase === "lobby" && id === this.host && msg.type === "kick") {
      if (
        typeof msg.member !== "string" ||
        msg.member === id ||
        !this.members.has(msg.member)
      )
        return;
      const target = this.clients.find((c) => c.sessionId === msg.member);
      this.members.delete(msg.member);
      this.reconnecting.get(msg.member)?.reject(new Error("Removed by host"));
      if (target) target.leave(DRAW_KICKED, "Removed by host");
      return;
    }
    if (this.phase === "lobby" && id === this.host && msg.type === "start")
      return this.start();
    if (this.phase === "results" && id === this.host && msg.type === "again") {
      this.clearPictures();
      for (const p of this.members.values()) {
        if (!p.connected) this.members.delete(p.id);
        else
          Object.assign(p, {
            points: 0,
            guesses: 0,
            fooled: 0,
            likes: 0,
            streak: 0,
          });
      }
      this.order = [];
      this.setStage("lobby");
      this.unlock();
      return;
    }
    if (
      this.phase === "drawing" &&
      msg.type === "ready" &&
      this.pictures.get(id)?.slot.exists()
    ) {
      this.submitted.add(id);
      return;
    }
    if (
      this.phase === "captions" &&
      msg.type === "caption" &&
      id !== this.artist &&
      !this.captions.has(id)
    ) {
      const text = typeof msg.text === "string" ? msg.text.trim() : "";
      const key = normalizeCaption(text);
      if (!key || text.length > 80)
        throw Error("Введите подпись до 80 знаков.");
      if (
        [
          this.pictures.get(this.artist)!.prompt,
          ...this.captions.values(),
        ].some((s) => normalizeCaption(s) === key)
      )
        throw Error("Такой вариант уже есть. Попробуйте другую подпись.");
      this.captions.set(id, text);
      return;
    }
    if (
      this.phase === "reveal" &&
      this.beats[this.beat].frame.kind === "favorites" &&
      msg.type === "like"
    ) {
      setHeart(
        this.choices,
        this.hearts,
        this.members,
        id,
        msg.choice,
        msg.likes,
      );
      return;
    }
    if (this.phase !== "vote") return;
    const option = this.choices.find(
      (o) => o.id === msg.choice && o.author !== id,
    );
    if (
      msg.type === "vote" &&
      id !== this.artist &&
      option &&
      !this.votes.has(id)
    )
      this.votes.set(id, option.id);
  }
  private expected() {
    return this.phase === "drawing"
      ? this.order.length
      : Math.max(0, this.order.length - 1);
  }
  private ready() {
    return this.phase === "drawing"
      ? this.submitted.size
      : this.phase === "captions"
        ? this.captions.size
        : this.votes.size;
  }
  private update() {
    if (
      ["drawing", "captions", "vote"].includes(this.phase) &&
      this.ready() >= this.expected()
    )
      this.advance();
    else this.broadcastView();
  }
  private nextPicture() {
    this.captions.clear();
    this.choices = [];
    this.votes.clear();
    this.hearts.clear();
    this.beats = [];
    this.beat = 0;
    this.setStage(this.turn < this.order.length ? "captions" : "results");
  }
  private advance() {
    switch (this.phase) {
      case "drawing":
        this.nextPicture();
        break;
      case "captions":
        this.choices = shuffle([
          {
            id: randomUUID(),
            author: this.artist,
            text: this.pictures.get(this.artist)!.prompt,
            truth: true,
          },
          ...[...this.captions].map(([author, text]) => ({
            id: randomUUID(),
            author,
            text,
            truth: false,
          })),
        ]);
        this.setStage("vote");
        break;
      case "vote":
        this.beats = prepareReveal(this.choices, this.votes, this.members);
        this.beat = 0;
        this.setStage("reveal");
        this.showBeat();
        break;
      case "reveal":
        if (++this.beat < this.beats.length) {
          this.showBeat();
          break;
        }
        this.turn++;
        this.nextPicture();
        break;
      default:
        return;
    }
    this.broadcastView();
  }
  private showBeat() {
    const { frame, duration } = this.beats[this.beat];
    this.startedAt = Date.now();
    this.deadline =
      this.startedAt + duration + (this.beat === 0 ? drawIntro("reveal") : 0);
    applyRevealFrame(frame, this.members, this.artist);
  }
  private sendView(client: Client) {
    const you = client.sessionId;
    const pic = this.pictures.get(this.artist);
    const v: DrawView = {
      you,
      host: this.host,
      code: this.roomId,
      phase: this.phase,
      epoch: this.epoch,
      deadline: this.deadline,
      startedAt: this.startedAt,
      now: Date.now(),
      turn: this.turn,
      total: this.order.length,
      players: [...this.members.values()],
      expected: this.expected(),
      ready: this.ready(),
      done: false,
    };
    if (this.phase === "drawing") {
      const own = this.pictures.get(you);
      v.prompt = own?.prompt;
      v.upload = own?.slot.upload;
      v.done = this.submitted.has(you);
    }
    if (["captions", "vote", "reveal"].includes(this.phase)) {
      v.picture = pic?.slot.exists() ? pic.slot.url : undefined;
      v.artist = this.artist;
      v.done =
        this.phase === "captions"
          ? this.captions.has(you)
          : this.votes.has(you);
    }
    const publicOption = (o: Option) => ({
      id: o.id,
      text: o.text,
      mine: o.author === you,
    });
    if (this.phase === "vote") {
      v.choices = this.choices.map(publicOption);
      v.votedFor = this.votes.get(you);
    }
    if (this.phase === "reveal") {
      v.reveal = this.beats[this.beat].frame;
      v.revealed = revealedBefore(this.beats, this.beat);
      if (v.reveal.kind === "favorites") {
        v.liked = [...(this.hearts.get(you) ?? [])];
        v.heartCounts = heartCounts(this.hearts);
      }
    }
    client.send("view", v);
  }
  private broadcastView() {
    for (const c of this.clients) this.sendView(c);
  }
}
