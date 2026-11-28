import { describe, expect, it } from "vitest";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import {
  formatPresentationParam,
  isApprovalPresentationCompatibleWithConsequence,
  matchesApprovalPresentationParams,
  type ToolApprovalPresentation,
} from "./tool-approval-presentation";

describe("tool-approval-presentation helpers", () => {
  const sample: ToolApprovalPresentation = {
    question: "Run inventory discovery triage?",
    what: "Reviews unmatched inventory items and applies safe high-confidence catalog matches.",
    impact: "Stays inside DPF and touches no external systems.",
    reversibility: "reversible",
    allowedParams: ["trigger", "includeDecisions"],
    allowEmptyParams: true,
    paramLabels: {
      trigger: { label: "Trigger", valueLabels: { cadence: "Scheduled daily cadence" } },
      includeDecisions: { label: "Detailed decisions", valueLabels: { false: "Compact summary only" } },
    },
  };

  it("matches exact allowed params and fails closed on unexpected keys", () => {
    expect(matchesApprovalPresentationParams(sample, { trigger: "cadence", includeDecisions: false }, false)).toBe(true);
    expect(matchesApprovalPresentationParams(sample, null, true)).toBe(true);
    expect(matchesApprovalPresentationParams(sample, null, false)).toBe(false);
    expect(matchesApprovalPresentationParams(sample, { trigger: "cadence", payment: { amount: 100 } }, false)).toBe(false);
    expect(matchesApprovalPresentationParams({ ...sample, allowEmptyParams: false }, {}, true)).toBe(false);
  });

  it("never lets a presentation soften a tool's declared consequence", () => {
    expect(isApprovalPresentationCompatibleWithConsequence(sample, null)).toBe(true);
    expect(isApprovalPresentationCompatibleWithConsequence(sample, undefined)).toBe(true);
    expect(isApprovalPresentationCompatibleWithConsequence(sample, "irreversible")).toBe(false);
    expect(isApprovalPresentationCompatibleWithConsequence(sample, "outward")).toBe(false);
    expect(isApprovalPresentationCompatibleWithConsequence(sample, "authority")).toBe(false);
    expect(isApprovalPresentationCompatibleWithConsequence({ ...sample, reversibility: "irreversible" }, "irreversible")).toBe(true);
    expect(isApprovalPresentationCompatibleWithConsequence({ ...sample, reversibility: "outward" }, "outward")).toBe(true);
    expect(isApprovalPresentationCompatibleWithConsequence({ ...sample, reversibility: "authority" }, "authority")).toBe(true);
  });

  it("formats mapped scalar parameter labels and falls back safely", () => {
    expect(formatPresentationParam(sample, "trigger", "cadence", "Trigger", "cadence")).toEqual({
      label: "Trigger",
      value: "Scheduled daily cadence",
    });
    expect(formatPresentationParam(sample, "includeDecisions", false, "Include Decisions", "false")).toEqual({
      label: "Detailed decisions",
      value: "Compact summary only",
    });
    expect(formatPresentationParam(sample, "unknown", 42, "Unknown", "42")).toEqual({
      label: "Unknown",
      value: "42",
    });
  });
});

describe("PLATFORM_TOOLS approvalPresentation registry invariants", () => {
  const decorated = PLATFORM_TOOLS.filter((tool) => tool.approvalPresentation);

  it("includes run_discovery_triage and other discovery inventory actions", () => {
    const names = decorated.map((tool) => tool.name);
    expect(names).toContain("run_discovery_triage");
    expect(names).toContain("discovery_sweep");
    expect(names).toContain("dismiss_entity");
  });

  it("keeps every registered descriptor consistent with consequence and inputSchema", () => {
    for (const tool of decorated) {
      const pres = tool.approvalPresentation!;
      expect(
        isApprovalPresentationCompatibleWithConsequence(pres, tool.consequence),
        `${tool.name}: reversibility "${pres.reversibility}" contradicts consequence "${tool.consequence ?? "none"}"`,
      ).toBe(true);
      expect(pres.question.trim().length, `${tool.name}: question required`).toBeGreaterThan(0);
      expect(pres.question.trim().split(/\s+/).length, `${tool.name}: keep question concise`).toBeLessThanOrEqual(10);
      expect(pres.what.trim().length, `${tool.name}: what required`).toBeGreaterThan(0);
      expect(pres.impact.trim().length, `${tool.name}: impact required`).toBeGreaterThan(0);

      const schemaProps = (tool.inputSchema?.properties ?? {}) as Record<string, unknown>;
      const requiredKeys = Array.isArray(tool.inputSchema?.required) ? (tool.inputSchema.required as string[]) : [];
      if (pres.allowEmptyParams) {
        expect(requiredKeys, `${tool.name}: allowEmptyParams requires empty inputSchema.required`).toEqual([]);
      }
      for (const key of pres.allowedParams) {
        expect(key in schemaProps, `${tool.name}: allowedParams key "${key}" missing from inputSchema`).toBe(true);
      }
      for (const key of Object.keys(pres.paramLabels ?? {})) {
        expect(pres.allowedParams.includes(key), `${tool.name}: paramLabels key "${key}" not in allowedParams`).toBe(true);
      }
    }
  });
});
