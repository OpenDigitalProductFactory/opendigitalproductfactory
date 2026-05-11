import { describe, expect, it } from "vitest";
import {
  buildBusinessBuildBrief,
  businessBuildBriefEditToPersistence,
  businessBuildBriefFromRecord,
  canTransitionBusinessBriefStatus,
  getCapabilityPackIdForBrief,
  getCapabilityPackForBrief,
  legacyFeatureBuildBriefToBusinessBuildBriefInput,
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

describe("legacyFeatureBuildBriefToBusinessBuildBriefInput", () => {
  it("converts a complete FeatureBuild.brief JSON payload into a persistence-ready business brief", () => {
    const converted = legacyFeatureBuildBriefToBusinessBuildBriefInput({
      orgId: "org-1",
      buildId: "FB-ABC12345",
      featureBuildId: "feature-build-row-1",
      title: "Customer support escalation dashboard",
      brief: baseBrief,
      submittedByUserId: "user-1",
    });

    expect(converted).toEqual(
      expect.objectContaining({
        briefId: "BBB-FB-ABC12345",
        orgId: "org-1",
        featureBuildId: "feature-build-row-1",
        status: "accepted",
        intakeSource: "user_conversation",
        businessOutcome: baseBrief.description,
        capabilityPackId: "customer_support",
        confidence: "high",
        submittedByUserId: "user-1",
      }),
    );
    expect(converted.affectedPeople).toEqual([
      { kind: "persona", label: "Support manager" },
      { kind: "persona", label: "Customer success lead" },
    ]);
    expect(converted.sourceEvidence).toHaveLength(1);
    expect(converted.successSignals).toEqual(baseBrief.acceptanceCriteria);
  });

  it("keeps incomplete legacy briefs out of accepted status", () => {
    const converted = legacyFeatureBuildBriefToBusinessBuildBriefInput({
      orgId: "org-1",
      buildId: "FB-FUZZY",
      title: "Fuzzy request",
      brief: {
        title: "Fuzzy request",
        description: "Make the work easier.",
        portfolioContext: "",
        targetRoles: [],
        inputs: [],
        dataNeeds: "",
        acceptanceCriteria: [],
      },
    });

    expect(converted.status).toBe("awaiting_clarification");
    expect(converted.confidence).toBe("medium");
    expect(converted.openQuestions).toContain("Who is affected by this business change?");
  });

  it("rejects non-object or missing-description legacy briefs", () => {
    expect(() => legacyFeatureBuildBriefToBusinessBuildBriefInput({
      orgId: "org-1",
      buildId: "FB-BAD",
      title: "Bad request",
      brief: null,
    })).toThrow(/legacy feature brief/i);

    expect(() => legacyFeatureBuildBriefToBusinessBuildBriefInput({
      orgId: "org-1",
      buildId: "FB-BAD2",
      title: "Bad request",
      brief: { title: "Missing description" },
    })).toThrow(/description/i);
  });
});

describe("businessBuildBriefFromRecord", () => {
  it("maps a persisted BusinessBuildBrief row into the Build Studio brief panel shape", () => {
    const brief = businessBuildBriefFromRecord({
      title: "Improve Build Studio intake",
      row: {
        intakeSource: "user_conversation",
        capabilityPackId: "build_studio_self_development",
        businessOutcome: "Help non-developers describe business outcomes.",
        affectedPeople: [
          { kind: "persona", label: "Operations lead" },
          { kind: "principal", principalId: "principal-1", label: "Platform owner" },
        ],
        affectedWorkflow: "Build Studio",
        sourceEvidence: [
          { kind: "artifact", label: "Reviewed plan", summary: "Plan called for a business-readable brief." },
        ],
        successSignals: ["A non-developer can approve the brief."],
        constraints: ["Do not expose schema details first."],
        businessInterpretation: "Build Studio should explain the business change first.",
        technicalInterpretation: {
          dataNeeds: "Brief status and evidence",
          likelyWorkflowImpact: ["Build Studio"],
          verificationFocus: ["Brief approval gate"],
        },
        riskProfile: {
          customerFacing: false,
          complianceSensitive: false,
          revenueImpacting: false,
          operationalRisk: true,
          level: "medium",
        },
        openQuestions: [],
        confidence: "high",
      },
    });

    expect(brief.title).toBe("Improve Build Studio intake");
    expect(brief.capabilityPack).toBe("Build Studio / Self-Development");
    expect(brief.affectedPeople).toEqual(["Operations lead", "Platform owner"]);
    expect(brief.sourceEvidence).toHaveLength(1);
    expect(brief.technicalInterpretation.verificationFocus).toEqual(["Brief approval gate"]);
  });

  it("falls back to the self-development capability pack for unknown stored values", () => {
    const brief = businessBuildBriefFromRecord({
      title: "Unknown capability",
      row: {
        intakeSource: "user_conversation",
        capabilityPackId: "custom_pack_that_does_not_exist",
        businessOutcome: "Keep persisted brief rendering even if a stale pack id is present.",
        affectedPeople: [],
        affectedWorkflow: null,
        sourceEvidence: [],
        successSignals: [],
        constraints: [],
        businessInterpretation: null,
        technicalInterpretation: {},
        riskProfile: {},
        openQuestions: [],
        confidence: null,
      },
    });

    expect(brief.capabilityPackId).toBe("build_studio_self_development");
    expect(brief.capabilityPack).toBe("Build Studio / Self-Development");
    expect(brief.confidence).toBe("low");
  });
});

describe("businessBuildBriefEditToPersistence", () => {
  it("normalizes business editor text into persistence fields and legacy gate JSON", () => {
    const persistence = businessBuildBriefEditToPersistence({
      briefId: "BBB-FB-123",
      businessOutcome: "Reduce missed support escalations before standup.",
      affectedPeopleText: "Support manager\nCustomer success lead",
      affectedWorkflow: "Customer escalation review",
      sourceEvidenceText: "Zendesk escalation report\nMorning standup SOP",
      successSignalsText: "Managers see unresolved escalations by site",
      constraintsText: "Do not expose customer data across accounts",
      openQuestionsText: "",
      accept: true,
    });

    expect(persistence.status).toBe("accepted");
    expect(persistence.accepted).toBe(true);
    expect(persistence.affectedPeople).toEqual([
      { kind: "persona", label: "Support manager" },
      { kind: "persona", label: "Customer success lead" },
    ]);
    expect(persistence.sourceEvidence).toEqual([
      expect.objectContaining({ kind: "artifact", summary: "Zendesk escalation report" }),
      expect.objectContaining({ kind: "artifact", summary: "Morning standup SOP" }),
    ]);
    expect(persistence.legacyFeatureBrief).toEqual(
      expect.objectContaining({
        title: "BBB-FB-123",
        description: "Reduce missed support escalations before standup.",
        portfolioContext: "Customer escalation review",
        targetRoles: ["Support manager", "Customer success lead"],
        acceptanceCriteria: ["Managers see unresolved escalations by site"],
      }),
    );
  });

  it("preserves artifact and existing-example intake context from business evidence controls", () => {
    const persistence = businessBuildBriefEditToPersistence({
      briefId: "BBB-FB-EXAMPLE",
      intakeSource: "existing_example",
      evidenceKind: "existing_example",
      businessOutcome: "Make customer onboarding follow the employee setup flow.",
      affectedPeopleText: "Customer success manager",
      affectedWorkflow: "Customer onboarding",
      sourceEvidenceText: "Employee setup flow",
      copyAdaptAvoidText: "Copy: guided checklist and progress visibility\nAdapt: approvals for customer-facing handoff\nAvoid: employee-only HR language",
      successSignalsText: "Managers can see onboarding progress without asking engineering",
      constraintsText: "Keep customer data scoped to the right account",
      openQuestionsText: "",
      accept: true,
    });

    expect(persistence.status).toBe("accepted");
    expect(persistence.intakeSource).toBe("existing_example");
    expect(persistence.sourceEvidence).toEqual([
      expect.objectContaining({
        kind: "existing_example",
        label: "Employee setup flow",
        summary: "Employee setup flow",
        copy: ["guided checklist and progress visibility"],
        adapt: ["approvals for customer-facing handoff"],
        avoid: ["employee-only HR language"],
      }),
    ]);
    expect(persistence.businessInterpretation).toContain("Copy: guided checklist and progress visibility");
    expect(persistence.legacyFeatureBrief.inputs).toEqual([
      "Employee setup flow",
      "Copy: guided checklist and progress visibility",
      "Adapt: approvals for customer-facing handoff",
      "Avoid: employee-only HR language",
    ]);
  });
});
