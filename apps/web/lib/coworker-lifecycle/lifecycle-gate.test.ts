import { describe, expect, it, vi } from "vitest";
import {
  evaluateLifecycleGate,
  evaluateLifecycleGates,
} from "./lifecycle-gate";

function makeDb(opts: {
  agent?: { agentId: string; lifecycleStage: string } | null;
  strict?: boolean;
  certificationRuns?: Array<{ scopeId: string; status: string; startedAt: Date }>;
  agentThrows?: boolean;
}) {
  return {
    agent: {
      findFirst: opts.agentThrows
        ? vi.fn().mockRejectedValue(new Error("db down"))
        : vi.fn().mockResolvedValue(opts.agent ?? null),
    },
    platformConfig: {
      findUnique: vi.fn().mockResolvedValue(
        opts.strict === undefined ? null : { value: { enabled: opts.strict } },
      ),
    },
    assuranceRun: { findMany: vi.fn().mockResolvedValue(opts.certificationRuns ?? []) },
  };
}

describe("coworker lifecycle gate (EP-COWORKER-LIFECYCLE Phase 3)", () => {
  it("blocks a draft coworker", async () => {
    const db = makeDb({ agent: { agentId: "new-specialist", lifecycleStage: "draft" } });
    const verdict = await evaluateLifecycleGate("new-specialist", { db });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.stage).toBe("draft");
      expect(verdict.reason).toContain("draft");
    }
  });

  it("blocks a retired coworker", async () => {
    const db = makeDb({ agent: { agentId: "old-specialist", lifecycleStage: "retirement" } });
    const verdict = await evaluateLifecycleGate("old-specialist", { db });
    expect(verdict.allowed).toBe(false);
  });

  it("allows a production coworker (grandfathered, never certified, strict off)", async () => {
    const db = makeDb({ agent: { agentId: "coo", lifecycleStage: "production" }, strict: false });
    expect((await evaluateLifecycleGate("coo", { db })).allowed).toBe(true);
  });

  it("allows an unknown agent (route-synthetic personas have no Agent row)", async () => {
    const db = makeDb({ agent: null });
    expect((await evaluateLifecycleGate("coworker", { db })).allowed).toBe(true);
    expect((await evaluateLifecycleGate("", { db })).allowed).toBe(true);
  });

  it("certification purpose bypasses the gate entirely (no deadlock)", async () => {
    const db = makeDb({ agent: { agentId: "new-specialist", lifecycleStage: "draft" } });
    const verdict = await evaluateLifecycleGate("new-specialist", {
      db,
      purpose: "certification",
    });
    expect(verdict.allowed).toBe(true);
    expect(db.agent.findFirst).not.toHaveBeenCalled();
  });

  it("strict mode blocks a coworker whose last certification failed", async () => {
    const db = makeDb({
      agent: { agentId: "coo", lifecycleStage: "production" },
      strict: true,
      certificationRuns: [{ scopeId: "coo", status: "failed", startedAt: new Date() }],
    });
    const verdict = await evaluateLifecycleGate("coo", { db });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.certification).toBe("failed");
  });

  it("strict mode still allows never/stale-certified coworkers (grandfather path)", async () => {
    const db = makeDb({
      agent: { agentId: "coo", lifecycleStage: "production" },
      strict: true,
      certificationRuns: [],
    });
    expect((await evaluateLifecycleGate("coo", { db })).allowed).toBe(true);
  });

  it("strict off allows a failed-certification coworker", async () => {
    const db = makeDb({
      agent: { agentId: "coo", lifecycleStage: "production" },
      strict: false,
      certificationRuns: [{ scopeId: "coo", status: "failed", startedAt: new Date() }],
    });
    expect((await evaluateLifecycleGate("coo", { db })).allowed).toBe(true);
  });

  it("fails open on infrastructure errors", async () => {
    const db = makeDb({ agentThrows: true });
    expect((await evaluateLifecycleGate("coo", { db })).allowed).toBe(true);
  });

  it("evaluates a roster with one agent, config, and certification batch", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        agentId: "new-specialist",
        slugId: "new-specialist",
        lifecycleStage: "draft",
      },
      {
        agentId: "coo",
        slugId: "chief-operating-officer",
        lifecycleStage: "production",
      },
    ]);
    const configFindUnique = vi
      .fn()
      .mockResolvedValue({ value: { enabled: true } });
    const certificationFindMany = vi.fn().mockResolvedValue([
      {
        scopeId: "coo",
        status: "failed",
        startedAt: new Date(),
      },
    ]);
    const db = {
      agent: {
        findFirst: vi.fn(),
        findMany,
      },
      platformConfig: { findUnique: configFindUnique },
      assuranceRun: { findMany: certificationFindMany },
    };

    const verdicts = await evaluateLifecycleGates(
      ["new-specialist", "chief-operating-officer", "unknown"],
      { db },
    );

    expect(verdicts.get("new-specialist")?.allowed).toBe(false);
    expect(
      verdicts.get("chief-operating-officer")?.allowed,
    ).toBe(false);
    expect(verdicts.get("unknown")?.allowed).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(configFindUnique).toHaveBeenCalledTimes(1);
    expect(certificationFindMany).toHaveBeenCalledTimes(1);
  });
});
