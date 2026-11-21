// BI-4B4CF969: synthetic regression for the DPF-owned T3 Code session adapter
// at the Build Studio runner seam. The fake below stands in for T3 Code's
// orchestrator. Its thread and run read shape follows what T3's own
// `t3_thread_read` returns: providerInstanceId "codex" | "claudeAgent", and
// runs that carry runId, status, model, executedModel, requestedAt and
// completedAt. Nothing here reaches a real T3 server. The runner is not
// registered in production (see the registry assertion at the end).
import { describe, expect, it, vi } from "vitest";

import { getBuildAgentRunner } from "../sandbox/agents";
import type { AgentRunSpec, BuildAgentRunner } from "../sandbox/agent-runner-types";
import type { BuildExecutionProvider, SandboxHandle } from "../sandbox/provider-types";
import {
  T3UnavailableError,
  type T3CodingSessionPort,
  type T3RunReadback,
  type T3ThreadBindingStore,
  type T3ThreadReadback,
} from "./t3-coding-session-port";
import { createT3HarnessRunner, t3ClientKey } from "./t3-harness-runner";

const provider = { id: "local-docker" } as unknown as BuildExecutionProvider;
const handle = { id: "h", buildId: "FB-1", providerId: "local-docker" } as unknown as SandboxHandle;

function spec(over: Partial<AgentRunSpec> = {}): AgentRunSpec {
  return {
    buildId: "FB-1",
    buildContext: "Build for \"Invoices\" (feature)",
    task: { taskIndex: 2, title: "Add invoice list", specialist: "software-engineer", files: [],
      task: { title: "Add invoice list", testFirst: "", implement: "Render the invoice list.", verify: "pnpm test" } },
    ...over,
  };
}

type FakeOptions = {
  /** Runs reported on successive reads; the last one repeats. */
  script?: Array<Partial<T3RunReadback> | null>;
  executedBy?: "codex" | "claudeAgent";
  finalText?: string;
  unavailable?: boolean;
};

/** An in-memory T3 orchestrator: one thread per launch, runs advancing on each read. */
function fakeT3(options: FakeOptions = {}) {
  const threads = new Map<string, { providerInstanceId: string; model: string | null; reads: number; correlation: unknown; prompt: string }>();
  const launches: Array<{ threadId: string; providerInstanceId: string; correlation: unknown }> = [];
  const script = options.script ?? [{ status: "running" }, { status: "completed" }];
  const port: T3CodingSessionPort = {
    async launchThread(input) {
      if (options.unavailable) throw new T3UnavailableError("T3 Code orchestrator is not reachable from this portal");
      const threadId = `thr-${launches.length + 1}`;
      threads.set(threadId, { providerInstanceId: input.providerInstanceId, model: input.model, reads: 0, correlation: input.correlation, prompt: input.prompt });
      launches.push({ threadId, providerInstanceId: input.providerInstanceId, correlation: input.correlation });
      return { threadId };
    },
    async readThread(threadId): Promise<T3ThreadReadback | null> {
      const t = threads.get(threadId);
      if (!t) return null;
      const step = script[Math.min(t.reads, script.length - 1)];
      t.reads += 1;
      const runs: T3RunReadback[] = step === null ? [] : [{
        runId: `run:${threadId}:1`, status: "running", providerInstanceId: options.executedBy ?? t.providerInstanceId,
        model: t.model, executedModel: step?.status === "completed" ? (t.model ?? "default") : null,
        requestedAt: "2026-11-21T11:00:00.000Z", completedAt: step?.status && step.status !== "running" ? "2026-11-21T11:05:00.000Z" : null,
        ...step,
      }];
      return { threadId, providerInstanceId: t.providerInstanceId, status: runs[0]?.status ?? "idle", runs,
        finalAssistantText: step?.status === "completed" ? (options.finalText ?? "Implemented the invoice list; tests pass.") : null };
    },
  };
  return { port, launches, threads };
}

function memoryBindings(initial: Record<string, string> = {}): T3ThreadBindingStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return { map, get: async (k) => map.get(k) ?? null, bind: async (k, v) => { map.set(k, v); } };
}

const fastClock = () => {
  let now = 0;
  return { clock: () => now, sleep: async (ms: number) => { now += ms; } };
};

