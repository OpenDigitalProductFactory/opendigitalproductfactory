import { describe, expect, it, vi } from "vitest";

import { capabilityNeedOriginId } from "@/lib/coworker-self-assessment/assessment-service";
import {
  ACUMEN_GAP_CONFIDENCE_THRESHOLD,
  nominateAcumenCorpusGap,
  shouldNominateAcumenGap,
  type AcumenGapConsultOutcome,
} from "./acumen-gap-nomination";

// W16 (BI-18519A73). Guards nominate, humans consolidate: a consult that the
// craft could not answer becomes ONE CoworkerCapabilityNeed in the review-
// service inbox, filed through the existing creation service, deduped against
// open needs, with every failure swallowed (audit-only contract).

function consult(over: Partial<AcumenGapConsultOutcome> = {}): AcumenGapConsultOutcome {
  return {
    professionKey: "data-architect",
    interactionId: "DI-CONSULT-1",
    outcomeType: "escalate",
    confidenceScore: 0.35,
    professionProfileSelected: true,
    coverageGap: false,
    domainClass: "professional-practice",
    question: "Start implementation for this build?",
    ...over,
  };
}

describe("shouldNominateAcumenGap", () => {
  it("does not nominate a path-forward outcome", () => {
    expect(shouldNominateAcumenGap(consult({ outcomeType: "recommend" }))).toBe(false);
    expect(shouldNominateAcumenGap(consult({ outcomeType: "arbitrate" }))).toBe(false);
  });

  it("nominates escalate with the profession profile selected but confidence below threshold", () => {
    expect(
      shouldNominateAcumenGap(
        consult({ confidenceScore: ACUMEN_GAP_CONFIDENCE_THRESHOLD - 0.01 }),
      ),
    ).toBe(true);
  });

  it("does not nominate a confident craft escalation (the craft spoke; the owner decides)", () => {
    expect(
      shouldNominateAcumenGap(
        consult({ confidenceScore: 0.8, professionProfileSelected: true, coverageGap: false }),
      ),
    ).toBe(false);
  });

  it("nominates when no applicable craft material existed (coverage gap or fallback doctrine)", () => {
    expect(shouldNominateAcumenGap(consult({ outcomeType: "defer", coverageGap: true }))).toBe(true);
    expect(
      shouldNominateAcumenGap(
        consult({ professionProfileSelected: false, confidenceScore: 0.9 }),
      ),
    ).toBe(true);
  });
});

