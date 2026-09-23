import { describe, expect, it } from "vitest";

import { deriveGauntletGateKey } from "@/lib/build/sandbox/guard-gauntlet-evidence";
import {
  evaluatePreflightRequirement,
  isPreflightOverrideCode,
  recordSatisfiesPreflight,
} from "./preflight-record-requirement";

const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";
const TREE = "a".repeat(40);
const OTHER_TREE = "b".repeat(40);
const PLAN = "c".repeat(64);
const TOOLCHAIN = "d".repeat(64);

const identity = { repository: REPO, treeSha: TREE, guardPlanDigest: PLAN, toolchainFingerprint: TOOLCHAIN };
const KEY = deriveGauntletGateKey(identity);

function passingRecord(id = "rec-1", key = KEY) {
  return { id, details: { gateKey: key, status: "passed", evidence: { gateKey: key, gatePassed: true } } };
}

describe("recordSatisfiesPreflight", () => {
  it("accepts a passing record for the key", () => {
    expect(recordSatisfiesPreflight(passingRecord(), KEY)).toBe(true);
  });

  it("reads the key from the nested evidence when the top level lacks it", () => {
    const row = { id: "r", details: { status: "passed", evidence: { gateKey: KEY, gatePassed: true } } };
    expect(recordSatisfiesPreflight(row, KEY)).toBe(true);
  });

  it("rejects a record for a different key", () => {
    expect(recordSatisfiesPreflight(passingRecord("r", "other"), KEY)).toBe(false);
  });

  it("rejects a FAILING record even when the key matches", () => {
    const row = { id: "r", details: { gateKey: KEY, status: "failed", evidence: { gatePassed: false } } };
    expect(recordSatisfiesPreflight(row, KEY)).toBe(false);
  });

  it("rejects a record whose status passed but whose gauntlet verdict did not", () => {
    const row = { id: "r", details: { gateKey: KEY, status: "passed", evidence: { gatePassed: false } } };
    expect(recordSatisfiesPreflight(row, KEY)).toBe(false);
  });

  it("rejects an empty or malformed record rather than throwing", () => {
    expect(recordSatisfiesPreflight({ id: "r", details: null }, KEY)).toBe(false);
    expect(recordSatisfiesPreflight({ id: "r", details: {} }, KEY)).toBe(false);
  });
});

describe("evaluatePreflightRequirement", () => {
  it("allows publication when a passing record exists for the exact tree", () => {
    const result = evaluatePreflightRequirement({ ...identity, records: [passingRecord()] });
    expect(result.blockers).toEqual([]);
    expect(result.evidenceRecordId).toBe("rec-1");
  });

  it("REFUSES when the only record is for an earlier tree of the same build", () => {
    // The case this whole slice exists for: the guards were fixed, the code
    // changed again, and publishing would ship the unverified version.
    const earlier = deriveGauntletGateKey({ ...identity, treeSha: OTHER_TREE });
    const result = evaluatePreflightRequirement({
      ...identity,
      records: [passingRecord("older", earlier)],
    });
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toContain("does not carry over");
  });

  it("refuses when there are no records at all", () => {
    const result = evaluatePreflightRequirement({ ...identity, records: [] });
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toContain("has not passed");
  });

  it("refuses when the tree cannot be identified", () => {
    // Unreadable is not permission: the cost of a wrong yes is unverified code
    // on a shared repository.
    const result = evaluatePreflightRequirement({ ...identity, treeSha: null, records: [passingRecord()] });
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toContain("could not be identified");
  });

  it("refuses when the plan or toolchain is unknown", () => {
    expect(evaluatePreflightRequirement({ ...identity, guardPlanDigest: null, records: [] }).blockers)
      .toHaveLength(1);
    expect(evaluatePreflightRequirement({ ...identity, toolchainFingerprint: null, records: [] }).blockers)
      .toHaveLength(1);
  });

  it("refuses rather than throwing when the key cannot be derived", () => {
    const result = evaluatePreflightRequirement({
      ...identity,
      treeSha: "not-a-sha",
      guardPlanDigest: PLAN,
      toolchainFingerprint: TOOLCHAIN,
      records: [],
    });
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toContain("could not be derived");
  });

  it("speaks to a non-developer: no key, script name or shell command in a blocker", () => {
    const result = evaluatePreflightRequirement({ ...identity, records: [] });
    expect(result.blockers[0]).not.toMatch(/gateKey|\.mjs|node scripts|sha256/);
  });

  it("honours an allowlisted override, and only an allowlisted one", () => {
    expect(evaluatePreflightRequirement({
      ...identity,
      records: [],
      overrideCode: "infrastructure-unavailable",
    }).blockers).toEqual([]);

    expect(evaluatePreflightRequirement({
      ...identity,
      records: [],
      overrideCode: "because-i-said-so",
    }).blockers).toHaveLength(1);
  });
});

describe("isPreflightOverrideCode", () => {
  it("accepts the closed set and nothing else", () => {
    expect(isPreflightOverrideCode("external-contribution-no-install")).toBe(true);
    expect(isPreflightOverrideCode("infrastructure-unavailable")).toBe(true);
    expect(isPreflightOverrideCode("anything-else")).toBe(false);
    expect(isPreflightOverrideCode(undefined)).toBe(false);
    expect(isPreflightOverrideCode(true)).toBe(false);
  });
});
