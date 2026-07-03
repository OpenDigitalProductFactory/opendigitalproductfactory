import { describe, it, expect } from "vitest";
import {
  validateProposalPayload,
  parseControlMappingPayload,
  isProposalKind,
  PROPOSAL_KINDS,
} from "./compliance-proposal";

describe("compliance proposal validation (Phase 5)", () => {
  it("accepts a well-formed control-mapping", () => {
    expect(validateProposalPayload("control-mapping", { controlId: "c1", obligationId: "o1" })).toBeNull();
  });

  it("rejects a control-mapping missing ids", () => {
    expect(validateProposalPayload("control-mapping", { controlId: "c1" })).toMatch(/obligationId/);
    expect(validateProposalPayload("control-mapping", {})).toMatch(/controlId/);
  });

  it("validates regulation / obligation proposals structurally", () => {
    expect(validateProposalPayload("regulation", { name: "New Reg" })).toBeNull();
    expect(validateProposalPayload("regulation", {})).toMatch(/name/);
    expect(validateProposalPayload("obligation", { title: "T", regulationId: "r1" })).toBeNull();
    expect(validateProposalPayload("obligation", { title: "T" })).toMatch(/regulationId/);
  });

  it("rejects unknown kinds and non-object payloads", () => {
    expect(validateProposalPayload("nonsense", {})).toMatch(/Unknown proposal kind/);
    expect(validateProposalPayload("control-mapping", null)).toMatch(/must be an object/);
    expect(validateProposalPayload("control-mapping", [])).toMatch(/must be an object/);
  });

  it("parseControlMappingPayload returns the mapping or null", () => {
    expect(parseControlMappingPayload({ controlId: "c1", obligationId: "o1" })).toEqual({
      controlId: "c1",
      obligationId: "o1",
    });
    expect(parseControlMappingPayload({ controlId: "c1" })).toBeNull();
  });

  it("isProposalKind guards the canonical set", () => {
    expect(PROPOSAL_KINDS.every((k) => isProposalKind(k))).toBe(true);
    expect(isProposalKind("mystery")).toBe(false);
  });
});
