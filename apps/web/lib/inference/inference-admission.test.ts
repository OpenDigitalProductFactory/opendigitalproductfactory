import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetInferenceAdmissionForTest,
  acquireInferenceSlot,
  currentInferenceOrigin,
  engineKeyForProvider,
  getInferenceAdmissionSnapshot,
  isAdmissionTimeout,
  resolveEngineLimit,
  withInferenceOrigin,
  withInferenceCancellation,
  currentInferenceSignal,
  withInferenceAdmissionObserver,
  type InferenceAdmissionEvent,
} from "./inference-admission";

const ENV_KEYS = [
  "DPF_INFERENCE_MAX_CONCURRENCY_LOCAL",
  "DPF_INFERENCE_MAX_CONCURRENCY_REMOTE",
  "DPF_INFERENCE_ADMISSION_TIMEOUT_MS",
  "DPF_INFERENCE_ADMISSION_TIMEOUT_MS_AUTONOMOUS",
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  __resetInferenceAdmissionForTest();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  __resetInferenceAdmissionForTest();
});

// small helper: let queued microtasks/promises settle
const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe("caller-scoped admission evidence", () => {
  it("records real waiting and release in caller order without sharing observers", async () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "1";
    const events: Array<{ caller: string; phase: string }> = [];
    const observe = (caller: string) => (event: InferenceAdmissionEvent) => {
      expect(event.engineKey).toBe("local");
      expect(event.at).toEqual(expect.any(Number));
      events.push({ caller, phase: event.phase });
    };
    const firstRelease = await withInferenceAdmissionObserver(observe("first"), () =>
      acquireInferenceSlot("local", "interactive"));
    const second = withInferenceAdmissionObserver(observe("second"), () =>
      acquireInferenceSlot("local", "interactive"));
    await tick();
    expect(events).toEqual([{ caller: "first", phase: "acquired" }, { caller: "second", phase: "queued" }]);
    firstRelease();
    const secondRelease = await second;
    secondRelease();
    secondRelease();
    expect(events.map(e => `${e.caller}:${e.phase}`)).toEqual([
      "first:acquired", "second:queued", "first:released", "second:acquired", "second:released",
    ]);
    const unobservedRelease = await acquireInferenceSlot("local", "interactive");
    unobservedRelease();
    expect(events).toHaveLength(5);
    expect(getInferenceAdmissionSnapshot().local.active).toBe(0);
  });

  it("cannot fail or leak a slot when observation throws", async () => {
    const release = await withInferenceAdmissionObserver(() => { throw new Error("observer failed"); }, () =>
      acquireInferenceSlot("local", "interactive"));
    expect(() => release()).not.toThrow();
    expect(getInferenceAdmissionSnapshot().local.active).toBe(0);
  });

  it("records cancellation without inventing acquisition or release for a queued caller", async () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "1";
    const release = await acquireInferenceSlot("local", "interactive");
    const controller = new AbortController();
    const events: InferenceAdmissionEvent[] = [];
    const queued = withInferenceAdmissionObserver(e => events.push(e), () =>
      acquireInferenceSlot("local", "interactive", { signal: controller.signal }));
    const rejected = expect(queued).rejects.toThrow("caller stopped");
    controller.abort(new Error("caller stopped"));
    await rejected;
    release();
    expect(events.map(e => e.phase)).toEqual(["queued", "canceled"]);
    expect(getInferenceAdmissionSnapshot().local.interactiveWaiting).toBe(0);
  });
});

