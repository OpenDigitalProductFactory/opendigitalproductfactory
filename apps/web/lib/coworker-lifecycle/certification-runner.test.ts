import { describe, expect, it, vi } from "vitest";
import { COWORKER_AGENT_SEEDS } from "@dpf/db/workforce-seed";
import {
  certificationRouteFor,
  runCoworkerCertificationSweep,
  type CertificationDeps,
} from "./certification-runner";
import { deriveCertificationStates } from "./certification-status";

type FindingRow = { findingKey: string; status: string };

function makeDeps(overrides?: {
  loopContent?: string;
  executedTools?: Array<{ name: string; result: { success: boolean } }>;
  tools?: Array<{ name: string; sideEffect?: boolean }>;
  existingFindings?: FindingRow[];
  superuser?: { id: string } | null;
}) {
  const created: { runs: unknown[]; findings: unknown[] } = { runs: [], findings: [] };
  const updates: unknown[] = [];
  const updateManyCalls: unknown[] = [];
  const existing = new Map<string, FindingRow>(
    (overrides?.existingFindings ?? []).map((f) => [f.findingKey, f]),
  );

  const deps: CertificationDeps = {
    resolveAgent: vi.fn().mockResolvedValue({
      agentId: "x",
      systemPrompt: "You are a coworker.",
      sensitivity: "internal",
      modelRequirements: { minimumTier: "adequate" },
    }),
    resolveTools: vi.fn().mockResolvedValue({
      tools: overrides?.tools ?? [
        { name: "query_backlog", sideEffect: false },
        { name: "create_backlog_item", sideEffect: true },
      ],
      toolsForProvider: [],
    }),
    runLoop: vi.fn().mockResolvedValue({
      content:
        overrides?.loopContent ??
        "I used query_backlog and found 3 items; one is titled 'Certify coworkers'.",
      downgraded: false,
      executedTools: overrides?.executedTools ?? [
        { name: "query_backlog", result: { success: true } },
      ],
    }),
    db: {
      user: {
        findFirst: vi
          .fn()
          .mockResolvedValue(overrides?.superuser === undefined ? { id: "usr-1" } : overrides.superuser),
      },
      assuranceRun: {
        create: vi.fn().mockImplementation(async (args: { data: unknown }) => {
          created.runs.push(args.data);
          return args.data;
        }),
      },
      assuranceFinding: {
        findUnique: vi
          .fn()
          .mockImplementation(async (args: { where: { findingKey: string } }) =>
            existing.get(args.where.findingKey) ?? null,
          ),
        create: vi.fn().mockImplementation(async (args: { data: { findingKey: string } }) => {
          created.findings.push(args.data);
          return args.data;
        }),
        update: vi.fn().mockImplementation(async (args: unknown) => {
          updates.push(args);
          return args;
        }),
        updateMany: vi.fn().mockImplementation(async (args: unknown) => {
          updateManyCalls.push(args);
          return { count: 0 };
        }),
      },
    } as unknown as CertificationDeps["db"],
    now: () => new Date("2026-07-08T04:40:00Z"),
  };
  return { deps, created, updates, updateManyCalls };
}

