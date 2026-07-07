import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetInferenceAdmissionForTest,
  acquireInferenceSlot,
  currentInferenceOrigin,
  engineKeyForProvider,
  getInferenceAdmissionSnapshot,
  resolveEngineLimit,
  withInferenceOrigin,
} from "./inference-admission";

const ENV_KEYS = [
  "DPF_INFERENCE_MAX_CONCURRENCY_LOCAL",
  "DPF_INFERENCE_MAX_CONCURRENCY_REMOTE",
  "DPF_INFERENCE_ADMISSION_TIMEOUT_MS",
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

describe("inference origin (AsyncLocalStorage)", () => {
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

  it("times out a waiter that never gets a slot", async () => {
    process.env.DPF_INFERENCE_MAX_CONCURRENCY_LOCAL = "1";
    process.env.DPF_INFERENCE_ADMISSION_TIMEOUT_MS = "20";
    const r1 = await acquireInferenceSlot("local", "autonomous");
    await expect(acquireInferenceSlot("local", "autonomous")).rejects.toThrow(
      /admission timeout/,
    );
    // the timed-out waiter is removed from the queue
    expect(getInferenceAdmissionSnapshot().local.autonomousWaiting).toBe(0);
    r1();
  });
});