describe("inference origin (AsyncLocalStorage)", () => {
  it("preserves cancellation through nested origin scopes", async () => {
    const controller = new AbortController();
    const seen = await withInferenceCancellation(controller.signal, () =>
      withInferenceOrigin("autonomous", async () => currentInferenceSignal()));
    expect(seen).toBe(controller.signal);
    expect(currentInferenceSignal()).toBeUndefined();
  });

  it("removes an aborted waiter without releasing a running request", async () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "1";
    const release = await acquireInferenceSlot("local", "interactive");
    const controller = new AbortController();
    const pending = withInferenceCancellation(controller.signal, () => acquireInferenceSlot("local", "autonomous"));
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(getInferenceAdmissionSnapshot().local).toMatchObject({ active: 1, autonomousWaiting: 0 });
    release();
    expect(getInferenceAdmissionSnapshot().local.active).toBe(0);
  });

  it("releases a handed-off slot if cancellation wins before the waiter resumes", async () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "1";
    const release = await acquireInferenceSlot("local", "interactive");
    const controller = new AbortController();
    const pending = withInferenceCancellation(controller.signal, () => acquireInferenceSlot("local", "autonomous"));
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    release();
    controller.abort();
    await rejected;
    expect(getInferenceAdmissionSnapshot().local).toMatchObject({ active: 0, autonomousWaiting: 0 });
  });

  it("defaults to interactive when unset", () => {
    expect(currentInferenceOrigin()).toBe("interactive");
  });

  it("binds origin for the async subtree", async () => {
    const seen = await withInferenceOrigin("autonomous", async () => {
      await tick();
      return currentInferenceOrigin();
    });
    expect(seen).toBe("autonomous");
    // restored outside the scope
    expect(currentInferenceOrigin()).toBe("interactive");
  });
});

describe("engineKeyForProvider", () => {
  it("maps the local provider to the local engine, all else to remote", () => {
    expect(engineKeyForProvider("local")).toBe("local");
    expect(engineKeyForProvider("ollama")).toBe("local");
    expect(engineKeyForProvider("anthropic")).toBe("remote");
    expect(engineKeyForProvider("openai")).toBe("remote");
  });
});

describe("resolveEngineLimit", () => {
  it("uses safe defaults (local 1, remote 8)", () => {
    delete process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL;
    delete process.env.DPF_INFERENCE_MAX_CONCURRENCY_REMOTE;
    expect(resolveEngineLimit("local")).toBe(1);
    expect(resolveEngineLimit("remote")).toBe(8);
  });

  it("honours env overrides", () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "3";
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_REMOTE = "16";
    expect(resolveEngineLimit("local")).toBe(3);
    expect(resolveEngineLimit("remote")).toBe(16);
  });
});

