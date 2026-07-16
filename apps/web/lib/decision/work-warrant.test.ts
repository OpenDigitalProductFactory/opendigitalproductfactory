import { describe, expect, it } from "vitest";
import { classifyAltitude } from "./work-warrant-altitude";
import { deriveWarrant, type BlastRadius } from "./work-warrant";

// All corpus-free: altitude verdict in → warrant out, deterministic.

describe("deriveWarrant — altitude base mapping", () => {
  it("WSID → autonomous, cheap, collapsed gates, minimal evidence, one-line report", () => {
    const verdict = classifyAltitude({ effortSize: "small", workType: "feature", singleLeafSurface: true });
    const w = deriveWarrant({ verdict });
    expect(w.altitude).toBe("WSID");
    expect(w.lane).toBe("autonomous-bs");
    expect(w.budget.modelTier).toBe("economical");
    expect(w.budget.gateProfile).toBe("collapsed");
    expect(w.evidenceProfile).toBe("minimal");
    expect(w.reportingProfile).toBe("one-line");
  });

  it("WWMD → governed-interactive, strong, full gates, architectural evidence, ledger report", () => {
    const verdict = classifyAltitude({ effortSize: "xlarge" });
    const w = deriveWarrant({ verdict });
    expect(w.altitude).toBe("WWMD");
    expect(w.lane).toBe("governed-interactive");
    expect(w.budget.modelTier).toBe("strong");
    expect(w.budget.gateProfile).toBe("full");
    expect(w.evidenceProfile).toBe("architectural");
    expect(w.reportingProfile).toBe("ledger");
  });

  it("WWWD → governed-interactive, standard, business report", () => {
    const verdict = classifyAltitude({ effortSize: "medium", customerBusinessSurface: true });
    const w = deriveWarrant({ verdict });
    expect(w.altitude).toBe("WWWD");
    expect(w.reportingProfile).toBe("business");
    expect(w.budget.gateProfile).toBe("standard");
  });
});

describe("deriveWarrant — blast-radius overlay only ESCALATES (monotonic)", () => {
  const wsid = () => classifyAltitude({ effortSize: "small", workType: "feature", singleLeafSurface: true });

  it("a small WSID change with a large blast radius is pulled off the autonomous lane + confirmed", () => {
    const blastRadius: BlastRadius = { downstreamCount: 40, touchesCoreContract: true, riskLevel: "high" };
    const w = deriveWarrant({ verdict: wsid(), blastRadius });
    expect(w.altitude).toBe("WSID"); // altitude unchanged...
    expect(w.lane).toBe("governed-interactive"); // ...but lane escalated
    expect(w.evidenceProfile).toBe("architectural");
    expect(w.needsOperatorConfirm).toBe(true); // escalation contradicts altitude → confirm
  });

  it("moderate blast radius bumps evidence to standard but keeps the lane", () => {
    const blastRadius: BlastRadius = { downstreamCount: 10, touchesCoreContract: false, riskLevel: "medium" };
    const w = deriveWarrant({ verdict: wsid(), blastRadius });
    expect(w.lane).toBe("autonomous-bs");
    expect(w.evidenceProfile).toBe("standard");
  });

  it("low blast radius leaves a WSID warrant fully hands-off", () => {
    const blastRadius: BlastRadius = { downstreamCount: 1, touchesCoreContract: false, riskLevel: "low" };
    const w = deriveWarrant({ verdict: wsid(), blastRadius });
    expect(w.lane).toBe("autonomous-bs");
    expect(w.evidenceProfile).toBe("minimal");
  });

  it("never RELAXES a WWMD warrant even with a tiny blast radius", () => {
    const verdict = classifyAltitude({ effortSize: "xlarge" });
    const w = deriveWarrant({ verdict, blastRadius: { downstreamCount: 0, touchesCoreContract: false, riskLevel: "low" } });
    expect(w.evidenceProfile).toBe("architectural");
    expect(w.lane).toBe("governed-interactive");
  });
});

describe("deriveWarrant — WWWD context overlay (industry/jurisdiction)", () => {
  it("a jurisdiction obligation raises evidence to compliance and carries context scope", () => {
    const verdict = classifyAltitude({ effortSize: "medium", archetypeObligation: true });
    const w = deriveWarrant({
      verdict,
      context: { industry: "healthcare", jurisdiction: "US-CA", archetype: "clinical" },
    });
    expect(w.evidenceProfile).toBe("compliance");
    expect(w.contextScope).toEqual({ industry: "healthcare", jurisdiction: "US-CA", archetype: "clinical" });
  });

  it("no context leaves evidence at the altitude default and scope null", () => {
    const verdict = classifyAltitude({ effortSize: "small", workType: "feature", singleLeafSurface: true });
    const w = deriveWarrant({ verdict });
    expect(w.evidenceProfile).toBe("minimal");
    expect(w.contextScope).toEqual({ industry: null, jurisdiction: null, archetype: null });
  });
});

describe("deriveWarrant — determinism", () => {
  it("is pure", () => {
    const verdict = classifyAltitude({ effortSize: "medium", customerBusinessSurface: true });
    expect(deriveWarrant({ verdict })).toEqual(deriveWarrant({ verdict }));
  });
});
