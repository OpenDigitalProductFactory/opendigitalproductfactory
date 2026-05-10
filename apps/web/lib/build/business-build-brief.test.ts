import { describe, expect, it } from "vitest";
import {
  buildBusinessBuildBrief,
  canTransitionBusinessBriefStatus,
  getCapabilityPackIdForBrief,
  getCapabilityPackForBrief,
} from "./business-build-brief";
import type { FeatureBrief } from "@/lib/feature-build-types";

const baseBrief: FeatureBrief = {
  title: "Customer support escalation dashboard",
  description:
    "Support managers need to see unresolved customer escalations by site before the morning standup.",
  portfolioContext: "Customer support",
  targetRoles: ["Support manager", "Customer success lead"],
  inputs: ["Existing Zendesk escalation report", "Morning standup SOP"],
  dataNeeds: "Escalation status, customer site, owner, age, and next action",
  acceptanceCriteria: [
    "Support managers can see unresolved escalations by customer site.",
    "The list shows owner, age, and next action.",
  ],
};

describe("buildBusinessBuildBrief", () => {
  it("normalizes an existing feature brief into a business-first build brief", () => {
    const brief = buildBusinessBuildBrief({
      source: "existing_example",
      featureBrief: baseBrief,
      evidence: [
        {
          kind: "artifact",
          label: "Morning standup SOP",
          summary: "Current manual review process.",
        },
      ],
      exampleToEmulate: "Finance approval dashboard",
      constraints: ["Do not expose customer data across accounts."],
    });

    expect(brief.businessOutcome).toBe(baseBrief.description);
    expect(brief.affectedPeople).toEqual([
      "Support manager",
      "Customer success lead",
    ]);
    expect(brief.capabilityPack).toBe("Customer Support");
    expect(brief.capabilityPackId).toBe("customer_support");
    expect(brief.sourceEvidence).toHaveLength(3);
    expect(brief.sourceEvidence.map((e) => e.label)).toContain(
      "Finance approval dashboard",
    );
    expect(brief.successSignals).toEqual(baseBrief.acceptanceCriteria);
    expect(brief.technicalInterpretation).toEqual(
      expect.objectContaining({
        dataNeeds: baseBrief.dataNeeds,
        verificationFocus: baseBrief.acceptanceCriteria,
      }),
    );
  });

  it("surfaces confidence gaps instead of pretending fuzzy intake is ready", () => {
    const brief = buildBusinessBuildBrief({
      source: "user_conversation",
      featureBrief: {
        ...baseBrief,
        inputs: [],
        acceptanceCriteria: [],
        targetRoles: [],
      },
    });

    expect(brief.confidence).toBe("medium");
    expect(brief.openQuestions).toContain(
      "Who is affected by this business change?",
    );
    expect(brief.openQuestions).toContain(
      "What evidence, example, or artifact should DPF use as the reference?",
    );
    expect(brief.openQuestions).toContain(
      "What business signal proves this worked?",
    );
  });
});

describe("getCapabilityPackForBrief", () => {
  it("maps business vocabulary to governed capability packs", () => {
    expect(getCapabilityPackForBrief("invoice payment approval")).toBe("Finance");
    expect(getCapabilityPackForBrief("sales pipeline opportunity follow-up")).toBe("Sales");
    expect(getCapabilityPackForBrief("employee operations task handoff")).toBe("Operations");
  });

  it("defaults Build Studio self-development work to the reviewed launch pack", () => {
    expect(getCapabilityPackIdForBrief("Improve Build Studio intake for non-developers")).toBe(
      "build_studio_self_development",
    );
  });
});

describe("canTransitionBusinessBriefStatus", () => {
  it("allows the reviewed happy path into accepted and converted_to_build", () => {
    expect(canTransitionBusinessBriefStatus({
      from: "draft",
      to: "gathering_evidence",
    })).toBe(true);
    expect(canTransitionBusinessBriefStatus({
      from: "gathering_evidence",
      to: "redacting",
    })).toBe(true);
    expect(canTransitionBusinessBriefStatus({
      from: "redacting",
      to: "interpreting",
    })).toBe(true);
    expect(canTransitionBusinessBriefStatus({
      from: "interpreting",
      to: "accepted",
      confidence: "high",
      openQuestions: [],
    })).toBe(true);
    expect(canTransitionBusinessBriefStatus({
      from: "accepted",
      to: "converted_to_build",
    })).toBe(true);
  });

  it("routes low confidence or open questions to clarification before acceptance", () => {
    expect(canTransitionBusinessBriefStatus({
      from: "interpreting",
      to: "accepted",
      confidence: "low",
      openQuestions: [],
    })).toBe(false);
    expect(canTransitionBusinessBriefStatus({
      from: "interpreting",
      to: "accepted",
      confidence: "medium",
      openQuestions: ["Which workflow is affected?"],
    })).toBe(false);
    expect(canTransitionBusinessBriefStatus({
      from: "interpreting",
      to: "awaiting_clarification",
      confidence: "low",
      openQuestions: ["Which workflow is affected?"],
    })).toBe(true);
  });

  it("blocks terminal-state rewinds", () => {
    expect(canTransitionBusinessBriefStatus({
      from: "converted_to_build",
      to: "draft",
    })).toBe(false);
    expect(canTransitionBusinessBriefStatus({
      from: "rejected",
      to: "interpreting",
    })).toBe(false);
    expect(canTransitionBusinessBriefStatus({
      from: "superseded",
      to: "accepted",
    })).toBe(false);
  });
});
