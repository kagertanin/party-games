import {
  drawIntro,
  DRAW_TIMES,
  type DrawView,
  type DrawPlayer,
  type Phase,
} from "../../shared/draw";
import {
  applyRevealFrame,
  normalizeCaption,
  prepareReveal,
  setHeart,
  heartCounts,
  revealedBefore,
  type DrawOption,
} from "../../shared/draw-reveal";
import type { Stroke } from "./canvas";
import { demoExamples } from "./demo-examples";

// Completed portraits for the four demo players, independent of the secret prompts.
const portraits = [
  new URL("./art/avatars/anya.png", import.meta.url).href,
  new URL("./art/avatars/borya.png", import.meta.url).href,
  new URL("./art/avatars/ira.png", import.meta.url).href,
  new URL("./art/avatars/leva.png", import.meta.url).href,
];

export class DrawDemo {
  readonly players: DrawPlayer[] = demoExamples.map(({ name }, index) => ({
    id: "d" + index,
    name,
    connected: true,
    avatar: portraits[index],
    points: 0,
    guesses: 0,
    fooled: 0,
    likes: 0,
    streak: 0,
  }));
  private members = new Map(this.players.map((p) => [p.id, p]));
  // A friend's picture comes first so a solo player can try writing and voting immediately.
  private order = [...this.players.slice(1), this.players[0]];
  readonly drawings = new Map(this.players.map((p) => [p.id, [] as Stroke[]]));
  readonly captionDrafts = new Map<string, string>();
  perspective = "auto";
  phase: Phase = "drawing";
  private turn = 0;
  private epoch = 1;
  private startedAt = Date.now();
  deadline = this.startedAt + DRAW_TIMES.drawing + drawIntro("drawing");
  private submitted = new Set<string>();
  private captions = new Map<string, string>();
  private votes = new Map<string, string>();
  private hearts = new Map<string, Set<string>>();
  private choices: DrawOption[] = [];
  private beats: ReturnType<typeof prepareReveal> = [];
  private beat = 0;
  private get artist() {
    return this.order[this.turn].id;
  }
  private example(id: string) {
    return demoExamples[this.players.findIndex((p) => p.id === id)];
  }
  get you() {
    if (this.members.has(this.perspective)) return this.perspective;
    const primary = this.players[0].id;
    return (this.phase === "captions" || this.phase === "vote") &&
      this.artist === primary
      ? this.players[1].id
      : primary;
  }
  private get guessers() {
    return this.players.filter((p) => p.id !== this.artist);
  }
  private enter(phase: Phase) {
    this.phase = phase;
    this.epoch++;
    this.startedAt = Date.now();
    this.deadline =
      phase === "results" || phase === "lobby"
        ? 0
        : this.startedAt + drawIntro(phase) + DRAW_TIMES[phase];
  }
  private newPicture() {
    this.captions.clear();
    this.votes.clear();
    this.hearts.clear();
    this.choices = [];
    this.captionDrafts.clear();
    this.beats = [];
    this.enter(this.turn === this.order.length ? "results" : "captions");
  }
  private options() {
    const example = this.example(this.artist);
    const used = new Set(
      [example.prompt, ...this.captions.values()].map(normalizeCaption),
    );
    for (const p of this.guessers) {
      if (this.captions.has(p.id)) continue;
      const text = example.captions.find(
        (c) => !used.has(normalizeCaption(c)),
      )!;
      used.add(normalizeCaption(text));
      this.captions.set(p.id, text);
    }
    this.choices = [
      {
        id: "answer-" + this.artist,
        author: this.artist,
        text: example.prompt,
        truth: true,
      },
      ...[...this.captions].map(([author, text]) => ({
        id: "answer-" + author,
        author,
        text,
        truth: false,
      })),
    ];
    for (let i = this.choices.length - 1; i > 0; i--) {
      const k = Math.floor(Math.random() * (i + 1));
      [this.choices[k], this.choices[i]] = [this.choices[i], this.choices[k]];
    }
  }
  private simulateVotes() {
    const truth = this.choices.find((o) => o.truth)!;
    for (const [i, p] of this.guessers.entries()) {
      const decoys = this.choices.filter((o) => !o.truth && o.author !== p.id);
      const favorite = decoys[(i + this.turn) % decoys.length];
      if (!this.votes.has(p.id)) {
        this.votes.set(
          p.id,
          (i === this.turn % this.guessers.length ? favorite : truth).id,
        );
      }
    }
  }
  private simulateFavorites() {
    for (const [i, p] of this.players.entries()) {
      if (p.id === this.you) continue;
      const options = this.choices.filter((o) => o.author !== p.id);
      const pick = options[(i + this.turn) % options.length];
      setHeart(this.choices, this.hearts, this.members, p.id, pick.id, true);
    }
  }
  private revealBeat() {
    const { frame, duration } = this.beats[this.beat];
    this.startedAt = Date.now();
    this.deadline =
      this.startedAt + duration + (this.beat === 0 ? drawIntro("reveal") : 0);
    applyRevealFrame(frame, this.members, this.artist);
    if (frame.kind === "favorites") this.simulateFavorites();
  }
  next() {
    switch (this.phase) {
      case "drawing":
        for (const p of this.players) {
          if (!this.submitted.has(p.id) && !this.drawings.get(p.id)!.length)
            this.drawings.set(p.id, this.example(p.id).strokes);
        }
        this.newPicture();
        break;
      case "captions":
        this.options();
        this.enter("vote");
        break;
      case "vote":
        this.simulateVotes();
        this.beats = prepareReveal(this.choices, this.votes, this.members);
        this.beat = 0;
        this.enter("reveal");
        this.revealBeat();
        break;
      case "reveal":
        if (++this.beat < this.beats.length) this.revealBeat();
        else {
          this.turn++;
          this.newPicture();
        }
        break;
    }
  }
  finish() {
    while (this.phase !== "results") this.next();
  }
  act(type: string, data: Record<string, unknown> = {}) {
    const id = this.you;
    if (this.phase === "drawing" && type === "ready") {
      this.submitted.add(id);
      if (
        this.perspective === "auto" ||
        this.submitted.size === this.players.length
      )
        this.next();
    } else if (
      this.phase === "captions" &&
      type === "caption" &&
      id !== this.artist &&
      !this.captions.has(id)
    ) {
      const text = String(data.text ?? "").trim(),
        key = normalizeCaption(text);
      if (!key || text.length > 80)
        throw Error("Введите подпись до 80 знаков.");
      if (
        [this.example(this.artist).prompt, ...this.captions.values()].some(
          (s) => normalizeCaption(s) === key,
        )
      )
        throw Error("Такой вариант уже есть. Попробуйте другую подпись.");
      this.captions.set(id, text);
      if (
        this.perspective === "auto" ||
        this.captions.size === this.guessers.length
      )
        this.next();
    } else if (
      this.phase === "reveal" &&
      this.beats[this.beat].frame.kind === "favorites" &&
      type === "like"
    ) {
      setHeart(
        this.choices,
        this.hearts,
        this.members,
        id,
        data.choice,
        data.likes,
      );
    } else if (this.phase === "vote") {
      const opt = this.choices.find(
        (o) => o.id === data.choice && o.author !== id,
      );
      if (!opt) return;
      if (type === "vote" && id !== this.artist && !this.votes.has(id)) {
        this.votes.set(id, opt.id);
        if (
          this.perspective === "auto" ||
          this.votes.size === this.guessers.length
        )
          this.next();
      }
    }
  }
  snapshot(): DrawView {
    const you = this.you,
      phase = this.phase;
    const v: DrawView = {
      you,
      host: this.players[0].id,
      code: "demo",
      players: this.players,
      phase,
      turn: this.turn,
      total: this.players.length,
      epoch: this.epoch,
      startedAt: this.startedAt,
      now: Date.now(),
      deadline: this.deadline,
      expected: this.players.length - (phase === "drawing" ? 0 : 1),
      ready: 0,
      done: false,
    };
    if (phase === "drawing") {
      v.prompt = this.example(you).prompt;
      v.done = this.submitted.has(you);
      v.ready = this.submitted.size;
    } else if (phase !== "results" && phase !== "lobby") {
      v.artist = this.artist;
      v.picture = this.artist;
      if (phase === "captions") {
        v.done = this.captions.has(you);
        v.ready = this.captions.size;
      }
      if (phase === "vote") {
        v.ready = this.votes.size;
        v.done = this.votes.has(you);
        v.choices = this.choices.map((o) => ({
          id: o.id,
          text: o.text,
          mine: o.author === you,
        }));
        v.votedFor = this.votes.get(you);
      }
      if (phase === "reveal") {
        v.reveal = this.beats[this.beat].frame;
        v.revealed = revealedBefore(this.beats, this.beat);
        if (v.reveal.kind === "favorites") {
          v.liked = [...(this.hearts.get(you) ?? [])];
          v.heartCounts = heartCounts(this.hearts);
        }
      }
    }
    return v;
  }
}
