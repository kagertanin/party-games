import { Room, type Client } from "@colyseus/core";
import {
  office,
  models,
  rad,
  fits,
  target,
  walk,
  type Player,
  type Input,
  type Phase,
  type Snapshot,
} from "../shared/hide/world.js";
import { MAX_BATCH_STEPS, STEP_SECONDS } from "../shared/hide/movement.js";

interface InputStream {
  ack: number;
  received: number;
  queue: Input[];
  credit: number;
}
function inputStream(): InputStream {
  return { ack: 0, received: 0, queue: [], credit: 0 };
}
function readInput(v: Input | undefined): Input | undefined {
  if (!v || ![v.forward, v.side, v.yaw, v.pitch].every(Number.isFinite)) return;
  return { forward: clamp(v.forward, -1, 1), side: clamp(v.side, -1, 1),
    yaw: v.yaw % (2 * Math.PI), pitch: clamp(v.pitch, -1.48, 1.48) };
}
const idle = (): Input => ({ forward: 0, side: 0, yaw: 0, pitch: 0 });
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export class HideRoom extends Room {
  maxClients = 12;
  private players = new Map<string, Player>();
  private inputs = new Map<string, Input>();
  private streams = new Map<string, InputStream>();
  private shotAt = new Map<string, number>();
  private reload = new Map<string, number>();
  private history: { at: number; players: Player[] }[] = [];
  private phase: Phase = "lobby";
  private host = "";
  private until = 0;
  private winner = "";
  private ticks = 0;
  onCreate() {
    this.onMessage("sync", (c) => this.sendView(c));
    this.onMessage("role", (c, v) => {
      if (this.phase !== "lobby" || typeof v?.hunter !== "boolean") return;
      if (v.id !== c.sessionId && this.host !== c.sessionId) return;
      const p = this.players.get(v.id);
      if (p) p.hunter = v.hunter;
      this.publish();
    });
    this.onMessage("start", (c) => {
      if (this.host !== c.sessionId || this.phase !== "lobby") return;
      const all = [...this.players.values()];
      if (
        all.some((p) => !p.online) ||
        !all.some((p) => p.hunter) ||
        !all.some((p) => !p.hunter)
      )
        return;
      void this.lock();
      let hunters = 0,
        hiders = 0;
      for (const p of all) {
        const spots = p.hunter ? office.spawns.hunters : office.spawns.props;
        const i = p.hunter ? hunters++ : hiders++;
        const spawn = spots[i % spots.length];
        Object.assign(p, {
          x: spawn.at[0],
          z: spawn.at[2] + Math.floor(i / spots.length) * 0.9,
          yaw: spawn.yaw * rad,
          pitch: 0,
          facing: 0,
          form: "",
          alive: true,
          ammo: 6,
        });
        this.inputs.set(p.id, { ...idle(), yaw: p.yaw });
        this.streams.set(p.id, inputStream());
      }
      this.history = [];
      this.reload.clear();
      this.shotAt.clear();
      this.phase = "hide";
      this.until = Date.now() + 120000;
      this.publish();
    });
    this.onMessage("again", (c) => {
      if (c.sessionId !== this.host || this.phase !== "results") return;
      const members = [...this.players.values()];
      const previous = members.map((p) => p.hunter),
        shift = Math.max(1, previous.filter(Boolean).length);
      members.forEach(
        (p, i) =>
          (p.hunter = previous[(i - shift + members.length) % members.length]),
      );
      this.phase = "lobby";
      this.winner = "";
      this.until = 0;
      void this.unlock();
      this.publish();
    });
    this.onMessage("input", (c, v) => {
      const p = this.players.get(c.sessionId);
      const input = readInput(v);
      if (!p || !this.active(p) || !input || this.streams.get(p.id)?.received) return;
      this.inputs.set(p.id, input);
    });
    this.onMessage("move", (c, batch) => {
      const p = this.players.get(c.sessionId);
      if (!p || !this.active(p) || !Array.isArray(batch?.inputs) ||
          !batch.inputs.length || batch.inputs.length > MAX_BATCH_STEPS) return;
      const stream = this.streams.get(p.id)!;
      if (batch.first !== stream.received + 1) return;
      const inputs: Input[] = [];
      for (const raw of batch.inputs) {
        const input = readInput(raw);
        if (!input) return;
        inputs.push(input);
      }
      stream.received += inputs.length;
      stream.queue.push(...inputs);
      // Discard stale motion following a long WebSocket stall. The next ack
      // retires the skipped samples too; an old key press cannot run for seconds.
      if (stream.queue.length > 18) stream.queue.splice(0, stream.queue.length - 18);
    });
    this.onMessage("use", (c, v) => {
      const p = this.players.get(c.sessionId);
      if (!p || !this.active(p)) return;
      const input = readInput(v?.aim) ?? this.inputs.get(p.id)!;
      p.yaw = input.yaw;
      p.pitch = input.pitch;
      if (p.hunter) {
        const now = Date.now();
        if (!p.ammo || now - (this.shotAt.get(p.id) ?? 0) < 240) return;
        this.shotAt.set(p.id, now);
        if (p.ammo === 6) this.reload.set(p.id, now + 5000);
        p.ammo--;
        const at = clamp(
          Number.isFinite(v?.seen) ? v.seen : now,
          now - 300,
          now,
        );
        const past = [...this.history]
          .reverse()
          .find((h) => h.at <= at)?.players;
        const hit = this.players.get(
          target(p, past ?? [...this.players.values()]).id,
        );
        const found = Boolean(hit?.alive);
        if (hit && found) {
          hit.alive = false;
          p.ammo = 6;
          this.reload.delete(p.id);
        }
        c.send("feedback", found ? "Найден игрок!" : "Промах");
        this.checkEnd();
      } else {
        const t = target(p);
        if (t.prop < 0 || t.distance > 4)
          return c.send("feedback", "Подойдите и наведитесь на предмет");
        const prop = office.props[t.prop];
        const next = { ...p, form: prop.id, facing: (prop.yaw ?? 0) * rad };
        if (!models[prop.id].disguise || !fits(next, p.x, p.z))
          return c.send("feedback", "Для этого облика нужно другое место");
        Object.assign(p, next);
        c.send("feedback", "Облик скопирован");
      }
      this.publish();
    });
    this.setSimulationInterval((dt) => this.step(Math.min(dt, 100) / 1000), 50);
  }
  onJoin(c: Client, opts: { name?: unknown }) {
    const id = c.sessionId;
    const hunter = this.players.size === 0;
    this.players.set(id, {
      id,
      name:
        String(opts?.name ?? "Игрок")
          .trim()
          .slice(0, 24) || "Игрок",
      hunter,
      alive: true,
      online: true,
      x: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      facing: 0,
      form: "",
      ammo: 6,
    });
    this.inputs.set(id, idle());
    this.streams.set(id, inputStream());
    if (!this.host) this.host = id;
    this.publish();
  }
  async onLeave(c: Client, consented: boolean) {
    const p = this.players.get(c.sessionId);
    if (!p) return;
    p.online = false;
    const stream = this.streams.get(p.id)!;
    stream.queue.length = 0;
    stream.ack = stream.received;
    stream.credit = 0;
    this.inputs.set(p.id, { ...idle(), yaw: p.yaw, pitch: p.pitch });
    this.publish();
    if (!consented)
      try {
        await this.allowReconnection(c, 90);
        p.online = true;
        this.publish();
        return;
      } catch {}
    this.players.delete(p.id);
    this.inputs.delete(p.id);
    this.streams.delete(p.id);
    if (this.host === p.id)
      this.host =
        [...this.players.values()].find((o) => o.online)?.id ??
        this.players.keys().next().value ??
        "";
    this.checkEnd();
    this.publish();
  }
  private active(p: Player) {
    return (
      p.alive &&
      p.online &&
      (this.phase === "hunt" || (this.phase === "hide" && !p.hunter))
    );
  }
  private checkEnd() {
    if (this.phase !== "hunt" && this.phase !== "hide") return;
    const all = [...this.players.values()];
    if (!all.some((p) => !p.hunter && p.alive)) this.finish("Водящие");
    else if (!all.some((p) => p.hunter)) this.finish("Прячущиеся");
  }
  private finish(winner: string) {
    this.winner = winner;
    this.phase = "results";
    this.until = 0;
  }
  private step(dt: number) {
    if (this.phase !== "hunt" && this.phase !== "hide") return;
    const now = Date.now();
    if (now >= this.until) {
      if (this.phase === "hide") {
        this.phase = "hunt";
        this.until = now + 300000;
      } else this.finish("Прячущиеся");
    }
    for (const p of this.players.values()) {
      if (this.active(p)) {
        const stream = this.streams.get(p.id)!;
        // Budget steps from elapsed SERVER time. Jitter may spend a small
        // accumulated budget, but sending more packets cannot increase speed.
        stream.credit = Math.min(12, stream.credit + dt / STEP_SECONDS);
        if (stream.received) {
          const count = Math.min(stream.queue.length, Math.floor(stream.credit + 1e-8));
          for (const input of stream.queue.splice(0, count)) {
            walk(p, input, STEP_SECONDS);
            this.inputs.set(p.id, input);
          }
          stream.credit = Math.max(0, stream.credit - count);
          stream.ack = stream.received - stream.queue.length;
        } else {
          walk(p, this.inputs.get(p.id)!, dt);
        }
      }
      if (p.ammo < 6 && now >= (this.reload.get(p.id) ?? Infinity)) {
        p.ammo++;
        this.reload.set(p.id, now + 5000);
      }
    }
    this.history.push({
      at: now,
      players: [...this.players.values()].map((p) => ({ ...p })),
    });
    while (this.history[0].at < now - 500) this.history.shift();
    if (++this.ticks % 2 === 0) this.publish();
  }
  private sendView(c: Client) {
    const all = [...this.players.values()];
    const concealed =
      this.phase === "hide" && this.players.get(c.sessionId)?.hunter;
    const view: Snapshot = {
      ack: this.streams.get(c.sessionId)?.ack ?? 0,
      phase: this.phase,
      host: this.host,
      until: this.until,
      now: Date.now(),
      winner: this.winner,
      remaining: all.filter((p) => !p.hunter && p.alive).length,
      players: concealed ? all.filter((p) => p.hunter) : all,
    };
    c.send("view", view);
  }
  private publish() {
    for (const c of this.clients) this.sendView(c);
  }
}
