import { describe, it, expect } from "vitest";
import {
  buildInstallSovereigntyInput,
  computeInstallCadaReadiness,
  summarizeControlCoverage,
} from "./cada-readiness";

describe("cada-readiness", () => {
  it("maps local-only inference into the no-egress (Level 4) control", () => {
    const on = buildInstallSovereigntyInput({ operatorJurisdiction: "DE", dataInEea: true }, true);
    const off = buildInstallSovereigntyInput({ operatorJurisdiction: "DE", dataInEea: true }, false);
    expect(on.noAiInferenceEgress).toBe(true);
    expect(off.noAiInferenceEgress).toBe(false);
    // DPF structural facts are always set.
    expect(on.supplyChainTransparent).toBe(true);
  });

  it("defaults EU personnel to follow EU data residency", () => {
    expect(buildInstallSovereigntyInput({ operatorJurisdiction: "FR", dataInEea: true }, false).personnelInEea).toBe(true);
    expect(buildInstallSovereigntyInput({ operatorJurisdiction: "FR", dataInEea: false }, false).personnelInEea).toBe(false);
  });

  it("an EU install with local-only inference but no L4 build-out lands at Level 3", () => {
    const r = computeInstallCadaReadiness({ operatorJurisdiction: "DE", dataInEea: true }, true);
    expect(r.assessment.level).toBe(3);
    expect(r.localOnlyInference).toBe(true);
    expect(r.summary).toMatch(/Level 3/);
  });

  it("reaches Level 4 once EU keys/steward + high certification are declared", () => {
    const r = computeInstallCadaReadiness(
      { operatorJurisdiction: "DE", dataInEea: true, euKeysAndSteward: true, euCloudCertified: true },
      true,
    );
    expect(r.assessment.level).toBe(4);
    expect(r.assessment.gaps).toHaveLength(0);
  });

  it("turning local-only OFF drops an otherwise-L4 install to Level 3 (AI egress gap)", () => {
    const r = computeInstallCadaReadiness(
      { operatorJurisdiction: "DE", dataInEea: true, euKeysAndSteward: true, euCloudCertified: true },
      false,
    );
    expect(r.assessment.level).toBe(3);
    expect(r.assessment.gaps.join(" ")).toMatch(/inference|egress/i);
  });

  it("a US-operated install is capped at Level 2 regardless of local-only", () => {
    const r = computeInstallCadaReadiness({ operatorJurisdiction: "US", dataInEea: true }, true);
    expect(r.assessment.level).toBe(2);
    expect(r.assessment.cappedBy).toMatch(/third country/i);
    expect(r.summary).toMatch(/Capped by/);
  });

  it("reports target comparison", () => {
    const r = computeInstallCadaReadiness({ operatorJurisdiction: "DE", dataInEea: true }, true, 4);
    expect(r.meetsTarget).toBe(false);
    expect(r.summary).toMatch(/Below target Level 4/);
    const r2 = computeInstallCadaReadiness({ operatorJurisdiction: "DE", dataInEea: true }, true, 3);
    expect(r2.meetsTarget).toBe(true);
  });

  it("summarizes control coverage, excluding not-applicable from the denominator", () => {
    const empty = summarizeControlCoverage([]);
    expect(empty.total).toBe(0);
    expect(empty.summary).toMatch(/No CADA controls/);

    const cov = summarizeControlCoverage([
      { implementationStatus: "implemented" },
      { implementationStatus: "implemented" },
      { implementationStatus: "in-progress" },
      { implementationStatus: "planned" },
      { implementationStatus: "not-applicable" },
    ]);
    expect(cov.implemented).toBe(2);
    expect(cov.inProgress).toBe(1);
    expect(cov.planned).toBe(1);
    // applicable = 4 (excludes the not-applicable); 2/4 = 50%
    expect(cov.pctImplemented).toBe(50);
  });
});
