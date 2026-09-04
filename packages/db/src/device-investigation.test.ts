import { describe, expect, it, vi } from "vitest";
import {
  investigateUnidentifiedDevice,
  recordInvestigationOutcome,
  type RecordInvestigationClient,
} from "./device-investigation";
import { buildDeviceFingerprintObservation } from "./discovery-fingerprint-observation";

describe("investigateUnidentifiedDevice — escalation cases (irreducible unknowns)", () => {
  it("escalates ONE question for the randomized MAC host 192.168.0.59 (06:ae:95)", async () => {
    const obs = buildDeviceFingerprintObservation({ name: "192.168.0.59", attributes: { mac: "06:ae:95:11:22:33" } })!;
    const result = await investigateUnidentifiedDevice(obs);
    expect(result.outcome).toBe("escalate");
    expect(result.escalation?.reason).toBe("randomized_mac");
    expect(result.escalation?.question).toMatch(/randomized MAC/i);
    expect(result.draftRule).toBeUndefined();
  });

  it("escalates ONE question for the Sichuan AI-Link 'DEFAULT' module-vendor device", async () => {
    const obs = buildDeviceFingerprintObservation({
      name: "DEFAULT",
      attributes: { vendor: "Sichuan AI-Link Technology Co., Ltd.", mac: "a0:b1:c2:d3:e4:f5" },
    })!;
    const result = await investigateUnidentifiedDevice(obs);
    expect(result.outcome).toBe("escalate");
    expect(result.escalation?.reason).toBe("module_only_oui");
    expect(result.escalation?.question).toMatch(/Sichuan AI-Link/);
    expect(result.escalation?.evidence.moduleVendor).toBe("Sichuan AI-Link");
  });

  it("escalates for an unknown vendor when no heuristic or research resolves it", async () => {
    const obs = buildDeviceFingerprintObservation({ attributes: { vendor: "Obscure Vendor LLC", mac: "00:11:22:33:44:55" } })!;
    const result = await investigateUnidentifiedDevice(obs);
    expect(result.outcome).toBe("escalate");
    expect(result.escalation?.reason).toBe("unknown_vendor");
  });
});

describe("investigateUnidentifiedDevice — auto-resolve cases (draft rule authored)", () => {
  it("auto-resolves a recognised brand via heuristic + authors a placed draft rule", async () => {
    const obs = buildDeviceFingerprintObservation({ attributes: { vendor: "Hikvision Digital Technology", mac: "00:11:22:33:44:55" } })!;
    const result = await investigateUnidentifiedDevice(obs);
    expect(result.outcome).toBe("auto_resolve");
    expect(result.draftRule?.status).toBe("draft");
    expect(result.draftRule?.resolvedIdentity.deviceClass).toBe("ip_camera");
    expect(result.draftRule?.taxonomyNodeId).toBe("foundational/building_management/security_and_surveillance");
  });

  it("attaches a privacy-scrubbed commons contribution for a known device — no MAC/IP (BI-57C27DE1)", async () => {
    const obs = buildDeviceFingerprintObservation({ attributes: { vendor: "Hikvision Digital Technology", mac: "00:11:22:33:44:55" } })!;
    const result = await investigateUnidentifiedDevice(obs);
    expect(result.commonsContribution).toEqual({ vendor: "hikvision digital technology", deviceClass: "ip_camera" });
    // the contributed payload must never carry the MAC or any identifier
    expect(JSON.stringify(result.commonsContribution)).not.toMatch(/00:11:22|192\.168/);
  });

  it("contributes NOTHING to the commons for an unresolved/proprietary device (kept local)", async () => {
    const obs = buildDeviceFingerprintObservation({ attributes: { vendor: "Totally Unknown Vendor Ltd", mac: "aa:bb:cc:dd:ee:ff" } })!;
    const result = await investigateUnidentifiedDevice(obs);
    expect(result.commonsContribution ?? null).toBeNull();
  });

  it("auto-resolves an observed printer signal into client compute without inventing an exact model", async () => {
    const obs = buildDeviceFingerprintObservation({
      name: "Printer",
      attributes: {
        vendor: "CHONGQING FUGUI ELECTRONICS CO.,LTD.",
        hostname: "NPI698BC4",
        mac: "8c:c8:4b:d6:f1:35",
        operatorName: "Printer",
      },
    })!;
    const result = await investigateUnidentifiedDevice(obs);
    expect(result.outcome).toBe("auto_resolve");
    expect(result.draftRule?.resolvedIdentity.deviceClass).toBe("printer");
    expect(result.draftRule?.resolvedIdentity.name).toBe("Printer");
    expect(result.draftRule?.taxonomyNodeId).toBe("foundational/compute/client_and_end_user_compute");
    expect(result.draftRule?.resolvedIdentity.model).toBeUndefined();
  });

  it("auto-resolves an observed Whirlpool oven into connected appliances", async () => {
    const obs = buildDeviceFingerprintObservation({
      name: "Oven",
      attributes: {
        vendor: "Whirlpool Corporation",
        mac: "88:e7:12:0f:c0:82",
        operatorName: "Oven",
      },
    })!;
    const result = await investigateUnidentifiedDevice(obs);
    expect(result.outcome).toBe("auto_resolve");
    expect(result.draftRule?.resolvedIdentity.deviceClass).toBe("oven");
    expect(result.draftRule?.resolvedIdentity.name).toBe("Whirlpool oven");
    expect(result.draftRule?.taxonomyNodeId).toBe("foundational/building_management/connected_appliances");
  });

  it("falls back to injected web research for an unknown-but-researchable vendor", async () => {
    const obs = buildDeviceFingerprintObservation({ attributes: { vendor: "Newco Devices", mac: "00:11:22:33:44:55" } })!;
    const webResearch = vi.fn().mockResolvedValue([
      { title: "Newco SmartCam", url: "https://example.com", snippet: "The Newco IP camera for home surveillance." },
    ]);
    const result = await investigateUnidentifiedDevice(obs, { webResearch });
    expect(webResearch).toHaveBeenCalledOnce();
    expect(result.outcome).toBe("auto_resolve");
    expect(result.draftRule?.resolvedIdentity.deviceClass).toBe("ip_camera");
  });
});

