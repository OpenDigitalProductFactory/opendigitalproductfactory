import { beforeEach, describe, expect, it, vi } from "vitest";
import { runJourney, runJourneySweep } from "./runner";
import type {
  InstallJourneyContext,
  JourneyDefinition,
  StepProbeResult,
  VerificationDepth,
} from "./types";

const CTX: InstallJourneyContext = {
  organizationId: "org_1",
  organizationSlug: "acme",
  baseUrl: "https://example.test",
  storefrontId: "sf_1",
  storefrontPublished: true,
  archetypeIds: ["field-service"],
  bookableItemId: "item_1",
  hasInquirySurface: true,
  hasPaymentConfiguration: true,
};

function stepOf(
  stepId: string,
  depth: VerificationDepth,
  result: StepProbeResult | (() => Promise<never>),
) {
  return {
    stepId,
    label: stepId,
    depth,
    run: typeof result === "function" ? result : async () => result,
  };
}

function journeyOf(steps: JourneyDefinition["steps"], applies = true): JourneyDefinition {
  return {
    journeyId: "j1",
    outcome: "Customers can do the thing",
    businessImpact: "They cannot do the thing.",
    revenueBearing: true,
    appliesWhen: () => applies,
    notApplicableReason: "not set up",
    steps,
  };
}

const deps = { fetchImpl: vi.fn() as unknown as typeof fetch, now: () => new Date(0) };

describe("runJourney — cheapest-first with skip-after-failure", () => {
  it("skips deeper steps once an earlier step failed", async () => {
    const deepProbe = vi.fn(async () => ({ passed: true, detail: "ran" }));
    const journey = journeyOf([
      stepOf("cheap", "reachability", { passed: false, detail: "down", expected: "200", actual: "503" }),
      { stepId: "expensive", label: "expensive", depth: "data-path", run: deepProbe },
    ]);

    const result = await runJourney(journey, CTX, deps);

    // The expensive rehearsal must not have run at all — that is the cost control.
    expect(deepProbe).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.steps[1].outcome).toBe("skipped");
  });

  it("reports a failed journey as having established no depth", async () => {
    const journey = journeyOf([
      stepOf("a", "reachability", { passed: true, detail: "ok" }),
      stepOf("b", "data-path", { passed: false, detail: "broken" }),
    ]);

    const result = await runJourney(journey, CTX, deps);

    expect(result.status).toBe("failed");
    expect(result.achievedDepth).toBeNull();
    // Everything is unchecked when the journey failed.
    expect(result.uncheckedDepths).toContain("reachability");
  });

  it("caps a passing journey at its weakest step depth", async () => {
    const journey = journeyOf([
      stepOf("a", "reachability", { passed: true, detail: "ok" }),
      stepOf("b", "data-path", { passed: true, detail: "ok" }),
    ]);

    const result = await runJourney(journey, CTX, deps);

    expect(result.status).toBe("passed");
    expect(result.achievedDepth).toBe("reachability");
    expect(result.uncheckedDepths).toEqual(["contract", "data-path", "interaction"]);
  });

  it("turns a throwing probe into a failed step with evidence, not a crash", async () => {
    const journey = journeyOf([
      stepOf("boom", "contract", async () => {
        throw new Error("connection reset");
      }),
    ]);

    const result = await runJourney(journey, CTX, deps);

    expect(result.status).toBe("failed");
    expect(result.steps[0].actual).toBe("connection reset");
  });
});

