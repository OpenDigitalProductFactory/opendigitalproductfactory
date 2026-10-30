import { describe, expect, it, vi } from "vitest";

import { readinessRequirement } from "./readiness-guidance";
import { resolveTerminalInitiativeRecovery } from "./terminal-recovery";
import type { InitiativeReadinessDecision } from "./types";

describe("terminal qualification recovery", () => {
  it("returns the exact server-issued qualification admission before baseline routing", async () => {
    const qualificationAdmission = {
      toolName: "claim_workroom_scope" as const, workroomId: "WC-QUAL",
      qualificationAdmissionToken: "opaque.signed", bindingDigest: `sha256:${"a".repeat(64)}`,
      binding: { itemId: "BI-QUAL" },
    } as never;
    const ports = {
      resolveQualificationAdmission: vi.fn().mockResolvedValue(qualificationAdmission),
      loadLiveRooms: vi.fn(), loadBaselinePayloads: vi.fn(),
    } as never;
    const decision: InitiativeReadinessDecision = {
      decisionId: "IRD-QUAL", policyVersion: "initiative-readiness.v2",
      subject: { kind: "backlog-item", id: "BI-QUAL" },
      transitionObject: { kind: "backlog-item", id: "BI-QUAL", expectedVersion: "in-progress", targetState: "done" },
      profile: "fix", target: "completion", verdict: "denied", satisfied: [], unmet: [],
      blockers: [readinessRequirement({ code: "RESEARCH_REQUIRED", state: "fail", accountableRole: "design-author" })],
      evaluatedAt: "2025-06-18T12:00:00.000Z",
    };

    const result = await resolveTerminalInitiativeRecovery({ decision, currentAgentId: "AGT-CALLER",
      refusedWorkroomId: "WC-QUAL", ports });

    expect(result.qualificationAdmission).toBe(qualificationAdmission);
    expect(result.escalations).toMatchObject([{ toolName: "claim_workroom_scope" }]);
    expect((ports as { loadBaselinePayloads: ReturnType<typeof vi.fn> }).loadBaselinePayloads).not.toHaveBeenCalled();
  });
});