describe("T3 Code harness runner (synthetic seam)", () => {
  it("AC-1/AC-2: creates one T3 thread for the task, observes the provider attempt, correlates it and reads it back", async () => {
    const t3 = fakeT3();
    const bindings = memoryBindings();
    const receipts: unknown[] = [];
    const runner = createT3HarnessRunner({ client: "claude", port: t3.port, bindings, ...fastClock(), pollIntervalMs: 1000, deadlineMs: 60_000, onReceipt: (r) => receipts.push(r) });
    const result = await runner.run(provider, handle, spec());

    expect(t3.launches).toHaveLength(1);
    expect(t3.launches[0]).toMatchObject({ threadId: "thr-1", providerInstanceId: "claudeAgent",
      correlation: { buildId: "FB-1", taskIndex: 2, clientKey: "dpf-build:FB-1:task:2" } });
    expect(bindings.map.get(t3ClientKey("FB-1", 2))).toBe("thr-1");
    expect(result).toMatchObject({
      exitCode: 0, stdout: "Implemented the invoice list; tests pass.", stderr: "",
      agentId: "claude", providerId: "local-docker", toolExecutionId: "t3:thr-1:run:thr-1:1",
    });
    expect(result.t3).toEqual({
      harness: "t3-code", clientKey: "dpf-build:FB-1:task:2", threadId: "thr-1", runId: "run:thr-1:1",
      requestedProviderInstanceId: "claudeAgent", observedProviderInstanceId: "claudeAgent", executedModel: "default",
      threadCreated: true, resumed: false, providerAttemptObserved: true, correlated: true, readBack: true, outcome: "succeeded",
    });
    expect(receipts).toEqual([result.t3]);
  });

  it("AC-1: a re-run whose task is already bound launches nothing and reads the bound thread back", async () => {
    const t3 = fakeT3();
    const bindings = memoryBindings();
    const first = createT3HarnessRunner({ client: "codex", port: t3.port, bindings, ...fastClock(), pollIntervalMs: 1000, deadlineMs: 60_000 });
    await first.run(provider, handle, spec());
    const again = await createT3HarnessRunner({ client: "codex", port: t3.port, bindings, ...fastClock(), pollIntervalMs: 1000, deadlineMs: 60_000 })
      .run(provider, handle, spec());
    expect(t3.launches).toHaveLength(1);
    expect(again.t3).toMatchObject({ threadId: "thr-1", threadCreated: false, resumed: true, readBack: true, outcome: "succeeded" });
  });

  it("AC-1: different tasks of one build get different threads", async () => {
    const t3 = fakeT3();
    const runner = createT3HarnessRunner({ client: "codex", port: t3.port, bindings: memoryBindings(), ...fastClock(), pollIntervalMs: 1000, deadlineMs: 60_000 });
    await runner.run(provider, handle, spec());
    await runner.run(provider, handle, spec({ task: { ...spec().task!, taskIndex: 3 } }));
    expect(t3.launches.map((l) => (l.correlation as { clientKey: string }).clientKey)).toEqual(["dpf-build:FB-1:task:2", "dpf-build:FB-1:task:3"]);
  });

  it("AC-3: T3 absent → typed t3-unavailable, nothing bound, no success claimed", async () => {
    const t3 = fakeT3({ unavailable: true });
    const bindings = memoryBindings();
    const result = await createT3HarnessRunner({ client: "claude", port: t3.port, bindings, ...fastClock() }).run(provider, handle, spec());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/^t3-unavailable: /);
    expect(result.t3).toMatchObject({ threadId: null, threadCreated: false, providerAttemptObserved: false, correlated: false, readBack: false, outcome: "t3-unavailable" });
    expect(bindings.map.size).toBe(0);
  });

  it("AC-3: the run was executed by another provider → t3-provider-mismatch, not a success", async () => {
    const t3 = fakeT3({ executedBy: "codex" });
    const result = await createT3HarnessRunner({ client: "claude", port: t3.port, bindings: memoryBindings(), ...fastClock(), pollIntervalMs: 1000, deadlineMs: 60_000 })
      .run(provider, handle, spec());
    expect(result.exitCode).not.toBe(0);
    expect(result.t3).toMatchObject({ providerAttemptObserved: true, correlated: false, readBack: true, outcome: "t3-provider-mismatch",
      requestedProviderInstanceId: "claudeAgent", observedProviderInstanceId: "codex" });
  });

  it("AC-3: a failed T3 run → t3-run-failed with its status", async () => {
    const t3 = fakeT3({ script: [{ status: "running" }, { status: "failed" }] });
    const result = await createT3HarnessRunner({ client: "codex", port: t3.port, bindings: memoryBindings(), ...fastClock(), pollIntervalMs: 1000, deadlineMs: 60_000 })
      .run(provider, handle, spec());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/^t3-run-failed: .*failed/);
    expect(result.t3).toMatchObject({ outcome: "t3-run-failed", correlated: true, readBack: true });
  });

  it("AC-3: no terminal run by the deadline → t3-timeout; the thread stays bound for a later readback", async () => {
    const t3 = fakeT3({ script: [{ status: "running" }] });
    const bindings = memoryBindings();
    const result = await createT3HarnessRunner({ client: "codex", port: t3.port, bindings, ...fastClock(), pollIntervalMs: 1000, deadlineMs: 5_000 })
      .run(provider, handle, spec());
    expect(result.exitCode).not.toBe(0);
    expect(result.t3).toMatchObject({ outcome: "t3-timeout", threadCreated: true, readBack: false });
    expect(bindings.map.get("dpf-build:FB-1:task:2")).toBe("thr-1");
  });

  it("AC-3: a bound thread T3 no longer knows → t3-unavailable, never a fresh duplicate launch", async () => {
    const t3 = fakeT3();
    const result = await createT3HarnessRunner({ client: "codex", port: t3.port, bindings: memoryBindings({ "dpf-build:FB-1:task:2": "thr-gone" }), ...fastClock() })
      .run(provider, handle, spec());
    expect(t3.launches).toHaveLength(0);
    expect(result.t3).toMatchObject({ outcome: "t3-unavailable", threadId: "thr-gone", resumed: true, readBack: false });
  });

  it("refuses a spec with no build id rather than inventing a correlation key", async () => {
    const t3 = fakeT3();
    const result = await createT3HarnessRunner({ client: "codex", port: t3.port, bindings: memoryBindings(), ...fastClock() })
      .run(provider, handle, spec({ buildId: undefined }));
    expect(result.exitCode).not.toBe(0);
    expect(t3.launches).toHaveLength(0);
  });

  it("AC-4: keeps the model client's agent id, needs no sandbox credential, and is not registered in production", () => {
    const runner = createT3HarnessRunner({ client: "codex", port: fakeT3().port, bindings: memoryBindings() });
    const asSeam: BuildAgentRunner = runner; // fits the existing runner seam unchanged
    expect(asSeam.id).toBe("codex");
    expect(runner.capabilities()).toMatchObject({ requiresCredential: false, requiresPersistentSession: false });
    expect(getBuildAgentRunner("codex")).not.toBe(runner);
    const prepare = vi.fn(runner.prepare);
    return expect(prepare(provider, handle, null)).resolves.toBeUndefined();
  });
});
