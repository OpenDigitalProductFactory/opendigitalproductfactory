import { describe, it, expect } from "vitest";
import {
  rollUpProviderModels,
  rollUpProviderRoutingTelemetry,
  type ProfileForRollup,
} from "./provider-routing-rollup";

function mk(overrides: Partial<ProfileForRollup> = {}): ProfileForRollup {
  return {
    modelId: "m",
    modelClass: "chat",
    modelStatus: "active",
    reasoning: 50,
    codegen: 50,
    toolFidelity: 50,
    evalCount: 0,
    lastEvalAt: null,
    profileSource: "seed",
    ...overrides,
  };
}

describe("rollUpProviderModels (BI-1B46967D)", () => {
  it("empty provider → no scores, nothing measured", () => {
    const s = rollUpProviderModels([]);
    expect(s).toMatchObject({
      totalModels: 0,
      activeModels: 0,
      routingScores: null,
      representativeModelId: null,
      measuredModels: 0,
      evaluatedModels: 0,
      lastEvalAt: null,
    });
    expect(s.nonChatClasses).toEqual([]);
  });

  it("a provider whose models are all seed placeholders reads 'not measured' (routingScores null)", () => {
    const s = rollUpProviderModels([
      mk({ modelId: "a", profileSource: "seed" }),
      mk({ modelId: "b", profileSource: "seed", reasoning: 50, codegen: 50, toolFidelity: 50 }),
    ]);
    expect(s.routingScores).toBeNull();
    expect(s.representativeModelId).toBeNull();
    expect(s.measuredModels).toBe(0);
    expect(s.totalModels).toBe(2);
    expect(s.activeModels).toBe(2);
  });

  it("surfaces the calibrated scores + freshness of an evaluated active chat model", () => {
    const evalAt = new Date("2026-06-15T04:23:56.815Z");
    const s = rollUpProviderModels([
      mk({
        modelId: "docker.io/ai/qwen3-coder:latest",
        profileSource: "evaluated",
        reasoning: 90,
        codegen: 100,
        toolFidelity: 100,
        evalCount: 17,
        lastEvalAt: evalAt,
      }),
    ]);
    expect(s.routingScores).toEqual({ reasoning: 90, codegen: 100, toolFidelity: 100 });
    expect(s.representativeModelId).toBe("docker.io/ai/qwen3-coder:latest");
    expect(s.measuredModels).toBe(1);
    expect(s.evaluatedModels).toBe(1);
    expect(s.lastEvalAt).toBe(evalAt.toISOString());
  });

  it("represents the strongest ACTIVE, chat, measured model — ignoring retired / non-chat / seed", () => {
    const s = rollUpProviderModels([
      // strongest overall but RETIRED — must not represent the provider
      mk({ modelId: "retired-strong", profileSource: "evaluated", reasoning: 99, codegen: 99, toolFidelity: 99, modelStatus: "retired", evalCount: 5, lastEvalAt: new Date("2026-06-01T00:00:00Z") }),
      // strong but SEED — a placeholder, not a measurement
      mk({ modelId: "seed-strong", profileSource: "seed", reasoning: 95, codegen: 95, toolFidelity: 95 }),
      // strongest active but NON-CHAT (image) — not a coworker-capable signal
      mk({ modelId: "image", modelClass: "image_gen", profileSource: "evaluated", reasoning: 100, codegen: 100, toolFidelity: 100, evalCount: 3, lastEvalAt: new Date("2026-06-10T00:00:00Z") }),
      // the legitimate winner: active, chat, measured, highest composite among eligible
      mk({ modelId: "winner", profileSource: "catalog", reasoning: 88, codegen: 94, toolFidelity: 90, evalCount: 4, lastEvalAt: new Date("2026-06-14T00:00:00Z") }),
      mk({ modelId: "weaker", profileSource: "evaluated", reasoning: 80, codegen: 70, toolFidelity: 60, evalCount: 2, lastEvalAt: new Date("2026-06-13T00:00:00Z") }),
    ]);
    expect(s.representativeModelId).toBe("winner");
    expect(s.routingScores).toEqual({ reasoning: 88, codegen: 94, toolFidelity: 90 });
    expect(s.nonChatClasses).toContain("image_gen");
    // most-recent eval across ALL models (retired counts toward freshness history)
    expect(s.lastEvalAt).toBe(new Date("2026-06-14T00:00:00Z").toISOString());
    expect(s.measuredModels).toBe(4); // all but seed-strong
    expect(s.evaluatedModels).toBe(4); // all but seed-strong have lastEvalAt
  });

  it("a curated catalog model with no DPF eval shows scores but a null freshness (UI → 'baseline')", () => {
    const s = rollUpProviderModels([
      mk({ modelId: "gpt-5.4", profileSource: "catalog", reasoning: 85, codegen: 90, toolFidelity: 10, evalCount: 0, lastEvalAt: null }),
    ]);
    expect(s.routingScores).toEqual({ reasoning: 85, codegen: 90, toolFidelity: 10 });
    expect(s.measuredModels).toBe(1);
    expect(s.evaluatedModels).toBe(0);
    expect(s.lastEvalAt).toBeNull();
  });

  it("a code-class model (e.g. codex) counts as routing-capable and can represent the provider", () => {
    const s = rollUpProviderModels([
      mk({ modelId: "codex-mini-latest", modelClass: "code", profileSource: "catalog", reasoning: 70, codegen: 90, toolFidelity: 10, modelStatus: "disabled" }),
      mk({ modelId: "gpt-5.3-codex", modelClass: "code", profileSource: "catalog", reasoning: 88, codegen: 96, toolFidelity: 80, modelStatus: "active" }),
      mk({ modelId: "gpt-5.4", modelClass: "code", profileSource: "catalog", reasoning: 95, codegen: 97, toolFidelity: 80, modelStatus: "active" }),
    ]);
    expect(s.representativeModelId).toBe("gpt-5.4");
    expect(s.routingScores).toEqual({ reasoning: 95, codegen: 97, toolFidelity: 80 });
    // code is not chat-like, so it still shows up as a non-chat capability badge
    expect(s.nonChatClasses).toContain("code");
  });

  it("on a composite tie, prefers the model with eval evidence", () => {
    const s = rollUpProviderModels([
      mk({ modelId: "no-eval", profileSource: "catalog", reasoning: 80, codegen: 80, toolFidelity: 80, evalCount: 0, lastEvalAt: null }),
      mk({ modelId: "with-eval", profileSource: "evaluated", reasoning: 80, codegen: 80, toolFidelity: 80, evalCount: 1, lastEvalAt: new Date("2026-06-14T00:00:00Z") }),
    ]);
    expect(s.representativeModelId).toBe("with-eval");
  });
});

