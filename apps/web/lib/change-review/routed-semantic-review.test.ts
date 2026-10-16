import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/inference/routed-inference", () => ({
  routeAndCall: vi.fn(),
}));
vi.mock("@/lib/routing/local-provider-capacity", () => ({
  inspectLocalProviderCapacity: vi.fn(),
}));

import { routeAndCall } from "@/lib/inference/routed-inference";
import { buildEffectiveRequestContract, buildInitialRouteContext } from "@/lib/inference/route-contract-builder";
import { inspectLocalProviderCapacity } from "@/lib/routing/local-provider-capacity";
import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/resolve-profession-profile";
import { dispatchRoutedSemanticReview } from "./routed-semantic-review";
import { screenInferencePayload } from "@/lib/inference/data-screening/screen-inference-payload";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inspectLocalProviderCapacity).mockResolvedValue({ available: true, reason: null });
});

describe("routed semantic review", () => {
  it.each(["external", "build-studio"] as const)("protects ordinary source without authoritative classification on %s", async (surface) => {
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({ decision: "pass", issues: [], summary: "Completed review." }),
    } as never);
    await dispatchRoutedSemanticReview("export function normalizePaths(paths: string[]) { return paths.filter(Boolean); }", {
      strategyProfile: "high-assurance", reviewerId: "change-reviewer", specialistIds: ["AGT-181"], surface,
    });
    expect(routeAndCall).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(routeAndCall).mock.calls) {
      expect(call[3]?.activityContract?.successShape).toBe("json");
      expect(call[3]?.activityContract?.tokenEnvelope.maxOutputTokens).toBe(16384);
    }
    for (const [messages, systemPrompt, sensitivity] of vi.mocked(routeAndCall).mock.calls) {
      const screened = screenInferencePayload({ messages, systemPrompt, taskType: "build-review", routeContext: { sensitivity } });
      expect(screened.receipt.classifiedDataClasses).toContain("source-code");
      expect(sensitivity).toBe("internal");
      expect(screened.routeContext.sensitivity).toBe("confidential");
      expect(screened.receipt.measuredSensitivity).toBe("confidential");
    }
  });

  it.each([
    'const apiKey = "sk-ant-api03-REDACTEDLOOKINGSECRETVALUE";',
    'export const employeeRecord = { salary: 92000, ssn: "123-45-6789" };',
  ])("retains protected-data screening inside a development diff: %s", async (artifact) => {
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({ decision: "pass", issues: [], summary: "Screening fixture." }),
    } as never);
    await dispatchRoutedSemanticReview(artifact, {
      strategyProfile: "high-assurance", reviewerId: "change-reviewer", specialistIds: [], surface: "external",
    });
    const [messages, systemPrompt, sensitivity] = vi.mocked(routeAndCall).mock.calls[0]!;
    const screened = screenInferencePayload({ messages, systemPrompt, taskType: "build-review", routeContext: { sensitivity } });
    expect(screened.routeContext).toMatchObject({ sensitivity: "restricted", residencyPolicy: "local_only" });
  });

  it("keeps financial identifiers in development fixtures local-only", async () => {
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({ decision: "pass", issues: [], summary: "Screening fixture." }),
    } as never);
    await dispatchRoutedSemanticReview('export const taxPayment = { routingNumber: "021000021", accountNumber: "5512338891" };', {
      strategyProfile: "high-assurance", reviewerId: "change-reviewer", specialistIds: [], surface: "external",
    });
    const [messages, systemPrompt, sensitivity] = vi.mocked(routeAndCall).mock.calls[0]!;
    const screened = screenInferencePayload({ messages, systemPrompt, taskType: "build-review", routeContext: { sensitivity } });
    expect(screened.routeContext).toMatchObject({ sensitivity: "confidential", residencyPolicy: "local_only" });
  });

  it("does not accept a parseable verdict from a provider-truncated response", async () => {
    vi.mocked(routeAndCall).mockResolvedValue({ truncated: true,
      content: JSON.stringify({ decision: "pass", issues: [], summary: "Incomplete private response." }),
    } as never);
    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance", reviewerId: "change-reviewer", specialistIds: [], surface: "external",
    });
    expect(result).toMatchObject({ decision: "inconclusive", issues: [], inconclusiveReason: "review-response-truncated" });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("preserves a reviewer's evidence mismatch instead of calling it capacity", async () => {
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce({ content: JSON.stringify({ decision: "cannot-verify", issues: [],
        summary: "Visible checkout is f3517a3; supplied change is 7d63c18." }) } as never)
      .mockResolvedValueOnce({ content: JSON.stringify({ decision: "pass", issues: [], summary: "Architecture passes." }) } as never);
    const result = await dispatchRoutedSemanticReview("immutable diff", {
      strategyProfile: "high-assurance", reviewerId: "change-reviewer", specialistIds: ["AGT-181"], surface: "external",
    });
    expect(result.decision).toBe("inconclusive");
    expect(result.summary).toContain("change-reviewer");
    expect(result.summary).toContain("Visible checkout is f3517a3");
    expect(result.summary).not.toContain("capacity");
    expect(result.issues).toEqual([]);
  });

  it("requests completed non-streaming results for the reviewer and every specialist", async () => {
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({ decision: "pass", issues: [], summary: "Completed review." }),
    } as never);
    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance", reviewerId: "change-reviewer",
      specialistIds: ["AGT-903", "AGT-902", "AGT-131", "AGT-181"], surface: "external",
    });
    expect(result.decision).toBe("pass");
    expect(routeAndCall).toHaveBeenCalledTimes(5);
    for (const [messages, , sensitivity, options] of vi.mocked(routeAndCall).mock.calls) {
      if (sensitivity === undefined) throw new Error("Reviewer sensitivity must be explicit.");
      expect(options).toMatchObject({ interactionMode: "sync", requiresStreaming: false });
      expect(options?.activityContract?.tokenEnvelope.maxOutputTokens).toBe(16384);
      expect(options?.agentMinimumContextTokens).toBeGreaterThan(16384);
      const routeContext = buildInitialRouteContext({ sensitivity, options,
        posture: null, localOnlyInference: false });
      const contract = await buildEffectiveRequestContract({ taskType: "build-review",
        messages, tools: undefined, routeContext, options, taskRequirement: null });
      expect(contract).toMatchObject({ interactionMode: "sync", requiresStreaming: false });
    }
  });

  it("reuses a checkpointed reviewer branch and dispatches only the missing specialist", async () => {
    vi.mocked(routeAndCall).mockResolvedValue({ content: JSON.stringify({ decision: "pass", issues: [], summary: "Specialist pass." }) } as never);
    const checkpoint = vi.fn(async (id: string, execute: () => Promise<unknown>) => id === "change-reviewer"
      ? { decision: "pass", issues: [], summary: "Verified stored branch." } : execute());
    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance", reviewerId: "change-reviewer", specialistIds: ["AGT-903"], surface: "external",
    }, checkpoint as never);
    expect(result.decision).toBe("pass");
    expect(checkpoint.mock.calls.map(([id]) => id)).toEqual(["change-reviewer", "AGT-903"]);
    expect(routeAndCall).toHaveBeenCalledOnce();
    expect(vi.mocked(routeAndCall).mock.calls[0]![3]).toMatchObject({ agentId: "AGT-903" });
  });

  it("preserves the failed branch and safe diagnostics in the combined receipt", async () => {
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce({ content: JSON.stringify({ decision: "pass", issues: [], summary: "Pass." }) } as never)
      .mockResolvedValueOnce({ content: "private malformed response" } as never);
    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance", reviewerId: "change-reviewer", specialistIds: ["AGT-903"], surface: "external",
    });
    expect(result).toMatchObject({ decision: "inconclusive", parseDiagnostics: [
      { agentId: "AGT-903", stage: "missing-json" },
    ] });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("reports an unsupported required specialist instead of silently claiming completion", async () => {
    vi.mocked(routeAndCall).mockResolvedValue({ content: JSON.stringify({ decision: "pass", issues: [], summary: "Pass." }) } as never);
    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance", reviewerId: "change-reviewer", specialistIds: ["AGT-UNKNOWN"], surface: "external",
    });
    expect(result.decision).toBe("inconclusive");
    expect(result.inconclusiveReason).toContain("unsupported-required-specialist");
    expect(routeAndCall).not.toHaveBeenCalled();
  });

  it("runs the Change Reviewer and requested specialist as independent branches", async () => {
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({ decision: "pass", issues: [], summary: "Pass." }),
    } as never);

    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance",
      reviewerId: "change-reviewer",
      specialistIds: ["AGT-903"],
      surface: "external",
    });

    expect(routeAndCall).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(routeAndCall).mock.calls) {
      expect(call[2]).toBe("internal");
    }
    expect(result.decision).toBe("pass");
  });

  it("classifies an incomplete required branch as infrastructure-inconclusive", async () => {
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce({
        content: JSON.stringify({ decision: "pass", issues: [], summary: "Pass." }),
      } as never)
      .mockRejectedValueOnce(new Error("specialist unavailable"));

    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance",
      reviewerId: "change-reviewer",
      specialistIds: ["AGT-903"],
      surface: "build-studio",
    });

    expect(result.decision).toBe("inconclusive");
    expect(result.inconclusiveReason).toContain("review-branch-capacity-or-transport-failure");
    expect(result.issues).toEqual([]);
  });

  it.each([
    "local-ci-active-capacity-reservation",
    "local-ci-queued-capacity-reservation",
    "local-ci-capacity-reservation-unavailable",
  ] as const)("allows eligible remote review despite %s", async (reason) => {
    vi.mocked(inspectLocalProviderCapacity).mockResolvedValue({
      available: false,
      reason,
    });
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({ decision: "pass", issues: [], summary: "Pass." }),
    } as never);

    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance",
      reviewerId: "change-reviewer",
      specialistIds: ["AGT-181"],
      surface: "external",
    });

    expect(result.decision).toBe("pass");
    expect(routeAndCall).toHaveBeenCalledTimes(2);
    expect(inspectLocalProviderCapacity).not.toHaveBeenCalled();
  });

  it("does not defer review for an unrelated nonproduction lease", async () => {
    vi.mocked(inspectLocalProviderCapacity).mockResolvedValue({ available: true, reason: null });
    vi.mocked(routeAndCall).mockResolvedValue({
      content: JSON.stringify({ decision: "pass", issues: [], summary: "Pass." }),
    } as never);

    const result = await dispatchRoutedSemanticReview("review this", {
      strategyProfile: "high-assurance",
      reviewerId: "change-reviewer",
      specialistIds: [],
      surface: "external",
    });

    expect(result.decision).toBe("pass");
    expect(routeAndCall).toHaveBeenCalledOnce();
  });
});