describe("coworker certification runner (EP-COWORKER-LIFECYCLE Phase 2)", () => {
  it("certifies the full roster: one AssuranceRun per coworker, all passed on healthy loops", async () => {
    const { deps, created } = makeDeps();
    const sweep = await runCoworkerCertificationSweep({ deps });

    expect(sweep.results).toHaveLength(COWORKER_AGENT_SEEDS.length);
    expect(sweep.failed).toBe(0);
    expect(created.runs).toHaveLength(COWORKER_AGENT_SEEDS.length);
    for (const run of created.runs as Array<Record<string, unknown>>) {
      expect(run.scopeType).toBe("agent");
      expect(run.adapterKey).toBe("coworker-cert");
      expect(run.status).toBe("passed");
    }
    expect(created.findings).toHaveLength(0);
  });

  it("offers only side-effect-free tools to the loop", async () => {
    const { deps } = makeDeps();
    await runCoworkerCertificationSweep({ agentIds: ["dispatcher"], deps });

    const loopCall = (deps.runLoop as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(loopCall.tools.map((t: { name: string }) => t.name)).toEqual(["query_backlog"]);
  });

  it("a failed oracle produces a failed run plus an open finding keyed to the oracle", async () => {
    const { deps, created } = makeDeps({
      loopContent: "Done! Everything has been updated successfully.",
      executedTools: [],
    });
    const sweep = await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    expect(sweep.failed).toBe(1);
    expect((created.runs[0] as Record<string, unknown>).status).toBe("failed");
    const keys = (created.findings as Array<{ findingKey: string }>).map((f) => f.findingKey);
    expect(keys.some((k) => k.startsWith("coworker-cert:coo:") && k.endsWith("ORACLE-TOOL"))).toBe(
      true,
    );
  });

  it("an inference admission timeout yields an INCONCLUSIVE run (to requeue), not a coworker failure", async () => {
    const { deps, created } = makeDeps();
    // Inference was at capacity: the admission wait exhausted its (patient) budget.
    // Tagged with the admission-timeout code the runner recognizes.
    const capacityErr = Object.assign(
      new Error("inference admission timeout on local engine after 1800000ms (origin=autonomous)"),
      { code: "INFERENCE_ADMISSION_TIMEOUT" },
    );
    (deps.runLoop as ReturnType<typeof vi.fn>).mockRejectedValue(capacityErr);

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    // Not a failure — capacity backpressure is inconclusive and gets requeued.
    expect(sweep.results[0].status).toBe("inconclusive");
    expect(sweep.inconclusive).toBe(1);
    expect(sweep.failed).toBe(0);
    expect((created.runs[0] as Record<string, unknown>).status).toBe("inconclusive");
    // every journey flagged capacity-inconclusive, and NO failure findings filed
    expect(sweep.results[0].journeys.every((j) => j.capacityInconclusive)).toBe(true);
    expect((created.findings as Array<unknown>).length).toBe(0);
  });

  it("a routed provider-capacity failure yields an INCONCLUSIVE run instead of failing the coworker", async () => {
    const { deps, created } = makeDeps({
      loopContent:
        "The AI providers are momentarily busy (usually rate-limited or overloaded). " +
        "Please try again in about 30 seconds — no setup change is needed.",
      executedTools: [],
    });

    const sweep = await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    expect(sweep.results[0].status).toBe("inconclusive");
    expect(sweep.inconclusive).toBe(1);
    expect(sweep.failed).toBe(0);
    expect((created.runs[0] as Record<string, unknown>).status).toBe("inconclusive");
    expect(sweep.results[0].journeys.every((journey) => journey.capacityInconclusive)).toBe(true);
    expect(created.findings).toHaveLength(0);
  });

  it("a recovered oracle is absent-cleaned via updateMany scoped to the agent", async () => {
    const { deps, updateManyCalls } = makeDeps();
    await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    expect(updateManyCalls).toHaveLength(1);
    const call = updateManyCalls[0] as {
      where: { findingKey: { startsWith: string } };
      data: { status: string };
    };
    expect(call.where.findingKey.startsWith).toBe("coworker-cert:coo:");
    expect(call.data.status).toBe("resolved");
  });

  it("reopens a previously resolved finding instead of duplicating it", async () => {
    const journeyId = "coo/derived-read-probe";
    const { deps, created, updates } = makeDeps({
      loopContent: "Done! Everything has been updated successfully.",
      executedTools: [],
      existingFindings: [
        { findingKey: `coworker-cert:coo:${journeyId}:ORACLE-TOOL`, status: "resolved" },
      ],
    });
    await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    const createdKeys = (created.findings as Array<{ findingKey: string }>).map(
      (f) => f.findingKey,
    );
    expect(createdKeys).not.toContain(`coworker-cert:coo:${journeyId}:ORACLE-TOOL`);
    const reopen = updates.find(
      (u) =>
        (u as { where: { findingKey: string } }).where.findingKey ===
        `coworker-cert:coo:${journeyId}:ORACLE-TOOL`,
    ) as { data: Record<string, unknown> };
    expect(reopen.data.status).toBe("open");
  });

  it("returns an empty sweep when no superuser exists (fresh install)", async () => {
    const { deps, created } = makeDeps({ superuser: null });
    const sweep = await runCoworkerCertificationSweep({ deps });
    expect(sweep.results).toHaveLength(0);
    expect(created.runs).toHaveLength(0);
  });

  it("a loop crash records a failed run, not a thrown sweep", async () => {
    const { deps, created } = makeDeps();
    (deps.runLoop as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("provider down"));
    const sweep = await runCoworkerCertificationSweep({ agentIds: ["coo"], deps });

    expect(sweep.failed).toBe(1);
    expect((created.runs[0] as Record<string, unknown>).status).toBe("failed");
  });

  it("routes certification through the coworker's bound route, workspace otherwise", () => {
    expect(certificationRouteFor("marketing-specialist")).not.toBe("/workspace");
    expect(certificationRouteFor("dispatcher")).toBe("/workspace");
  });
});

describe("certification state derivation", () => {
  const now = new Date("2026-07-08T12:00:00Z");

  it("latest run wins; pass=certified, fail=failed, old pass=stale, none=never", () => {
    const states = deriveCertificationStates(
      ["a", "b", "c", "d"],
      [
        { scopeId: "a", status: "passed", startedAt: new Date("2026-07-08T04:40:00Z") },
        { scopeId: "a", status: "failed", startedAt: new Date("2026-07-07T04:40:00Z") },
        { scopeId: "b", status: "failed", startedAt: new Date("2026-07-08T04:40:00Z") },
        { scopeId: "c", status: "passed", startedAt: new Date("2026-06-01T04:40:00Z") },
      ],
      now,
    );
    expect(states.get("a")?.status).toBe("certified");
    expect(states.get("b")?.status).toBe("failed");
    expect(states.get("c")?.status).toBe("stale");
    expect(states.get("d")?.status).toBe("never");
  });
});
