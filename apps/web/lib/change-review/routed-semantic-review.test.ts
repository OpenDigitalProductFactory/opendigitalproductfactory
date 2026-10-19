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