describe("acquireInferenceSlot", () => {
  it("grants immediately while below the engine ceiling", async () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "2";
    const r1 = await acquireInferenceSlot("local", "interactive");
    const r2 = await acquireInferenceSlot("local", "interactive");
    expect(getInferenceAdmissionSnapshot().local.active).toBe(2);
    r1();
    r2();
    expect(getInferenceAdmissionSnapshot().local.active).toBe(0);
  });

  it("queues callers at capacity and wakes them on release", async () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "1";
    const r1 = await acquireInferenceSlot("local", "interactive");

    let acquired2 = false;
    const p2 = acquireInferenceSlot("local", "interactive").then(rel => {
      acquired2 = true;
      return rel;
    });
    await tick();
    // still waiting — no free slot
    expect(acquired2).toBe(false);
    expect(getInferenceAdmissionSnapshot().local.interactiveWaiting).toBe(1);

    r1(); // release hands the slot to the waiter
    const r2 = await p2;
    expect(acquired2).toBe(true);
    expect(getInferenceAdmissionSnapshot().local.active).toBe(1);
    r2();
    expect(getInferenceAdmissionSnapshot().local.active).toBe(0);
  });

  it("serves interactive waiters before autonomous ones", async () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "1";
    const r1 = await acquireInferenceSlot("local", "autonomous");

    const order: string[] = [];
    // autonomous enqueued FIRST, interactive SECOND — priority must reorder them
    const pAuto = acquireInferenceSlot("local", "autonomous").then(rel => {
      order.push("autonomous");
      return rel;
    });
    const pInteractive = acquireInferenceSlot("local", "interactive").then(rel => {
      order.push("interactive");
      return rel;
    });
    await tick();
    expect(getInferenceAdmissionSnapshot().local.autonomousWaiting).toBe(1);
    expect(getInferenceAdmissionSnapshot().local.interactiveWaiting).toBe(1);

    r1();
    (await pInteractive)();
    await tick();
    (await pAuto)();

    expect(order).toEqual(["interactive", "autonomous"]);
  });

  it("treats a non-positive limit as unlimited (gating disabled)", async () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "0";
    const releases = await Promise.all(
      Array.from({ length: 5 }, () => acquireInferenceSlot("local", "autonomous")),
    );
    // all granted immediately, none queued
    expect(getInferenceAdmissionSnapshot().local.interactiveWaiting).toBe(0);
    expect(getInferenceAdmissionSnapshot().local.autonomousWaiting).toBe(0);
    for (const r of releases) r();
  });

  it("release is idempotent — double release does not corrupt the count", async () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "1";
    const r1 = await acquireInferenceSlot("local", "interactive");
    r1();
    r1(); // no-op
    expect(getInferenceAdmissionSnapshot().local.active).toBe(0);
  });

  it("times out an interactive waiter via the interactive budget, tagged isAdmissionTimeout", async () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "1";
    process.env.DPF_INFERENCE_ADMISSION_TIMEOUT_MS = "20";
    const r1 = await acquireInferenceSlot("local", "interactive");
    let caught: unknown;
    await acquireInferenceSlot("local", "interactive").catch((e) => (caught = e));
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/admission timeout/);
    // the capacity-timeout is tagged so callers (e.g. cert) can requeue not fail
    expect(isAdmissionTimeout(caught)).toBe(true);
    expect(getInferenceAdmissionSnapshot().local.interactiveWaiting).toBe(0);
    r1();
  });

  it("times out an autonomous waiter via its OWN (autonomous) budget", async () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "1";
    process.env.DPF_INFERENCE_ADMISSION_TIMEOUT_MS_AUTONOMOUS = "20";
    const r1 = await acquireInferenceSlot("local", "autonomous");
    await expect(acquireInferenceSlot("local", "autonomous")).rejects.toThrow(
      /admission timeout/,
    );
    expect(getInferenceAdmissionSnapshot().local.autonomousWaiting).toBe(0);
    r1();
  });

  it("autonomous is PATIENT: it ignores the tight interactive budget and waits for a slot", async () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "1";
    // A tiny INTERACTIVE budget must NOT time out autonomous work; autonomous has
    // its own generous budget, so the waiter holds and is served when a slot frees.
    process.env.DPF_INFERENCE_ADMISSION_TIMEOUT_MS = "20";
    process.env.DPF_INFERENCE_ADMISSION_TIMEOUT_MS_AUTONOMOUS = "5000";
    const r1 = await acquireInferenceSlot("local", "autonomous");
    const waiting = acquireInferenceSlot("local", "autonomous");
    await tick();
    // still queued well past the 20ms interactive budget — not turned away
    await new Promise((r) => setTimeout(r, 60));
    expect(getInferenceAdmissionSnapshot().local.autonomousWaiting).toBe(1);
    r1(); // free the slot — the patient waiter is now served
    const r2 = await waiting;
    expect(getInferenceAdmissionSnapshot().local.autonomousWaiting).toBe(0);
    r2();
  });
});

describe("parent cancellation during inference admission", () => {
  it.each(["caller", "parent"])("combines both scopes and removes a waiter canceled by %s", async source => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "1";
    const release = await acquireInferenceSlot("local", "autonomous");
    const caller = new AbortController();
    const parent = new AbortController();
    const queued = withInferenceCancellation(caller.signal, () =>
      acquireInferenceSlot("local", "autonomous", { signal: parent.signal }))
      .then(free => { free(); return "dispatched"; }, error => error);
    const canceled = source === "caller" ? caller : parent;
    try {
      canceled.abort(new Error(`${source} expired`));
      expect(await queued).toBe(canceled.signal.reason);
      expect(getInferenceAdmissionSnapshot().local).toMatchObject({ active: 1, autonomousWaiting: 0 });
    } finally { release(); }
    expect(getInferenceAdmissionSnapshot().local.active).toBe(0);
  });

  it("drops canceled queued work without leaking or releasing the occupied slot", async () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "1";
    const release = await acquireInferenceSlot("local", "autonomous");
    const controller = new AbortController();
    const queued = acquireInferenceSlot("local", "autonomous", { signal: controller.signal })
      .then(free => { free(); return "dispatched"; }, error => error);
    try {
      controller.abort(new Error("parent expired"));
      await tick();
      expect(getInferenceAdmissionSnapshot().local).toMatchObject({ active: 1, autonomousWaiting: 0 });
    } finally {
      release();
    }
    expect(await queued).toMatchObject({ message: "parent expired" });
    expect(getInferenceAdmissionSnapshot().local.active).toBe(0);
  });
});