describe("recordInvestigationOutcome — persistence", () => {
  function mockClient() {
    const reviews: Array<Record<string, unknown>> = [];
    const rules: Array<Record<string, unknown>> = [];
    const client: RecordInvestigationClient = {
      discoveryFingerprintReview: { create: async (args: unknown) => { reviews.push((args as { data: Record<string, unknown> }).data); return {}; } },
      discoveryFingerprintRule: { upsert: async (args: unknown) => { rules.push((args as { create: Record<string, unknown> }).create); return {}; } },
      taxonomyNode: { findUnique: async () => ({ id: "cuid_security" }) },
    };
    return { client, reviews, rules };
  }

  it("records a coworker review + upserts a draft rule for an auto-resolution", async () => {
    const obs = buildDeviceFingerprintObservation({ attributes: { vendor: "Hikvision", mac: "00:11:22:33:44:55" } })!;
    const result = await investigateUnidentifiedDevice(obs);
    const { client, reviews, rules } = mockClient();
    const summary = await recordInvestigationOutcome(client, { observationId: "obs_1", reviewerId: "inventory-specialist", result });

    expect(summary.reviewDecision).toBe("draft_authored");
    expect(summary.nextStatus).toBe("draft");
    expect(summary.draftRuleKey).not.toBeNull();
    expect(reviews[0].reviewerType).toBe("coworker");
    expect(rules).toHaveLength(1);
    expect(rules[0].status).toBe("draft");
    expect(rules[0].taxonomyNodeId).toBe("cuid_security");
  });

  it("records an escalation review with the question, and authors NO rule", async () => {
    const obs = buildDeviceFingerprintObservation({ name: "192.168.0.59", attributes: { mac: "06:ae:95:11:22:33" } })!;
    const result = await investigateUnidentifiedDevice(obs);
    const { client, reviews, rules } = mockClient();
    const summary = await recordInvestigationOutcome(client, { observationId: "obs_2", result });

    expect(summary.reviewDecision).toBe("escalated");
    expect(summary.draftRuleKey).toBeNull();
    expect(rules).toHaveLength(0);
    const audit = reviews[0].auditPayload as Record<string, unknown>;
    expect((audit.escalation as Record<string, unknown>).reason).toBe("randomized_mac");
  });
});
