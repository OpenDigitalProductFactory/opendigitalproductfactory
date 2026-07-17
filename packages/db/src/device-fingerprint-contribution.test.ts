import { describe, expect, it } from "vitest";
import {
  buildFingerprintContribution,
  decideInboundActivation,
  type ContributableRule,
  type InboundFingerprintRule,
} from "./device-fingerprint-contribution";

const reolinkRule: ContributableRule = {
  ruleKey: "estate:reolink-camera",
  requiredEvidenceFamilies: ["mac_oui"],
  matchExpression: { all: [{ type: "contains", path: "vendor", value: "reolink" }] },
  resolvedIdentity: { kind: "device", name: "Reolink IP camera / NVR", vendor: "Reolink", deviceClass: "ip_camera" },
  taxonomyNodeId: "foundational/building_management/security_and_surveillance",
  identityConfidence: 0.96,
  taxonomyConfidence: 0.96,
};

describe("buildFingerprintContribution — opt-in gating + fail-closed redaction", () => {
  it("skips when the device-fingerprint opt-in is off", () => {
    const result = buildFingerprintContribution(reolinkRule, { optIn: false, contributor: "dpf-pseudo-123" });
    expect(result.status).toBe("skipped_opt_out");
  });

  it("produces a PII-free payload with the contributor pseudonym when opted in", () => {
    const result = buildFingerprintContribution(reolinkRule, { optIn: true, contributor: "dpf-pseudo-123" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.payload.contributor).toBe("dpf-pseudo-123");
    expect(result.payload.taxonomyNodeId).toBe("foundational/building_management/security_and_surveillance");
    expect(result.payload.resolvedIdentity.deviceClass).toBe("ip_camera");
    // No MAC/IP/hostname anywhere in the contributed shape.
    expect(JSON.stringify(result.payload)).not.toMatch(/(?:[0-9a-f]{2}:){5}[0-9a-f]{2}/i);
  });

  it("ABORTS fail-closed when the rule embeds a secret-like token (blocked_sensitive)", () => {
    const poisoned: ContributableRule = {
      ...reolinkRule,
      matchExpression: { all: [{ type: "contains", path: "banner", value: "authorization: bearer sk-abc123" }] },
    };
    const result = buildFingerprintContribution(poisoned, { optIn: true, contributor: "dpf-pseudo-123" });
    expect(result.status).toBe("aborted_blocked_sensitive");
    if (result.status !== "aborted_blocked_sensitive") return;
    expect(result.blockedReasons).toContain("secret_like_token");
  });

  it("redacts (does not abort) an embedded MAC/IP, contributing the cleaned shape", () => {
    const withMac: ContributableRule = {
      ...reolinkRule,
      matchExpression: { all: [{ type: "exact", path: "mac", value: "ec:71:db:11:22:33" }] },
    };
    const result = buildFingerprintContribution(withMac, { optIn: true, contributor: "p" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(JSON.stringify(result.payload)).toContain("[redacted-mac]");
    expect(result.redactedFields.length).toBeGreaterThan(0);
  });
});

// BI-8577DA8F (HAM Phase D1, spec §5.3): commodity hardware model rules reuse the SAME
// device-fingerprint contribution path — no second egress mechanism. The shareable
// manufacturer/product/model mapping rides `resolvedIdentity` (kind='hardware', model),
// so no payload extension is needed; the redaction gate + opt-in still apply unchanged.
const dellR750Rule: ContributableRule = {
  ruleKey: "estate:dell-poweredge-r750",
  requiredEvidenceFamilies: ["dmi"],
  matchExpression: { all: [{ type: "contains", path: "product", value: "poweredge r750" }] },
  resolvedIdentity: { kind: "hardware", name: "Dell PowerEdge R750", vendor: "Dell", model: "PowerEdge R750", deviceClass: "server" },
  taxonomyNodeId: "foundational/compute/physical_compute",
  identityConfidence: 0.97,
  taxonomyConfidence: 0.95,
};

describe("buildFingerprintContribution — commodity hardware model rules (BI-8577DA8F)", () => {
  it("contributes a commodity hardware model rule through the SAME path, mapping on resolvedIdentity", () => {
    const result = buildFingerprintContribution(dellR750Rule, { optIn: true, contributor: "dpf-pseudo-hw" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // The §5.3 shareable manufacturer/product/model mapping — already carried, no new field.
    expect(result.payload.resolvedIdentity.vendor).toBe("Dell");
    expect(result.payload.resolvedIdentity.model).toBe("PowerEdge R750");
    expect(result.payload.taxonomyNodeId).toBe("foundational/compute/physical_compute");
  });

  it("honors the same device-fingerprint opt-out for hardware rules", () => {
    expect(buildFingerprintContribution(dellR750Rule, { optIn: false, contributor: "p" }).status).toBe("skipped_opt_out");
  });

  it("redacts an embedded MAC in a hardware rule (does not egress a private local literal)", () => {
    const withMac: ContributableRule = {
      ...dellR750Rule,
      matchExpression: { all: [{ type: "exact", path: "mac", value: "b0:83:fe:aa:bb:cc" }] },
    };
    const result = buildFingerprintContribution(withMac, { optIn: true, contributor: "p" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(JSON.stringify(result.payload)).toContain("[redacted-mac]");
    expect(result.redactedFields.length).toBeGreaterThan(0);
  });

  it("ABORTS fail-closed when a hardware rule embeds a secret-like token", () => {
    const poisoned: ContributableRule = {
      ...dellR750Rule,
      matchExpression: { all: [{ type: "contains", path: "banner", value: "authorization: bearer sk-idrac999" }] },
    };
    const result = buildFingerprintContribution(poisoned, { optIn: true, contributor: "p" });
    expect(result.status).toBe("aborted_blocked_sensitive");
  });

  it("activates an inbound hardware model rule only after the install's own fixtures pass", () => {
    const inboundHw: InboundFingerprintRule = {
      ...dellR750Rule,
      provenance: { contributor: "dpf-other-install", curationRecordId: "cur_hw" },
    };
    const decision = decideInboundActivation(inboundHw, {
      positive: [{ name: "r750", evidenceFamilies: ["dmi"], normalizedEvidence: { product: "poweredge r750" } }],
      negative: [{ name: "r640", evidenceFamilies: ["dmi"], normalizedEvidence: { product: "poweredge r640" } }],
    });
    expect(decision.activate).toBe(true);
    expect(decision.scope).toBe("local"); // never auto-global, hardware included
  });
});

describe("decideInboundActivation — supply-chain-safe fixture gating", () => {
  const inbound: InboundFingerprintRule = {
    ...reolinkRule,
    provenance: { contributor: "dpf-other-install", curationRecordId: "cur_1" },
  };
  const posFixture = { name: "reolink", evidenceFamilies: ["mac_oui"], normalizedEvidence: { vendor: "reolink" } };
  const negFixture = { name: "acme", evidenceFamilies: ["mac_oui"], normalizedEvidence: { vendor: "acme corp" } };

  it("activates locally only after the install's own fixtures pass", () => {
    const decision = decideInboundActivation(inbound, { positive: [posFixture], negative: [negFixture] });
    expect(decision.activate).toBe(true);
    expect(decision.status).toBe("active");
    expect(decision.scope).toBe("local"); // never auto-global
  });

  it("stays draft (does NOT activate) when a positive fixture fails to match", () => {
    const decision = decideInboundActivation(inbound, {
      positive: [{ name: "wrong", evidenceFamilies: ["mac_oui"], normalizedEvidence: { vendor: "nothing-matches" } }],
      negative: [],
    });
    expect(decision.activate).toBe(false);
    expect(decision.status).toBe("draft");
    expect(decision.reasons.some((r) => r.startsWith("positive_fixture_failed"))).toBe(true);
  });

  it("stays draft when a negative fixture wrongly matches", () => {
    const decision = decideInboundActivation(inbound, {
      positive: [posFixture],
      negative: [{ name: "bad-neg", evidenceFamilies: ["mac_oui"], normalizedEvidence: { vendor: "reolink pro" } }],
    });
    expect(decision.activate).toBe(false);
    expect(decision.reasons.some((r) => r.startsWith("negative_fixture_matched"))).toBe(true);
  });

  it("refuses to activate a rule with no provenance (sight-unseen)", () => {
    const noProv = { ...inbound, provenance: { contributor: "", curationRecordId: "" } };
    const decision = decideInboundActivation(noProv, { positive: [posFixture], negative: [] });
    expect(decision.activate).toBe(false);
    expect(decision.reasons).toContain("missing_provenance");
  });
});
