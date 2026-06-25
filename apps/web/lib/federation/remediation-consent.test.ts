import { describe, expect, it } from "vitest";
import { buildRemediationProposal } from "@/lib/service-desk/remediation-authority";
import {
  buildFederatedProposalRecord,
  routeRemediationProposal,
} from "./remediation-consent";

function proposal(risk: "read-only" | "medium" | "destructive") {
  return buildRemediationProposal(
    { incidentKey: "edge-incident|node_1|x|t", edgeNodeId: "node_1", boundaryRef: "link_1" },
    [{ actionType: "act", parameters: {}, riskClass: risk, rationale: "r" }],
  );
}

describe("routeRemediationProposal (B4 consent gate)", () => {
  it("refuses anything over an untrusted link", () => {
    expect(routeRemediationProposal({ proposal: proposal("read-only"), linkTrusted: false, customerAllowsAuto: true })).toBe(
      "refused",
    );
  });

  it("refuses a band-refused proposal", () => {
    expect(routeRemediationProposal({ proposal: proposal("destructive"), linkTrusted: true, customerAllowsAuto: true })).toBe(
      "refused",
    );
  });

  it("auto-executes a read-only proposal ONLY if the customer's own policy permits", () => {
    expect(routeRemediationProposal({ proposal: proposal("read-only"), linkTrusted: true, customerAllowsAuto: true })).toBe(
      "auto-execute-on-customer",
    );
    // Same proposal, customer has not opted into auto -> still needs a human at the customer.
    expect(routeRemediationProposal({ proposal: proposal("read-only"), linkTrusted: true, customerAllowsAuto: false })).toBe(
      "customer-attention-surface",
    );
  });

  it("routes a mutating proposal to the customer's Attention Surface", () => {
    expect(routeRemediationProposal({ proposal: proposal("medium"), linkTrusted: true, customerAllowsAuto: true })).toBe(
      "customer-attention-surface",
    );
  });
});

describe("buildFederatedProposalRecord", () => {
  it("shapes the persisted proposal with its landing", () => {
    const p = proposal("medium");
    const rec = buildFederatedProposalRecord("link_1", p, "customer-attention-surface");
    expect(rec.federationLinkId).toBe("link_1");
    expect(rec.incidentKey).toBe(p.incidentKey);
    expect(rec.status).toBe("proposed");
    expect(rec.landing).toBe("customer-attention-surface");
  });
});
