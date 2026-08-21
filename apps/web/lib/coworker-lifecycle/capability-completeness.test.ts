import { describe, expect, it } from "vitest";
import {
  CAPABILITY_PLANES,
  agentsBelowCeiling,
  capabilityCompletenessFor,
  capabilityCompletenessReport,
  orderedPlanes,
  planeContract,
} from "./capability-completeness";

describe("capability completeness (derived artifact accessor)", () => {
  it("exposes a v2 report whose agent count matches its own summary", () => {
    const r = capabilityCompletenessReport();
    expect(r.schemaVersion).toBe("capability-completeness.v2");
    expect(r.agents.length).toBe(r.summary.agents);
  });

  it("measures the FULL inventory, not just the workforce roster", () => {
    const r = capabilityCompletenessReport();
    // The roster is one namespace of three; measuring only it under-counts badly.
    expect(r.summary.agents).toBeGreaterThan(r.summary.sources.workforceRoster);
    expect(r.summary.agents).toBeGreaterThanOrEqual(r.summary.sources.canonicalRegistry);
  });

  it("joins namespaces through the canonical bridge instead of double-counting", () => {
    // `coo` (roster slug) and `coo-orchestrator` (registry agent_name) are ONE
    // identity. A handle-only join would report them as two.
    const viaSlug = capabilityCompletenessFor("coo");
    const viaRegistryName = capabilityCompletenessFor("coo-orchestrator");
    expect(viaSlug).not.toBeNull();
    expect(viaRegistryName?.key).toBe(viaSlug?.key);
  });

  it("resolves an agent by canonical id as well as by handle", () => {
    const byHandle = capabilityCompletenessFor("coo");
    expect(capabilityCompletenessFor(byHandle!.key)?.key).toBe(byHandle!.key);
  });

  it("returns null for an identity in no namespace", () => {
    expect(capabilityCompletenessFor("external-coding-agent")).toBeNull();
  });

  it("reports every one of the seven planes, present or not", () => {
    const a = capabilityCompletenessFor("compliance-officer");
    expect(a).not.toBeNull();
    expect(orderedPlanes(a!).map((p) => p.plane)).toEqual([...CAPABILITY_PLANES]);
  });

  it("grades each plane on the 0-3 ladder, never above its ceiling", () => {
    for (const a of capabilityCompletenessReport().agents) {
      for (const plane of CAPABILITY_PLANES) {
        const state = a.planes[plane];
        expect(state.level).toBeGreaterThanOrEqual(0);
        expect(state.level).toBeLessThanOrEqual(3);
        expect(state.ceiling).toBe(planeContract(plane).ceiling);
        expect(state.atCeiling).toBe(state.level >= state.ceiling);
      }
    }
  });

  it("distinguishes attainable from absolute so a platform cap is not read as an agent defect", () => {
    const r = capabilityCompletenessReport();
    // Shape has no substrate at all, so no agent can ever reach 100% absolute.
    expect(planeContract("shape").ceiling).toBe(0);
    for (const a of r.agents) {
      expect(a.score.attainablePct).toBeGreaterThanOrEqual(a.score.absolutePct);
    }
  });

  it("keeps the governance coworker able to reach the governance kernel", () => {
    // Inverted from its original form, deliberately. This test first asserted
    // that compliance-officer COULD NOT reach evaluate_profession_decision or
    // principle_decide — the sharpest finding of the capability measure. The
    // grant landed (BI-728FD7F2), so the expectation flips rather than being
    // deleted: it now guards the fix instead of documenting the defect.
    const a = capabilityCompletenessFor("compliance-officer")!;
    expect(a.planes.governance.level).toBeGreaterThanOrEqual(2);
    expect(a.planes.corpus.level).toBe(3);
  });

  it("names the missing grant when a plane fails on reachability", () => {
    // The mechanism itself still matters: an agent whose corpus exists but whose
    // retrieval tool is unreachable must say WHICH grant is missing, or the gap
    // is undiagnosable from the report alone.
    const gapped = capabilityCompletenessReport().agents.filter(
      (a) => a.planes.corpus.level === 2,
    );
    expect(gapped.length).toBeGreaterThan(0);
    for (const a of gapped) {
      expect(a.planes.corpus.missingGrants?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("no roster-present coworker is locked out of the kernel", () => {
    // The recurring defect this measure exists to catch: coworkers have been
    // authored without registry_read more than once. A roster coworker that
    // cannot consult the kernel is a governance hole, not a scope choice.
    const rosterPresent = capabilityCompletenessReport().agents.filter((a) =>
      ["active-roster", "roster-only", "defined-roster"].includes(a.identityClass),
    );
    const lockedOut = rosterPresent.filter((a) => a.planes.governance.level < 2);
    expect(lockedOut.map((a) => a.key)).toEqual([]);
  });

  it("counts gaps consistently with the ceilings", () => {
    for (const a of capabilityCompletenessReport().agents) {
      const expected = CAPABILITY_PLANES.filter((p) => a.planes[p].level < a.planes[p].ceiling);
      expect(a.gaps.map((g) => g.plane)).toEqual(expected);
    }
  });

  it("finds agents below a named plane's ceiling", () => {
    const below = agentsBelowCeiling("cadence");
    expect(below.length).toBeGreaterThan(0);
    expect(below.every((a) => a.planes.cadence.level < a.planes.cadence.ceiling)).toBe(true);
  });

  it("classifies assignTo failure by the fix each one needs", () => {
    // The three classes need three different fixes, so the report must keep
    // them apart. This asserts the vocabulary and the shape of whatever is
    // present rather than requiring a particular class to exist — the
    // `unbridged` and `unseeded` cases were driven to zero by repointing the
    // eight stranded skills, and a test that demands defects be present would
    // fail as the platform improves.
    const health = capabilityCompletenessReport().orphans.assignToHealth;
    for (const h of health) {
      expect(["unresolved", "unseeded", "unbridged"]).toContain(h.health);
      // Each class must carry what its fix needs to be actionable.
      if (h.health === "unbridged") expect(h.rosterSlug).toBeTruthy();
      if (h.health === "unseeded") expect(h.canonical).toMatch(/^AGT-/);
      expect(h.files.length).toBeGreaterThan(0);
    }
  });

  it("keeps stranded skills at zero", () => {
    // Driven to zero in the change that added the CI ratchet
    // (scripts/check-agent-capability-integrity.mjs). Any regression is new.
    expect(capabilityCompletenessReport().summary.skills.stranded).toBe(0);
  });

  it("lists stranded skills as repo-level orphans, not agent gaps", () => {
    const r = capabilityCompletenessReport();
    expect(r.orphans.strandedSkills.length).toBe(r.summary.skills.stranded);
    for (const sk of r.orphans.strandedSkills) expect(sk.assignTo.length).toBeGreaterThan(0);
  });
});
