import { describe, expect, it } from "vitest";
import {
  evaluateFingerprintRule,
  ruleUsesUnsupportedComparator,
  SUPPORTED_COMPARATOR_TYPES,
  type FingerprintRuleInput,
} from "./discovery-fingerprint-rules";

describe("evaluateFingerprintRule", () => {
  it("matches when all required evidence families and expressions match", () => {
    const result = evaluateFingerprintRule(
      {
        ruleKey: "observability:prometheus-node-exporter",
        requiredEvidenceFamilies: ["prometheus_target", "process_name"],
        matchExpression: {
          all: [
            { type: "contains", path: "job", value: "node-exporter" },
            { type: "contains", path: "process", value: "node_exporter" },
          ],
        },
      },
      {
        evidenceFamilies: ["prometheus_target", "process_name"],
        normalizedEvidence: { job: "node-exporter", process: "node_exporter" },
      },
    );

    expect(result.matched).toBe(true);
  });

  it("does not match when required evidence is missing", () => {
    const result = evaluateFingerprintRule(
      {
        ruleKey: "observability:prometheus-node-exporter",
        requiredEvidenceFamilies: ["prometheus_target", "process_name"],
        matchExpression: {
          all: [{ type: "contains", path: "job", value: "node-exporter" }],
        },
      },
      {
        evidenceFamilies: ["prometheus_target"],
        normalizedEvidence: { job: "node-exporter" },
      },
    );

    expect(result.matched).toBe(false);
    expect(result.reasons).toContain("missing_required_evidence_family:process_name");
  });

  describe("ordered_list_prefix comparator (DHCP Option 55)", () => {
    const dhcpRule: FingerprintRuleInput = {
      ruleKey: "device:apple-dhcp-prl",
      requiredEvidenceFamilies: ["dhcp"],
      matchExpression: {
        all: [{ type: "ordered_list_prefix", path: "dhcp.option55", value: "1,121,3,6,15,119,252" }],
      },
    };

    it("matches when the observed ordered list starts with the rule prefix (array evidence)", () => {
      const result = evaluateFingerprintRule(dhcpRule, {
        evidenceFamilies: ["dhcp"],
        normalizedEvidence: { dhcp: { option55: [1, 121, 3, 6, 15, 119, 252, 95, 44, 46] } },
      });
      expect(result.matched).toBe(true);
    });

    it("matches when the observed ordered list is provided as a comma-separated string", () => {
      const result = evaluateFingerprintRule(dhcpRule, {
        evidenceFamilies: ["dhcp"],
        normalizedEvidence: { dhcp: { option55: "1,121,3,6,15,119,252,95" } },
      });
      expect(result.matched).toBe(true);
    });

    it("does NOT match when the order differs", () => {
      const result = evaluateFingerprintRule(dhcpRule, {
        evidenceFamilies: ["dhcp"],
        normalizedEvidence: { dhcp: { option55: [1, 3, 6, 15, 119, 252, 121] } },
      });
      expect(result.matched).toBe(false);
    });

    it("does NOT match when the observed list is shorter than the prefix", () => {
      const result = evaluateFingerprintRule(dhcpRule, {
        evidenceFamilies: ["dhcp"],
        normalizedEvidence: { dhcp: { option55: [1, 121, 3] } },
      });
      expect(result.matched).toBe(false);
    });

    it("does NOT match when the signal is absent", () => {
      const result = evaluateFingerprintRule(dhcpRule, {
        evidenceFamilies: ["dhcp"],
        normalizedEvidence: { dhcp: {} },
      });
      expect(result.matched).toBe(false);
    });
  });

  describe("forward/backward compat — unsupported comparators (spec §10)", () => {
    const futureRule = {
      ruleKey: "device:from-the-future",
      requiredEvidenceFamilies: ["dhcp"],
      matchExpression: {
        all: [{ type: "tls_ja3_fuzzy", path: "tls.ja3", value: "abc" }],
      },
    } as unknown as FingerprintRuleInput;

    it("flags a rule using a comparator this engine version does not know", () => {
      expect(ruleUsesUnsupportedComparator(futureRule)).toBe(true);
      expect(SUPPORTED_COMPARATOR_TYPES.has("tls_ja3_fuzzy")).toBe(false);
    });

    it("skips (does not match, does not crash) an unsupported-comparator rule even when evidence is present", () => {
      const result = evaluateFingerprintRule(futureRule, {
        evidenceFamilies: ["dhcp"],
        normalizedEvidence: { tls: { ja3: "abc" } },
      });
      expect(result.matched).toBe(false);
      expect(result.reasons).toContain("unsupported_comparator");
    });

    it("does not flag rules using only supported comparators", () => {
      expect(
        ruleUsesUnsupportedComparator({
          ruleKey: "ok",
          requiredEvidenceFamilies: ["dhcp"],
          matchExpression: { any: [{ type: "contains", path: "x", value: "y" }] },
        }),
      ).toBe(false);
    });
  });
});
