// BI-A0521CB0 — Build Studio's finalize stage. Live, FB-D671B016 (2026-09-25):
// correct code (57/57 tests, clean typecheck) stopped in review because its
// commits carried no decision trailers (Docs-Impact, Seed-Fit,
// Convergence-Impact) and nothing wrote the failure analysis review requires.
import { describe, expect, it, vi } from "vitest";

import { validateFailureAnalysis } from "@/lib/change-review/failure-analysis";
import {
  authorFailureAnalysis,
  authorGateDecisions,
  composeFailureAnalysis,
  type FailureAnalysisNarrative,
  parseTrailerLines,
  trailerKeysForFailedGuards,
} from "./finalize-stage";

describe("trailerKeysForFailedGuards", () => {
  it("names the decision trailer each failed guard needs", () => {
    expect(trailerKeysForFailedGuards(["Docs Impact Gate", "Seed Contribution Fit Gate", "Convergence-Impact Gate"])).toEqual([
      "Docs-Impact-Decision", "Seed-Fit-Decision", "Convergence-Impact-Decision",
    ]);
  });
  it("refuses when any failure is not a trailer decision, so real defects are never papered over", () => {
    expect(trailerKeysForFailedGuards(["Docs Impact Gate", "Repo Guard Loop"])).toBeNull();
    expect(trailerKeysForFailedGuards([])).toBeNull();
  });
});

describe("parseTrailerLines", () => {
  const keys = ["Docs-Impact-Decision", "Seed-Fit-Decision"];
  it("keeps exactly one well-formed line per required key and drops everything else", () => {
    const text = "Here you go:\nDocs-Impact-Decision: internal seed validation, no user-visible change\nSeed-Fit-Decision: global-default\nSigned-off-by: x <y>\n";
    expect(parseTrailerLines(text, keys)).toEqual({
      kind: "ok",
      lines: ["Docs-Impact-Decision: internal seed validation, no user-visible change", "Seed-Fit-Decision: global-default"],
    });
  });
  it("reports a missing or empty key instead of guessing one", () => {
    expect(parseTrailerLines("Docs-Impact-Decision: fine reason here", keys)).toEqual({ kind: "missing", missing: ["Seed-Fit-Decision"] });
    expect(parseTrailerLines("Docs-Impact-Decision:\nSeed-Fit-Decision: global-default", keys)).toEqual({ kind: "missing", missing: ["Docs-Impact-Decision"] });
  });
});

describe("authorGateDecisions", () => {
  it("asks once, retries once naming what was missing, then gives up honestly", async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce("Docs-Impact-Decision: internal seed validation only")
      .mockResolvedValueOnce("Docs-Impact-Decision: internal seed validation only\nSeed-Fit-Decision: global-default");
    const out = await authorGateDecisions({ llm, keys: ["Docs-Impact-Decision", "Seed-Fit-Decision"], guardOutput: "[seed-fit-gate] FAILED", diffSummary: "M seed.ts" });
    expect(out).toEqual({ kind: "ok", lines: ["Docs-Impact-Decision: internal seed validation only", "Seed-Fit-Decision: global-default"] });
    expect(llm).toHaveBeenCalledTimes(2);
    expect(llm.mock.calls[1][0]).toContain("Seed-Fit-Decision");

    const never = vi.fn().mockResolvedValue("I cannot decide.");
    expect(await authorGateDecisions({ llm: never, keys: ["Seed-Fit-Decision"], guardOutput: "", diffSummary: "" }))
      .toEqual({ kind: "missing", missing: ["Seed-Fit-Decision"] });
    expect(never).toHaveBeenCalledTimes(2);
  });
});

const identity = { capsuleId: "WC-1E7C7DC8", headTreeHash: "a".repeat(40), diffDigest: "b".repeat(64) };
const evidence = [
  { id: "ev-gauntlet", capsuleId: identity.capsuleId, headTreeHash: identity.headTreeHash, diffDigest: identity.diffDigest, status: "passed", expected: "node scripts/pregate-preflight.mjs", observed: "all guards clean", completedAt: "2026-09-25T03:00:00Z" },
  { id: "ev-tests", capsuleId: identity.capsuleId, headTreeHash: identity.headTreeHash, diffDigest: identity.diffDigest, status: "passed", expected: "vitest run seed-wiki-kernel.test.ts", observed: "57 passed", completedAt: "2026-09-25T03:01:00Z" },
];
const narrative: FailureAnalysisNarrative = {
  designAnalysis: "Out-of-enum principleTier values silently mis-rank kernel principles for every decision.",
  scope: "Seed-time validation of kernel principle frontmatter and three corrected pages.",
  affectedPeople: "Coworkers and owners whose decisions consult kernel principles.",
  invariants: "Every seeded principle carries a principleTier from the enum.",
  boundaries: "Seeding rejects bad frontmatter; runtime readers are unchanged.",
  noEliminationRationale: "The change detects and refuses bad input rather than removing its source.",
  scenarios: [{
    key: "bad-tier-seeded", trigger: "A page is authored with a principleTier outside the enum",
    effect: "Decisions weigh the principle wrongly without anyone noticing",
    severity: "medium", exposure: "Any install that seeds the kernel from the repository",
    prevention: "Seed validation rejects the unknown tier", containment: "The seed run fails before writing the page",
    detection: "The seed error names the page and the value", recovery: "Correct the frontmatter and reseed",
    residualRisk: { owner: "platform-architecture", disposition: "mitigated", rationale: "Validation and the corrected pages remove the known cases" },
  }],
};

describe("composeFailureAnalysis", () => {
  it("builds an analysis the platform's own validator accepts, with identity and evidence owned by code", () => {
    const fa = composeFailureAnalysis({ identity, designReference: `featureBuild/FB-D671B016/designDoc@${"c".repeat(40)}`, evidenceIds: ["ev-gauntlet", "ev-tests"], narrative });
    expect(fa.scenarios[0]!.evidenceIds).toEqual(["ev-gauntlet", "ev-tests"]);
    expect(validateFailureAnalysis(fa, identity, evidence)).toMatchObject({ valid: true });
  });
});

describe("authorFailureAnalysis", () => {
  it("parses the narrative, composes, validates, and retries once with the validator's reasons", async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce("not json at all")
      .mockResolvedValueOnce("```json\n" + JSON.stringify(narrative) + "\n```");
    const out = await authorFailureAnalysis({
      llm, identity, designReference: `featureBuild/FB-D671B016/designDoc@${"c".repeat(40)}`,
      evidence, diffSummary: "M packages/db/src/seed-wiki-kernel.ts",
    });
    expect(out.kind).toBe("ok");
    expect(llm).toHaveBeenCalledTimes(2);
    if (out.kind === "ok") expect(validateFailureAnalysis(out.failureAnalysis, identity, evidence).valid).toBe(true);
  });
});