describe("profession-bound dispatch", () => {
  const selection = { schemaVersion: 1 as const, userId: "user-1", capsuleId: "WC-TEST", registryVersion: "1.0.0", authorAgentIds: ["author"], requiredProfessions: ["finance"], specialists: [{ professionKey: "finance", agentId: "review-finance", displayName: "Finance" }], unavailableProfessions: [] };
  const context = { strategyProfile: "high-assurance" as const, reviewerId: "change-reviewer" as const, specialistIds: ["review-finance"], surface: "external" as const, specialistSelection: selection };
  const db = { agent: { findMany: vi.fn().mockResolvedValue([{ agentId: "review-finance", name: "finance-controller", slugId: "finance-controller" }]) }, wikiPage: { findMany: vi.fn().mockResolvedValue([{ slug: "professions/finance/controls", title: "Controls", abstract: "Use recorded evidence", body: "Separate authorization and reconciliation for every transaction.", metadata: {} }]) } };
  it("executes a registered family outside the old four-persona roster using its own craft and human label", async () => {
    vi.mocked(routeAndCall).mockResolvedValue({ content: JSON.stringify({ decision: "pass", issues: [], summary: "Reviewed financial controls." }) } as never);
    const result = await dispatchRoutedSemanticReview("review controls", context, undefined, db, async () => true);
    expect(result.decision).toBe("pass");
    expect(routeAndCall).toHaveBeenCalledTimes(2);
    const branch = vi.mocked(routeAndCall).mock.calls.find(call => call[3]?.agentId === "review-finance")!;
    expect(branch[1]).toContain("professions/finance/controls");
    expect(branch[3]?.agentDisplayName).toBe("Finance");
  });
  it("keeps craft findings advisory and lets the independent reviewer assess them after contribution", async () => {
    vi.mocked(routeAndCall).mockImplementation(async (_messages, _system, _sensitivity, options) => ({ content: JSON.stringify(options?.agentId === "review-finance"
      ? { decision: "fail", issues: [{ severity: "critical", description: "Advisory control concern" }], summary: "Proposed control change" }
      : { decision: "pass", issues: [], summary: "The recorded implementation handles the concern" }) } as never));
    const result = await dispatchRoutedSemanticReview("review controls", context, undefined, db, async () => true);
    expect(result.decision).toBe("pass");
    const core = vi.mocked(routeAndCall).mock.calls.find(call => call[3]?.agentId === "change-reviewer")!;
    expect(core[0][0]?.content).toContain("Advisory control concern");
    expect(result.issues[0]).toMatchObject({ advisory: true });
  });
  it("retains the independent reviewer's blocking finding after advisory contributions", async () => {
    vi.mocked(routeAndCall).mockImplementation(async (_messages, _system, _sensitivity, options) => ({ content: JSON.stringify(options?.agentId === "change-reviewer"
      ? { decision: "fail", issues: [{ severity: "critical", description: "Required verification does not cover this behavior" }], summary: "Repair required" }
      : { decision: "pass", issues: [], summary: "Contribution complete" }) } as never));
    const result = await dispatchRoutedSemanticReview("review controls", context, undefined, db, async () => true);
    expect(result.decision).toBe("fail");
  });
  it("executes all five required families in bounded batches and retains one failed contribution", async () => {
    const families = PROFESSION_REGISTRY.families.filter(family => ["finance", "security", "data-architect", "enterprise-architecture", "release-service-management"].includes(family.professionKey));
    expect(families).toHaveLength(5);
    const specialists = families.map(family => ({ professionKey: family.professionKey, agentId: `review-${family.professionKey}`, displayName: family.label }));
    const selected = { ...selection, requiredProfessions: families.map(family => family.professionKey), specialists };
    const craftDb = { agent: { findMany: vi.fn().mockResolvedValue(families.map(family => ({ agentId: `review-${family.professionKey}`, name: family.roles[0], slugId: family.roles[0] }))) }, wikiPage: { findMany: vi.fn().mockImplementation(async args => [{ slug: `${args.where.slug.startsWith}criteria`, title: "Criteria", abstract: "Recorded craft", body: "Use evidence for review controls.", metadata: {} }]) } };
    let running = 0; let peak = 0;
    const visited: string[] = [];
    vi.mocked(routeAndCall).mockResolvedValue({ content: JSON.stringify({ decision: "pass", issues: [], summary: "Reviewed." }) } as never);
    const result = await dispatchRoutedSemanticReview("review", { ...context, specialistSelection: selected, specialistIds: specialists.map(row => row.agentId) }, async (id, execute) => {
      visited.push(id); running++; peak = Math.max(peak, running);
      try { if (id === "review-finance") throw new Error("provider unavailable"); return await execute(); } finally { running--; }
    }, craftDb, async () => true);
    expect(visited).toHaveLength(5);
    expect(visited).not.toContain("change-reviewer");
    expect(peak).toBeLessThanOrEqual(3);
    expect(result.decision).toBe("inconclusive");
  });
  it("consults the calibrated UX critique corpus and records an empty set as a limitation", async () => {
    const ux = { ...selection, requiredProfessions: ["ux-design"], specialists: [{ professionKey: "ux-design", agentId: "AGT-906", displayName: "UX Design Critic" }] };
    const uxDb = { agent: { findMany: vi.fn().mockResolvedValue([{ agentId: "AGT-906", name: "ux-design-critic", slugId: "ux-design-critic" }]) }, wikiPage: { findMany: vi.fn().mockResolvedValue([{ slug: "professions/ux-design/density", title: "Density", abstract: "Pertinent detail", body: "Keep pertinent detail visible and disclose secondary configuration progressively.", metadata: {} }]) } };
    const lookup = vi.fn().mockResolvedValue({ success: true, data: { total: 0, grounding: "UNGROUNDED", entries: [] } });
    vi.mocked(routeAndCall).mockResolvedValue({ content: JSON.stringify({ decision: "pass", issues: [], summary: "Reviewed surface" }) } as never);
    const result = await dispatchRoutedSemanticReview("prototype", { ...context, specialistSelection: ux, specialistIds: ["AGT-906"] }, undefined, uxDb, async () => true, lookup);
    expect(lookup).toHaveBeenCalledWith("user-1");
    const branch = vi.mocked(routeAndCall).mock.calls.find(call => call[3]?.agentId === "AGT-906")!;
    expect(branch[1]).toContain("UNGROUNDED");
    expect(result.craftGrounding).toEqual([expect.objectContaining({ professionKey: "ux-design", corpusPages: ["professions/ux-design/density"], calibratedCritiqueCount: 0 })]);
    expect(result.summary).toMatch(/no calibrated UX critiques/i);
  });
  it("stops the final independent inference if authority is revoked after the contribution", async () => {
    const verify = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
    vi.mocked(routeAndCall).mockResolvedValue({ content: JSON.stringify({ decision: "pass", issues: [], summary: "Contribution complete" }) } as never);
    const result = await dispatchRoutedSemanticReview("review controls", context, undefined, db, verify);
    expect(result.decision).toBe("inconclusive");
    expect(routeAndCall).toHaveBeenCalledTimes(1);
    expect(vi.mocked(routeAndCall).mock.calls[0]![3]?.agentId).toBe("review-finance");
  });
  it("stops later batches after revocation without substituting identities or dispatching the core", async () => {
    const families = PROFESSION_REGISTRY.families.filter(family => ["finance", "security", "data-architect", "enterprise-architecture", "release-service-management"].includes(family.professionKey));
    const specialists = families.map(family => ({ professionKey: family.professionKey, agentId: `review-${family.professionKey}`, displayName: family.label }));
    const selected = { ...selection, requiredProfessions: families.map(family => family.professionKey), specialists };
    const craftDb = { agent: { findMany: vi.fn().mockResolvedValue(families.map(family => ({ agentId: `review-${family.professionKey}`, name: family.roles[0], slugId: family.roles[0] }))) }, wikiPage: { findMany: vi.fn().mockImplementation(async args => [{ slug: `${args.where.slug.startsWith}criteria`, title: "Criteria", abstract: "Recorded craft", body: "Use evidence for review controls.", metadata: {} }]) } };
    const verify = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
    vi.mocked(routeAndCall).mockResolvedValue({ content: JSON.stringify({ decision: "pass", issues: [], summary: "Contribution complete" }) } as never);
    const result = await dispatchRoutedSemanticReview("private diff", { ...context, specialistSelection: selected, specialistIds: specialists.map(row => row.agentId) }, undefined, craftDb, verify);
    expect(result.decision).toBe("inconclusive");
    expect(routeAndCall).toHaveBeenCalledTimes(3);
    expect(vi.mocked(routeAndCall).mock.calls.map(call => call[3]?.agentId)).toEqual(specialists.slice(0, 3).map(row => row.agentId));
    expect(verify.mock.calls.every(([saved]) => saved === selected)).toBe(true);
  });
  it("dispatches nothing when current selection authority is refused", async () => {
    const result = await dispatchRoutedSemanticReview("private diff", context, undefined, db, async () => false);
    expect(result.decision).toBe("inconclusive");
    expect(routeAndCall).not.toHaveBeenCalled();
  });
  it("does not replace a required specialist with a generic persona when its corpus is empty", async () => {
    const empty = { ...db, wikiPage: { findMany: vi.fn().mockResolvedValue([]) } };
    const result = await dispatchRoutedSemanticReview("review controls", context, undefined, empty, async () => true);
    expect(result).toMatchObject({ decision: "inconclusive", inconclusiveReason: "required-specialist-corpus-unavailable" });
    expect(routeAndCall).not.toHaveBeenCalled();
  });
});