describe("runJourneySweep", () => {
  // Args are typed so `mock.calls[0][0]` is inspectable rather than `undefined`.
  type AnyArgs = Record<string, unknown>;
  const db = {
    assuranceRun: { create: vi.fn(async (_a: AnyArgs) => ({})) },
    assuranceFinding: {
      findUnique: vi.fn(async (_a: AnyArgs) => null),
      create: vi.fn(async (_a: AnyArgs) => ({})),
      update: vi.fn(async (_a: AnyArgs) => ({})),
      updateMany: vi.fn(async (_a: AnyArgs) => ({ count: 0 })),
    },
    portfolioQualityIssue: {
      upsert: vi.fn(async (_a: AnyArgs) => ({})),
      updateMany: vi.fn(async (_a: AnyArgs) => ({ count: 0 })),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function sweep(journeys: JourneyDefinition[]) {
    return runJourneySweep({
      db: db as never,
      fetchImpl: deps.fetchImpl,
      now: () => new Date(0),
      resolveContext: async () => CTX,
      journeys,
    });
  }

  it("reports a non-applicable journey without running a single step", async () => {
    const probe = vi.fn(async () => ({ passed: true, detail: "ran" }));
    const result = await sweep([
      journeyOf([{ stepId: "s", label: "s", depth: "contract", run: probe }], false),
    ]);

    expect(probe).not.toHaveBeenCalled();
    expect(result.notApplicable).toBe(1);
    expect(result.journeys[0].status).toBe("not-applicable");
    // Not-applicable is not a coverage gap: nothing was left unchecked.
    expect(result.journeys[0].uncheckedDepths).toEqual([]);
  });

  it("opens a journey_failure issue for a failing journey and resolves a passing one", async () => {
    await sweep([
      journeyOf([stepOf("a", "contract", { passed: false, detail: "no" })]),
      {
        ...journeyOf([stepOf("b", "contract", { passed: true, detail: "yes" })]),
        journeyId: "j2",
      },
    ]);

    expect(db.portfolioQualityIssue.upsert).toHaveBeenCalledTimes(1);
    const upsert = db.portfolioQualityIssue.upsert.mock.calls[0][0] as {
      where: { issueKey: string };
      create: { issueType: string; summary: string };
    };
    expect(upsert.where.issueKey).toBe("journey-failure:j1");
    expect(upsert.create.issueType).toBe("journey_failure");
    // The owner reads the lost outcome, not the mechanism.
    expect(upsert.create.summary).toBe("Customers can do the thing — not working");

    // The passing journey resolves its row.
    const resolveCall = db.portfolioQualityIssue.updateMany.mock.calls.find(
      (c) => (c[0] as { where: { issueKey?: string } }).where.issueKey === "journey-failure:j2",
    );
    expect(resolveCall).toBeDefined();
  });

  it("records one AssuranceRun and a finding per failed step", async () => {
    await sweep([journeyOf([stepOf("a", "contract", { passed: false, detail: "no" })])]);

    expect(db.assuranceRun.create).toHaveBeenCalledTimes(1);
    const run = db.assuranceRun.create.mock.calls[0][0] as {
      data: { scopeType: string; adapterKey: string; status: string };
    };
    expect(run.data.scopeType).toBe("business-journey");
    expect(run.data.adapterKey).toBe("journey-watchdog");
    expect(run.data.status).toBe("failed");

    expect(db.assuranceFinding.create).toHaveBeenCalledTimes(1);
    const finding = db.assuranceFinding.create.mock.calls[0][0] as {
      data: { findingKey: string; findingKind: string };
    };
    expect(finding.data.findingKey).toBe("journey-watchdog:j1:a");
    expect(finding.data.findingKind).toBe("business-journey");
  });

  it("absent-cleans findings that stopped reproducing", async () => {
    await sweep([journeyOf([stepOf("a", "contract", { passed: true, detail: "ok" })])]);

    const cleanup = db.assuranceFinding.updateMany.mock.calls.at(-1)?.[0] as {
      data: { status: string };
    };
    expect(cleanup.data.status).toBe("resolved");
  });

  // BI-04CC2090. The bug these cover shipped a watchdog that told an owner
  // "Customers can book a time with you — not working" about a journey it had
  // never once been able to reach.
  describe("a journey the run could not check", () => {
    const unverifiableStep = stepOf("a", "reachability", {
      passed: false,
      unverifiable: true,
      unverifiableReason: "no-public-address",
      detail: "cannot be checked",
    } as StepProbeResult);

    it("is unverifiable, not failed", async () => {
      const result = await runJourney(journeyOf([unverifiableStep]), CTX, {
        fetchImpl: deps.fetchImpl,
        now: () => new Date(0),
      });

      expect(result.status).toBe("unverifiable");
      expect(result.unverifiableReason).toBe("no-public-address");
      expect(result.steps[0].outcome).toBe("unverifiable");
      // Still establishes nothing — the depth ladder is unchanged.
      expect(result.achievedDepth).toBeNull();
    });

    it("records the sweep as inconclusive, never passed", async () => {
      await sweep([journeyOf([unverifiableStep])]);

      const run = db.assuranceRun.create.mock.calls[0][0] as { data: { status: string } };
      expect(run.data.status).toBe("inconclusive");
    });

    it("raises no AssuranceFinding claiming a step failed", async () => {
      await sweep([journeyOf([unverifiableStep])]);

      expect(db.assuranceFinding.create).not.toHaveBeenCalled();
    });

    it("still fails a journey whose probe genuinely failed", async () => {
      const result = await runJourney(
        journeyOf([stepOf("a", "reachability", { passed: false, detail: "500 from the route" })]),
        CTX,
        { fetchImpl: deps.fetchImpl, now: () => new Date(0) },
      );

      expect(result.status).toBe("failed");
      expect(result.steps[0].outcome).toBe("failed");
      expect(result.unverifiableReason).toBeUndefined();
    });

    it("marks a genuine failure as failed even when another journey is unverifiable", async () => {
      await sweep([
        journeyOf([unverifiableStep]),
        {
          ...journeyOf([stepOf("b", "contract", { passed: false, detail: "broken" })]),
          journeyId: "j2",
        },
      ]);

      const run = db.assuranceRun.create.mock.calls[0][0] as { data: { status: string } };
      // A real failure outranks an unverifiable one.
      expect(run.data.status).toBe("failed");
    });
  });
});