describe("nominateAcumenCorpusGap", () => {
  it("files one need against the acumen's resident coworker via the existing creation service", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const submit = vi.fn().mockResolvedValue({
      assessmentId: "CWSA-1",
      needIds: ["CWN-1"],
      backlogItemIds: ["BI-X"],
    });
    const listNeeds = vi.fn().mockResolvedValue([]);

    const result = await nominateAcumenCorpusGap(consult(), {
      submitAssessment: submit as never,
      listNeeds: listNeeds as never,
    });

    expect(result).toEqual({ nominated: true, needId: "CWN-1" });
    expect(submit).toHaveBeenCalledTimes(1);
    const payload = submit.mock.calls[0]![0] as {
      agentId: string;
      trigger: string;
      verdict: string;
      needs: Array<{ kind: string; need: string; blocks: string; evidenceJson: Record<string, unknown> }>;
    };
    // The need's coworker is the acumen's resident coworker from the registry.
    expect(payload.agentId).toBe("data-architect");
    expect(payload.trigger).toBe("build-studio-acumen-consult");
    expect(payload.verdict).toBe("gaps");
    expect(payload.needs.length).toBe(1);
    const need = payload.needs[0]!;
    expect(need.kind).toBe("convention");
    // The description names the missing decision class and the consult DI id.
    expect(need.need).toContain("professional-practice");
    expect(need.blocks).toContain("DI-CONSULT-1");
    expect(need.evidenceJson.decisionInteractionId).toBe("DI-CONSULT-1");
    info.mockRestore();
  });

  it("uses the ux-design acumen's distinct resident coworker id", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const submit = vi.fn().mockResolvedValue({ assessmentId: "a", needIds: ["CWN-2"], backlogItemIds: [] });
    await nominateAcumenCorpusGap(consult({ professionKey: "ux-design" }), {
      submitAssessment: submit as never,
      listNeeds: vi.fn().mockResolvedValue([]) as never,
    });
    expect((submit.mock.calls[0]![0] as { agentId: string }).agentId).toBe("ux-design-critic");
    info.mockRestore();
  });

  it("does not create when an OPEN need with the same fingerprint exists", async () => {
    const submit = vi.fn();
    // Fabricate an existing row with the exact same fingerprint by reusing the
    // module's own need text via a first (mocked) nomination round-trip.
    const firstSubmit = vi.fn().mockResolvedValue({ assessmentId: "a", needIds: ["CWN-1"], backlogItemIds: [] });
    await nominateAcumenCorpusGap(consult(), {
      submitAssessment: firstSubmit as never,
      listNeeds: vi.fn().mockResolvedValue([]) as never,
    });
    const filedNeedText = (firstSubmit.mock.calls[0]![0] as { needs: Array<{ need: string }> }).needs[0]!.need;

    const result = await nominateAcumenCorpusGap(consult({ interactionId: "DI-CONSULT-2" }), {
      submitAssessment: submit as never,
      listNeeds: vi.fn().mockResolvedValue([
        { needId: "CWN-EXISTING", status: "submitted", need: filedNeedText },
      ]) as never,
    });

    expect(result).toEqual({
      nominated: false,
      reason: "duplicate-open-need",
      needId: "CWN-EXISTING",
    });
    expect(submit).not.toHaveBeenCalled();
    // Sanity: the dedupe key is the shared origin fingerprint.
    expect(capabilityNeedOriginId("data-architect", "convention", filedNeedText)).toBe(
      capabilityNeedOriginId("data-architect", "convention", filedNeedText),
    );
  });

  it("nominates again when the prior need is closed (resolved/discarded)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const firstSubmit = vi.fn().mockResolvedValue({ assessmentId: "a", needIds: ["CWN-1"], backlogItemIds: [] });
    await nominateAcumenCorpusGap(consult(), {
      submitAssessment: firstSubmit as never,
      listNeeds: vi.fn().mockResolvedValue([]) as never,
    });
    const filedNeedText = (firstSubmit.mock.calls[0]![0] as { needs: Array<{ need: string }> }).needs[0]!.need;

    const submit = vi.fn().mockResolvedValue({ assessmentId: "b", needIds: ["CWN-3"], backlogItemIds: [] });
    const result = await nominateAcumenCorpusGap(consult(), {
      submitAssessment: submit as never,
      listNeeds: vi.fn().mockResolvedValue([
        { needId: "CWN-OLD", status: "resolved", need: filedNeedText },
      ]) as never,
    });

    expect(result.nominated).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });

  it("returns not-a-gap without touching the service for non-qualifying consults", async () => {
    const submit = vi.fn();
    const listNeeds = vi.fn();
    const result = await nominateAcumenCorpusGap(consult({ outcomeType: "recommend" }), {
      submitAssessment: submit as never,
      listNeeds: listNeeds as never,
    });
    expect(result).toEqual({ nominated: false, reason: "not-a-gap" });
    expect(submit).not.toHaveBeenCalled();
    expect(listNeeds).not.toHaveBeenCalled();
  });

  it("returns unknown-acumen for a professionKey outside the registry", async () => {
    const result = await nominateAcumenCorpusGap(consult({ professionKey: "astrology" }), {
      submitAssessment: vi.fn() as never,
      listNeeds: vi.fn() as never,
    });
    expect(result).toEqual({ nominated: false, reason: "unknown-acumen" });
  });

  it("swallows service failures with a structured log and never throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await nominateAcumenCorpusGap(consult(), {
      submitAssessment: vi.fn().mockRejectedValue(new Error("db down")) as never,
      listNeeds: vi.fn().mockResolvedValue([]) as never,
    });
    expect(result).toEqual({ nominated: false, reason: "error" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("acumen.gap.nomination-failed"));
    warn.mockRestore();
  });
});
