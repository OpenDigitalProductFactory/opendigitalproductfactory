import { describe, expect, it } from "vitest";
import { classifyAltitude, type AltitudeSignals } from "./work-warrant-altitude";

// Every test runs with ZERO corpus — the whole point of the structure-first
// classifier is that it is fully decisive from day-one structural signals.

describe("classifyAltitude — WWMD-hard (architectural, must be right on day one)", () => {
  it("classifies decompose-required design as WWMD, high, no confirm", () => {
    const v = classifyAltitude({ designSize: "decompose-required", effortSize: "large" });
    expect(v.altitude).toBe("WWMD");
    expect(v.confidence).toBe("high");
    expect(v.basis).toBe("structural");
    expect(v.needsOperatorConfirm).toBe(false);
  });

  it("classifies xlarge effort as WWMD", () => {
    expect(classifyAltitude({ effortSize: "xlarge", workType: "feature" }).altitude).toBe("WWMD");
  });

  it("classifies a schema/migration touch as WWMD even at small effort", () => {
    const v = classifyAltitude({ effortSize: "small", workType: "feature", touchesSchema: true, singleLeafSurface: true });
    expect(v.altitude).toBe("WWMD");
    expect(v.reasons.join(" ")).toContain("schema");
  });

  it("classifies routing / core-contract touches as WWMD", () => {
    expect(classifyAltitude({ effortSize: "medium", touchesRouting: true }).altitude).toBe("WWMD");
    expect(classifyAltitude({ effortSize: "medium", touchesCoreContract: true }).altitude).toBe("WWMD");
  });

  it("treats a large refactor as architectural WWMD", () => {
    expect(classifyAltitude({ workType: "refactor", effortSize: "large" }).altitude).toBe("WWMD");
  });
});

describe("classifyAltitude — WSID-hard (task, cheap if slightly wrong)", () => {
  it("classifies a small single-surface feature as WSID, high, no confirm", () => {
    // The FB-041879CD (engine badge) shape: small, functional, one leaf surface.
    const v = classifyAltitude({
      effortSize: "small",
      workType: "feature",
      singleLeafSurface: true,
      touchesSchema: false,
      touchesRouting: false,
      touchesCoreContract: false,
    });
    expect(v.altitude).toBe("WSID");
    expect(v.confidence).toBe("high");
    expect(v.needsOperatorConfirm).toBe(false);
  });

  it("does NOT drop to WSID when a small item touches a core contract", () => {
    const v = classifyAltitude({ effortSize: "small", workType: "feature", singleLeafSurface: true, touchesCoreContract: true });
    expect(v.altitude).toBe("WWMD");
  });

  it("does NOT WSID a small item that lacks single-leaf confinement (ambiguous → confirm)", () => {
    const v = classifyAltitude({ effortSize: "small", workType: "feature", singleLeafSurface: false });
    expect(v.altitude).not.toBe("WSID");
    expect(v.needsOperatorConfirm).toBe(true);
  });
});

describe("classifyAltitude — WWWD (business/vertical, corpus thin → confirm + seed)", () => {
  it("classifies a vertical/jurisdiction obligation as WWWD, medium, confirm", () => {
    const v = classifyAltitude({ effortSize: "medium", workType: "feature", archetypeObligation: true });
    expect(v.altitude).toBe("WWWD");
    expect(v.confidence).toBe("medium");
    expect(v.needsOperatorConfirm).toBe(true); // the confirmation seeds the WWWD corpus
  });

  it("classifies a customer/business capability surface as WWWD", () => {
    expect(classifyAltitude({ effortSize: "small", workType: "feature", customerBusinessSurface: true }).altitude).toBe("WWWD");
  });
});

describe("classifyAltitude — ambiguous defaults to the safer higher altitude + confirm", () => {
  it("leans WWMD for large/medium ambiguous work", () => {
    const v = classifyAltitude({ effortSize: "large", workType: "chore" });
    expect(v.altitude).toBe("WWMD");
    expect(v.confidence).toBe("low");
    expect(v.needsOperatorConfirm).toBe(true);
  });

  it("sits at WWWD (never silent WSID) for small/unknown ambiguous work", () => {
    const v = classifyAltitude({ workType: "chore" });
    expect(v.altitude).toBe("WWWD");
    expect(v.needsOperatorConfirm).toBe(true);
  });

  it("is fully decisive with an empty signal set (no corpus, no fields) — never throws, always confirms", () => {
    const v = classifyAltitude({});
    expect(["WSID", "WWWD", "WWMD"]).toContain(v.altitude);
    expect(v.basis).toBe("structural");
    expect(v.needsOperatorConfirm).toBe(true);
  });
});

describe("classifyAltitude — determinism (same signals → same verdict, corpus-free)", () => {
  it("is a pure function", () => {
    const s: AltitudeSignals = { effortSize: "small", workType: "bug", singleLeafSurface: true };
    expect(classifyAltitude(s)).toEqual(classifyAltitude(s));
  });
});
