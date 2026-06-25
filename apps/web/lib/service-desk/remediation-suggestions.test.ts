import { describe, expect, it } from "vitest";
import {
  diagnoseAndPropose,
  suggestRemediationActions,
  type DiagnosableIncident,
} from "./remediation-suggestions";

const incident = (over: Partial<DiagnosableIncident> = {}): DiagnosableIncident => ({
  incidentKey: "edge-incident|node_1|x|t",
  edgeNodeId: "node_1",
  summary: "interface down on fw-01",
  highestSeverity: "error",
  eventClass: "interface_down",
  ...over,
});

describe("suggestRemediationActions (A4)", () => {
  it("leads with a read-only diagnostic before any mutating action", () => {
    const actions = suggestRemediationActions(incident());
    expect(actions[0].riskClass).toBe("read-only");
    expect(actions.map((a) => a.actionType)).toEqual(["collect-interface-diagnostics", "restart-interface"]);
  });

  it("matches by class or summary keywords", () => {
    expect(suggestRemediationActions(incident({ eventClass: "cert_expiring", summary: "x" }))[0].actionType).toBe("rotate-certificate");
    expect(suggestRemediationActions(incident({ eventClass: null, summary: "service down: nginx" })).map((a) => a.actionType)).toContain("restart-service");
  });

  it("falls back to read-only diagnostics for an unrecognized incident", () => {
    const actions = suggestRemediationActions(incident({ eventClass: "weird_thing", summary: "nothing matches" }));
    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe("collect-diagnostics");
    expect(actions[0].riskClass).toBe("read-only");
  });
});

describe("diagnoseAndPropose", () => {
  it("gates suggested actions through the conservative band", () => {
    const proposal = diagnoseAndPropose(incident(), undefined, "link_1");
    // read-only auto-approves; the medium restart needs a human -> overall needs approval.
    expect(proposal.overallDecision).toBe("needs-human-approval");
    expect(proposal.boundaryRef).toBe("link_1");
    expect(proposal.actions.find((a) => a.actionType === "collect-interface-diagnostics")?.decision).toBe("auto-approve");
    expect(proposal.actions.find((a) => a.actionType === "restart-interface")?.decision).toBe("needs-human-approval");
  });

  it("a read-only-only incident yields an auto-approvable proposal", () => {
    const proposal = diagnoseAndPropose(incident({ eventClass: "high_cpu", summary: "high cpu" }));
    expect(proposal.overallDecision).toBe("auto-approve");
  });
});
