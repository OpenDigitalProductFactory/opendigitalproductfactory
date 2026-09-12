import { describe, expect, it } from "vitest";

import { deriveGateKey } from "@/lib/gates/gate-run-identity";
import {
  IN_PLATFORM_PREFLIGHT_GATE_KIND,
  buildGauntletEvidence,
  deriveGauntletGateKey,
  summarizeGauntlet,
  toolchainFingerprintFrom,
} from "./guard-gauntlet-evidence";

const TREE = "b".repeat(40);
const OTHER_TREE = "c".repeat(40);
const PLAN = "d".repeat(64);
const TOOLCHAIN = "e".repeat(64);
const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";

const identity = { repository: REPO, treeSha: TREE, guardPlanDigest: PLAN, toolchainFingerprint: TOOLCHAIN };

describe("deriveGauntletGateKey", () => {
  it("is keyed to the TREE: a different tree is a different key", () => {
    expect(deriveGauntletGateKey(identity)).not.toBe(
      deriveGauntletGateKey({ ...identity, treeSha: OTHER_TREE }),
    );
  });

  it("is stable for the same tree, plan and toolchain", () => {
    expect(deriveGauntletGateKey(identity)).toBe(deriveGauntletGateKey({ ...identity }));
  });

  it("CANNOT be mistaken for the heavy tier's key for the same tree", () => {
    // This is the safety property. The fast tier runs guards only — no
    // production build, no image — so a record of it must never satisfy a claim
    // asking for local-integration-ci. The kind is hashed into the key, so the
    // two derive different keys from identical inputs.
    const heavy = deriveGateKey({
      repository: REPO,
      integrationTreeSha: TREE,
      evidencePlanDigest: PLAN,
      toolchainFingerprint: TOOLCHAIN,
      gateKind: "local-integration-ci",
    });
    expect(deriveGauntletGateKey(identity)).not.toBe(heavy);
  });

  it("uses the same derivation as the external path, not a parallel one", () => {
    // Same function, different kind — so the keying is identical rather than
    // merely similar, and there is no second implementation to drift.
    const viaShared = deriveGateKey({
      repository: REPO,
      integrationTreeSha: TREE,
      evidencePlanDigest: PLAN,
      toolchainFingerprint: TOOLCHAIN,
      gateKind: IN_PLATFORM_PREFLIGHT_GATE_KIND,
    });
    expect(deriveGauntletGateKey(identity)).toBe(viaShared);
  });

  it("rejects a malformed tree sha rather than hashing it anyway", () => {
    expect(() => deriveGauntletGateKey({ ...identity, treeSha: "not-a-sha" })).toThrow();
  });
});

describe("buildGauntletEvidence", () => {
  const base = {
    identity,
    workdir: "/workspace/.builds/b1",
    failedGuards: [] as string[],
    output: "OK — 67 guards clean",
    durationMs: 71_000,
    completedAt: new Date("2026-09-12T04:00:00.000Z"),
  };

  it("states what it does NOT cover", () => {
    // A reader assuming a gate record means "fully verified" would be wrong
    // about this one, and the record is the only place that can say so.
    const evidence = buildGauntletEvidence({ ...base, passed: true });
    expect(evidence.coverage).toEqual({
      guards: true,
      typecheck: false,
      unitTests: false,
      productionBuild: false,
      image: false,
    });
    expect(evidence.tier).toBe(IN_PLATFORM_PREFLIGHT_GATE_KIND);
  });

  it("carries the tree it checked and the derived key", () => {
    const evidence = buildGauntletEvidence({ ...base, passed: true });
    expect(evidence.treeSha).toBe(TREE);
    expect(evidence.gateKey).toBe(deriveGauntletGateKey(identity));
  });

  it("does not claim a pass when guards failed", () => {
    const evidence = buildGauntletEvidence({ ...base, passed: false, failedGuards: ["Module Size Guard"] });
    expect(evidence.passed).toBe(false);
    expect(evidence.gatePassed).toBe(false);
    expect(evidence.failedGuards).toEqual(["Module Size Guard"]);
  });
});

describe("summarizeGauntlet", () => {
  it("says the tier out loud on a pass", () => {
    const summary = summarizeGauntlet({ passed: true, failedGuards: [], treeSha: TREE });
    expect(summary).toContain("guards only");
    expect(summary).toContain("no build or image");
  });

  it("names the failing guards and counts the rest", () => {
    const summary = summarizeGauntlet({
      passed: false,
      treeSha: TREE,
      failedGuards: ["A", "B", "C", "D", "E"],
    });
    expect(summary).toContain("5 guard(s)");
    expect(summary).toContain("A, B, C");
    expect(summary).toContain("+2 more");
  });
});

describe("toolchainFingerprintFrom", () => {
  it("produces a 64-hex digest the gate identity will accept", () => {
    expect(toolchainFingerprintFrom({ node: "v24.19.0", pnpm: "9" })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("distinguishes different toolchains", () => {
    expect(toolchainFingerprintFrom({ node: "v24" })).not.toBe(toolchainFingerprintFrom({ node: "v22" }));
  });
});
