import { describe, expect, it, vi } from "vitest";

vi.mock("./client.js", () => ({ prisma: {} }));

import {
  CROSS_NOTATION_REL_TYPES,
  CROSS_RULES,
} from "./seed-ea-cross-notation.js";

describe("AI-routing cross-notation contracts", () => {
  it("seeds every dedicated relationship type used by the live routing projection", () => {
    const slugs = new Set(CROSS_NOTATION_REL_TYPES.map((type) => type.slug));
    expect(slugs.size).toBeGreaterThanOrEqual(5);
    for (const slug of [
      "details",
      "realizes_process",
      "sysml_allocates",
      "sysml_traces",
      "sysml_verifies",
    ]) {
      expect(slugs.has(slug), slug).toBe(true);
    }
  });

  it("permits the BPMN, SysML, and ArchiMate element-type pairs materialized by AI routing", () => {
    const rule = (
      fromNotation: string,
      fromSlug: string,
      toNotation: string,
      toSlug: string,
      relSlug: string,
    ) =>
      CROSS_RULES.some(
        (candidate) =>
          candidate.fromNotation === fromNotation &&
          candidate.fromSlug === fromSlug &&
          candidate.toNotation === toNotation &&
          candidate.toSlug === toSlug &&
          candidate.relSlug === relSlug,
      );

    expect(rule("bpmn20", "bpmn_process", "archimate4", "business_process", "details")).toBe(true);
    expect(
      rule(
        "archimate4",
        "application_component",
        "bpmn20",
        "bpmn_service_task",
        "realizes_process",
      ),
    ).toBe(true);
    expect(
      rule(
        "archimate4",
        "application_component",
        "bpmn20",
        "bpmn_business_rule_task",
        "realizes_process",
      ),
    ).toBe(true);
    expect(
      rule(
        "sysml2",
        "part_definition",
        "archimate4",
        "application_component",
        "sysml_allocates",
      ),
    ).toBe(true);
    expect(
      rule(
        "sysml2",
        "requirement",
        "archimate4",
        "business_capability",
        "sysml_traces",
      ),
    ).toBe(true);
    expect(
      rule(
        "sysml2",
        "verification_case",
        "archimate4",
        "event_evidence",
        "sysml_verifies",
      ),
    ).toBe(true);
  });
});
