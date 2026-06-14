// Coworker Simulation & Eval Harness — VirtualClock (H0).
//
// A deterministic discrete-event clock. Simulated time only advances when the
// scenario advances it; scheduled events (the T-24h confirmation watch, ETA and
// SLA timers) fire in due-time order with no wall-clock waiting. This is the
// `VirtualClock`/`ClockPort` part of the harness model (ADR-2, requirement R3,
// constraint C4) in 2026-06-14-coworker-simulation-eval-harness-design.html.
//
// Pure: the only time source is the injected `start` instant and explicit
// advances — never `Date.now()`. Modules under test receive `now` from here.

/** Epoch milliseconds. The harness's single notion of "now". */
export type Instant = number;

export type FireFn = () => void | Promise<void>;

interface ScheduledEvent {
  id: string;
  dueAt: Instant;
  /** Insertion order — stable tiebreak so same-instant events fire deterministically. */
  seq: number;
  fire: FireFn;
}

export class VirtualClock {
  private current: Instant;
  private timers: ScheduledEvent[] = [];
  private seq = 0;

  constructor(start: Instant) {
    if (!Number.isFinite(start)) throw new Error("VirtualClock start must be a finite instant");
    this.current = start;
  }

  /** Construct from an ISO-8601 string (deterministic; no argless Date). */
  static fromIso(iso: string): VirtualClock {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) throw new Error(`VirtualClock.fromIso: unparseable instant "${iso}"`);
    return new VirtualClock(ms);
  }

  now(): Instant {
    return this.current;
  }

  nowIso(): string {
    return new Date(this.current).toISOString();
  }

  /** Schedule a one-shot event at an absolute instant. Returns its id. */
  scheduleAt(dueAt: Instant, fire: FireFn, id?: string): string {
    if (!Number.isFinite(dueAt)) throw new Error("scheduleAt: dueAt must be a finite instant");
    const eventId = id ?? `evt-${this.seq + 1}`;
    this.timers.push({ id: eventId, dueAt, seq: ++this.seq, fire });
    return eventId;
  }

  /** Schedule a one-shot event `delayMs` from now. */
  scheduleIn(delayMs: number, fire: FireFn, id?: string): string {
    return this.scheduleAt(this.current + delayMs, fire, id);
  }

  /** Cancel a pending event. Returns true if one was removed. */
  cancel(id: string): boolean {
    const before = this.timers.length;
    this.timers = this.timers.filter((t) => t.id !== id);
    return this.timers.length < before;
  }

  /** Count of events not yet fired. */
  pending(): number {
    return this.timers.length;
  }

  /**
   * Advance simulated time to `target`, firing every event due at or before it
   * in (dueAt, insertion-order) sequence. An event's `fire` may schedule further
   * events; those fire too if they fall at/before `target`. Cannot move backward.
   * Returns the number of events fired.
   */
  async advanceTo(target: Instant): Promise<number> {
    if (!Number.isFinite(target)) throw new Error("advanceTo: target must be a finite instant");
    if (target < this.current) {
      throw new Error(`VirtualClock cannot move backward (now=${this.current}, target=${target})`);
    }
    let fired = 0;
    for (;;) {
      const next = this.timers
        .filter((t) => t.dueAt <= target)
        .sort((a, b) => a.dueAt - b.dueAt || a.seq - b.seq)[0];
      if (!next) break;
      // Advance the clock to the event's due time (never backward) before firing,
      // so an event observes the correct `now()`.
      this.current = Math.max(this.current, next.dueAt);
      this.timers = this.timers.filter((t) => t.id !== next.id);
      await next.fire();
      fired++;
    }
    this.current = target;
    return fired;
  }

  /** Advance simulated time by a relative duration. */
  async advanceBy(durationMs: number): Promise<number> {
    if (durationMs < 0) throw new Error("advanceBy: duration must be non-negative");
    return this.advanceTo(this.current + durationMs);
  }
}

/** Common durations in milliseconds, for readable scenario scripts. */
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
