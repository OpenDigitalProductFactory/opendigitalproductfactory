import { describe, it, expect } from "vitest";
import {
  clampToolResultForModel,
  resolveToolResultCharCap,
  DEFAULT_TOOL_RESULT_CHAR_CAP,
  MCP_ROUTE_TOOL_RESULT_CHAR_CAP,
} from "./tool-result-budget";
import type { DataPolicyDecision } from "@/lib/govern/data/policy-decision";

describe("resolveToolResultCharCap", () => {
  it("returns the conservative default when the window is unknown", () => {
    expect(resolveToolResultCharCap(undefined)).toBe(DEFAULT_TOOL_RESULT_CHAR_CAP);
    expect(resolveToolResultCharCap(null)).toBe(DEFAULT_TOOL_RESULT_CHAR_CAP);
    expect(resolveToolResultCharCap(0)).toBe(DEFAULT_TOOL_RESULT_CHAR_CAP);
  });

  it("scales to ~10% of a known local window (24,576 tokens)", () => {
    // 24_576 * 4 chars/token * 0.10 = 9_830 chars (~2.4K tokens, ~10% of window)
    expect(resolveToolResultCharCap(24_576)).toBe(9_830);
  });

  it("never returns below the conservative default for tiny windows", () => {
    expect(resolveToolResultCharCap(1_000)).toBe(DEFAULT_TOOL_RESULT_CHAR_CAP);
  });

  it("ceils at the big-window cap so huge cloud windows do not allow unbounded results", () => {
    expect(resolveToolResultCharCap(2_000_000)).toBe(MCP_ROUTE_TOOL_RESULT_CHAR_CAP);
  });
});

describe("clampToolResultForModel", () => {
  it("masks a governed tool result before model-facing serialization", () => {
    const decision: DataPolicyDecision = {
      decisionId: "decision-tool-mask",
      organizationId: "org-test",
      inputHash: "input",
      effect: "allow-with-obligations",
      obligations: [{ kind: "mask", profileId: "default-confidential" }],
      matchedPolicyVersions: ["confidential-projection-mask@1"],
      assetVersion: "a1",
      classificationVersion: "c1",
      authorityVersion: "auth1",
      explanationCode: "confidential-masked-before-projection",
      replay: "single-use",
    };
    const out = clampToolResultForModel(
      { success: true, data: { customerEmail: "ada@example.com" } },
      {
        contextMask: {
          decision,
          detailUse: "replaceable",
          matches: [{
            dataClass: "customer-records",
            path: "data.customerEmail",
            reason: "contact-detail",
            confidence: "deterministic",
          }],
        },
      },
    );

    expect(out.text).not.toContain("ada@example.com");
    expect(out.text).toContain("[DPF_TOKEN_");
    expect(out.rehydrationHandle).toMatch(/^rehydration_/);
  });

  it("passes through a small successful result untouched", () => {
    const out = clampToolResultForModel(
      { success: true, message: "ok", data: { a: 1 } },
      { maxChars: 4_000 },
    );
    expect(out.truncated).toBe(false);
    expect(out.text).toBe('ok\n{"a":1}');
  });

  it("serializes errors without leaking data", () => {
    const out = clampToolResultForModel(
      { success: false, error: "boom", data: { secret: "x" } },
      { maxChars: 4_000 },
    );
    expect(out.text).toBe("Error: boom");
    expect(out.truncated).toBe(false);
  });

  it("truncates an over-budget result and stays within maxChars, with a notice", () => {
    const big = "y".repeat(50_000);
    const out = clampToolResultForModel(
      { success: true, message: "rows", data: { blob: big } },
      { maxChars: 4_000 },
    );
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(4_000);
    expect(out.text).toContain("truncated");
    expect(out.text).toContain("filter/pagination");
    expect(out.originalChars).toBeGreaterThan(50_000);
  });

  it("caps a large message even when there is no data", () => {
    const out = clampToolResultForModel(
      { success: true, message: "m".repeat(20_000) },
      { maxChars: 1_000 },
    );
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(1_000);
  });
});
