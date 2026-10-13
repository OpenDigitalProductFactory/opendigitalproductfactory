import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetJourneysForTest,
  beginJourney,
  completeJourney,
  flushTelemetry,
  queueWebVital,
  type JourneyEnvironment,
} from "./journeys";

function fakeEnv(overrides: Partial<JourneyEnvironment> = {}) {
  let now = 1000;
  const frames: Array<() => void> = [];
  const macrotasks: Array<() => void> = [];
  const beacons: Array<{ url: string; body: string }> = [];
  const env: JourneyEnvironment = {
    now: () => now,
    requestFrame: (cb) => frames.push(cb),
    afterFrame: (cb) => macrotasks.push(cb),
    sendBeacon: (url, body) => {
      beacons.push({ url, body });
      return true;
    },
    serverTimingMs: () => undefined,
    ...overrides,
  };
  return {
    env,
    advance: (ms: number) => {
      now += ms;
    },
    paint: () => {
      frames.splice(0).forEach((f) => f());
      macrotasks.splice(0).forEach((f) => f());
    },
    beacons,
  };
}

function sentSamples(beacons: Array<{ body: string }>) {
  return beacons.flatMap((b) => JSON.parse(b.body).samples);
}

describe("journey queue (BI-BD0B0DCC)", () => {
  beforeEach(() => __resetJourneysForTest());
  afterEach(() => vi.restoreAllMocks());

  it("measures from the interaction to the first painted frame after completion (AC-1)", () => {
    const t = fakeEnv();
    beginJourney("thread-open", t.env);
    t.advance(120);
    completeJourney("thread-open", {}, t.env);
    t.advance(16);
    t.paint();
    flushTelemetry(t.env);
    expect(sentSamples(t.beacons)).toEqual([{ kind: "journey", journey: "thread-open", totalMs: 136 }]);
  });

  it("emits exactly one sample per completed journey, and a completion with no begin is a no-op (AC-1)", () => {
    const t = fakeEnv();
    completeJourney("message-ack", {}, t.env);
    beginJourney("message-ack", t.env);
    completeJourney("message-ack", {}, t.env);
    completeJourney("message-ack", {}, t.env);
    t.paint();
    flushTelemetry(t.env);
    expect(sentSamples(t.beacons)).toHaveLength(1);
  });

  it("attaches the serving request's Server-Timing share (AC-2)", () => {
    const t = fakeEnv({ serverTimingMs: (url) => (url === "/api/agent/send" ? 42 : undefined) });
    beginJourney("message-ack", t.env);
    t.advance(90);
    completeJourney("message-ack", { serverUrl: "/api/agent/send" }, t.env);
    t.paint();
    flushTelemetry(t.env);
    expect(sentSamples(t.beacons)).toEqual([{ kind: "journey", journey: "message-ack", totalMs: 90, serverMs: 42 }]);
  });

  it("makes no network call on begin, complete or vital queueing until a flush trigger (AC-7)", () => {
    const t = fakeEnv();
    for (let i = 0; i < 5; i++) {
      beginJourney("coworker-open", t.env);
      completeJourney("coworker-open", {}, t.env);
      t.paint();
      queueWebVital({ name: "INP", value: 40 }, "/workspace", t.env);
    }
    expect(t.beacons).toHaveLength(0);
    flushTelemetry(t.env);
    expect(t.beacons).toHaveLength(1);
    expect(t.beacons[0].url).toBe("/api/telemetry/journeys");
  });

  it("flushes on its own once 20 samples are queued (AC-7)", () => {
    const t = fakeEnv();
    for (let i = 0; i < 20; i++) queueWebVital({ name: "LCP", value: 800 }, "/build", t.env);
    expect(t.beacons).toHaveLength(1);
    expect(sentSamples(t.beacons)).toHaveLength(20);
  });

  it("queues vitals with their top-level section and drops unknown metric names", () => {
    const t = fakeEnv();
    queueWebVital({ name: "CLS", value: 0.02 }, "/workspace/inbox", t.env);
    queueWebVital({ name: "FID", value: 3 }, "/workspace", t.env);
    flushTelemetry(t.env);
    expect(sentSamples(t.beacons)).toEqual([{ kind: "vital", metric: "CLS", value: 0.02, section: "workspace" }]);
  });

  it("an empty queue sends nothing", () => {
    const t = fakeEnv();
    flushTelemetry(t.env);
    expect(t.beacons).toHaveLength(0);
  });
});