describe("rollUpProviderRoutingTelemetry (BI-AIPS-008)", () => {
  const samples = [
    { providerId: "openai", modelId: "gpt", activityClass: "summarize", workloadClasses: ["customer-records"], outcome: "success" },
    { providerId: "openai", modelId: "gpt", activityClass: "summarize", workloadClasses: ["customer-records"], outcome: "failure" },
    { providerId: "openai", modelId: "gpt", activityClass: "summarize", workloadClasses: ["customer-records"], outcome: "success" },
    { providerId: "local", modelId: "qwen", activityClass: "code-edit", workloadClasses: ["source-code"], outcome: "success" },
    { providerId: "local", modelId: "qwen", activityClass: "code-edit", workloadClasses: ["source-code"], outcome: "success" },
  ] as const;

  it("preserves provider/model totals while suppressing small workload cohorts", () => {
    const rollup = rollUpProviderRoutingTelemetry(samples, { minimumCohortSize: 3 });

    expect(rollup.totalRequests).toBe(5);
    expect(rollup.byProvider).toEqual({ local: 2, openai: 3 });
    expect(rollup.byModel).toEqual({ "local/qwen": 2, "openai/gpt": 3 });
    expect(rollup.byActivityClass).toEqual({ "code-edit": 2, summarize: 3 });
    expect(rollup.byWorkloadClass).toEqual({ "customer-records": { requests: 3, successes: 2, failures: 1 } });
    expect(rollup.suppressedWorkloadClasses).toEqual(["source-code"]);
  });
});
