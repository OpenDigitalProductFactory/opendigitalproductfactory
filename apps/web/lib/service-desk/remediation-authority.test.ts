import { describe, expect, it } from "vitest";
import {
  authorityBandFromBinding,
  buildRemediationProposal,
  CONSERVATIVE_AUTHORITY_BAND,
  evaluateRemediationAuthority,
  type AuthorityBand,
  type RemediationActionDraft,
} from "./remediation-authority";

describe("evaluateRemediationAuthority (A4/B4)", () => {
  it("conservative default: read-only auto-approves, mutations need a human, destructive refused", () => {
    expect(evaluateRemediationAuthority("read-only")).toBe("auto-approve");
    expect(evaluateRemediationAuthority("low")).toBe("needs-human-approval");
    expect(evaluateRemediationAuthority("high")).toBe("needs-human-approval");
    expect(evaluateRemediationAuthority("destructive")).toBe("refuse");
  });

  it("a widened band auto-approves up to its ceiling", () => {
    const band: AuthorityBand = { autoApproveCeiling: "medium", humanApprovalCeiling: "destructive" };
    expect(evaluateRemediationAuthority("medium", band)).toBe("auto-approve");
    expect(evaluateRemediationAuthority("high", band)).toBe("needs-human-approval");
    expect(evaluateRemediationAuthority("destructive", band)).toBe("needs-human-approval");
  });
});

describe("buildRemediationProposal", () => {
  const actions: RemediationActionDraft[] = [
    { actionType: "collect-diagnostics", parameters: {}, riskClass: "read-only", rationale: "gather" },
    { actionType: "restart-service", parameters: { svc: "nginx" }, riskClass: "medium", rationale: "recover" },
    { actionType: "wipe-disk", parameters: {}, riskClass: "destructive", rationale: "n/a" },
  ];

  it("gates by the strictest dispatchable action and lists refused actions", () => {
    const proposal = buildRemediationProposal(
      { incidentKey: "edge-incident|node_1|deploy|t", edgeNodeId: "node_1", boundaryRef: "link_42" },
      actions,
    );
    expect(proposal.overallDecision).toBe("needs-human-approval"); // medium gates; destructive refused (excluded)
    expect(proposal.refusedActionTypes).toEqual(["wipe-disk"]);
    expect(proposal.boundaryRef).toBe("link_42");
    expect(proposal.actions.find((a) => a.actionType === "collect-diagnostics")?.decision).toBe(
      "auto-approve",
    );
  });

  it("auto-approves a read-only-only proposal", () => {
    const proposal = buildRemediationProposal(
      { incidentKey: "k", edgeNodeId: "node_1" },
      [{ actionType: "collect-diagnostics", parameters: {}, riskClass: "read-only", rationale: "x" }],
    );
    expect(proposal.overallDecision).toBe("auto-approve");
    expect(proposal.boundaryRef).toBe("organization:internal");
  });

  it("refuses an all-destructive proposal (nothing dispatchable)", () => {
    const proposal = buildRemediationProposal({ incidentKey: "k", edgeNodeId: "n" }, [
      { actionType: "wipe-disk", parameters: {}, riskClass: "destructive", rationale: "n/a" },
    ]);
    expect(proposal.overallDecision).toBe("refuse");
  });
});

describe("authorityBandFromBinding (fail closed)", () => {
  it("falls back to the conservative band when no binding", () => {
    expect(authorityBandFromBinding(null)).toEqual(CONSERVATIVE_AUTHORITY_BAND);
    expect(authorityBandFromBinding(undefined)).toEqual(CONSERVATIVE_AUTHORITY_BAND);
  });

  it("only approvalMode=none widens auto-approve, up to the sensitivity ceiling", () => {
    expect(authorityBandFromBinding({ approvalMode: "none", sensitivityCeiling: "medium" })).toEqual({
      autoApproveCeiling: "medium",
      humanApprovalCeiling: "medium",
    });
    // Any other approvalMode keeps auto-approve clamped to read-only.
    expect(authorityBandFromBinding({ approvalMode: "operator", sensitivityCeiling: "high" })).toEqual({
      autoApproveCeiling: "read-only",
      humanApprovalCeiling: "high",
    });
    // Unknown ceiling defaults to "high".
    expect(authorityBandFromBinding({ approvalMode: "none", sensitivityCeiling: "bogus" })).toEqual({
      autoApproveCeiling: "high",
      humanApprovalCeiling: "high",
    });
  });
});
