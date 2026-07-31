import { describe, it, expect } from "vitest";
import type { ReviewResult } from "@/lib/feature-build-types";
import {
  applyFindingVerdicts,
  verifyReviewFindings,
  parseVerifierResponse,
  buildFindingVerifierPrompt,
  UNVERIFIED_FINDING_NOTE,
  type FindingVerdict,
} from "./verified-finding-review";

function review(issues: ReviewResult["issues"], decision: "pass" | "fail" = "fail"): ReviewResult {
  return { decision, issues, summary: "test" };
}

const crit = (description: string): ReviewResult["issues"][number] => ({ severity: "critical", description });
const imp = (description: string): ReviewResult["issues"][number] => ({ severity: "important", description });

describe("applyFindingVerdicts (pure)", () => {
  it("downgrades a refuted critical to advisory minor and flips fail→pass", () => {
    const r = review([crit("null deref on line 5")]);
    const out = applyFindingVerdicts(r, [{ index: 0, verified: false, rationale: "cannot reproduce" }]);
    expect(out.decision).toBe("pass");
    expect(out.issues[0].severity).toBe("minor");
    expect(out.issues[0].description).toContain(UNVERIFIED_FINDING_NOTE);
  });

  it("keeps a verified critical blocking (still fail)", () => {
    const r = review([crit("real SQL injection")]);
    const out = applyFindingVerdicts(r, [{ index: 0, verified: true, rationale: "reproduced" }]);
    expect(out.decision).toBe("fail");
    expect(out.issues[0].severity).toBe("critical");
  });

  it("fails closed: a critical with NO verdict stays blocking", () => {
    const r = review([crit("verifier never ran for this one")]);
    const out = applyFindingVerdicts(r, []);
    expect(out.decision).toBe("fail");
    expect(out.issues[0].severity).toBe("critical");
  });

  it("only passes when EVERY remaining critical is refuted", () => {
    const r = review([crit("A refuted"), crit("B verified")]);
    const out = applyFindingVerdicts(r, [
      { index: 0, verified: false, rationale: "" },
      { index: 1, verified: true, rationale: "" },
    ]);
    expect(out.decision).toBe("fail");
    expect(out.issues[0].severity).toBe("minor");
    expect(out.issues[1].severity).toBe("critical");
  });

  it("never touches important/minor findings", () => {
    const r = review([imp("design gap")], "pass");
    const out = applyFindingVerdicts(r, [{ index: 0, verified: false, rationale: "" }]);
    expect(out).toEqual(r);
  });

  it("is a no-op when there are no refutations", () => {
    const r = review([crit("x")]);
    expect(applyFindingVerdicts(r, [{ index: 0, verified: true, rationale: "" }])).toBe(r);
    expect(applyFindingVerdicts(r, [])).toBe(r);
  });
});

describe("parseVerifierResponse", () => {
  it("parses a clean refutation", () => {
    expect(parseVerifierResponse('{"verified": false, "rationale": "no such call"}')).toEqual({
      verified: false,
      rationale: "no such call",
    });
  });
  it("parses inside prose/fences", () => {
    expect(parseVerifierResponse('Sure:\n```json\n{"verified": true, "rationale": "line 5"}\n```').verified).toBe(true);
  });
  it("fails closed to verified=true on unparseable output", () => {
    expect(parseVerifierResponse("garbage, no json").verified).toBe(true);
  });
  it("treats a missing verified field as verified (fail-closed)", () => {
    expect(parseVerifierResponse('{"rationale": "hmm"}').verified).toBe(true);
  });
});

describe("buildFindingVerifierPrompt", () => {
  it("includes the finding, its location, and the artifact, and demands JSON", () => {
    const p = buildFindingVerifierPrompt(
      { severity: "critical", description: "leaks token", location: "auth.ts:12" },
      "const x = 1;",
    );
    expect(p).toContain("leaks token");
    expect(p).toContain("auth.ts:12");
    expect(p).toContain("const x = 1;");
    expect(p).toContain("REFUTE");
    expect(p).toContain('{"verified"');
  });

  it("accepts a typed code-change artifact without changing legacy plan text", () => {
    const finding = { severity: "critical" as const, description: "leaks token" };
    const legacy = buildFindingVerifierPrompt(finding, "plan text");
    const code = buildFindingVerifierPrompt(finding, {
      kind: "code-change",
      content: "const token = expose();",
    });

    expect(legacy).toContain("ARTIFACT UNDER REVIEW:\nplan text");
    expect(code).toContain("CODE CHANGE UNDER REVIEW:\nconst token = expose();");
  });
});

describe("verifyReviewFindings (injected dispatch)", () => {
  it("returns unchanged review + empty verdicts when there are no criticals", async () => {
    const r = review([imp("x")], "pass");
    let calls = 0;
    const out = await verifyReviewFindings(r, "artifact", { dispatch: async () => { calls++; return ""; } });
    expect(out.review).toBe(r);
    expect(out.verdicts).toEqual([]);
    expect(calls).toBe(0);
  });

  it("downgrades the critical the verifier refutes", async () => {
    const r = review([crit("phantom bug")]);
    const out = await verifyReviewFindings(r, "artifact", {
      dispatch: async () => '{"verified": false, "rationale": "not present"}',
    });
    expect(out.review.decision).toBe("pass");
    expect(out.review.issues[0].severity).toBe("minor");
    expect(out.verdicts).toEqual([{ index: 0, verified: false, rationale: "not present" }]);
  });

  it("keeps blocking when the verifier reproduces the finding", async () => {
    const r = review([crit("real bug")]);
    const out = await verifyReviewFindings(r, "artifact", {
      dispatch: async () => '{"verified": true, "rationale": "reproduced at line 3"}',
    });
    expect(out.review.decision).toBe("fail");
  });

  it("fails closed when the verifier dispatch throws (finding stays blocking)", async () => {
    const r = review([crit("bug")]);
    const out = await verifyReviewFindings(r, "artifact", {
      dispatch: async () => { throw new Error("inference down"); },
    });
    expect(out.review.decision).toBe("fail");
    expect(out.review.issues[0].severity).toBe("critical");
    expect(out.verdicts).toEqual([]);
  });

  it("caps the number of verified findings", async () => {
    const many = review(Array.from({ length: 10 }, (_, i) => crit(`bug ${i}`)));
    let calls = 0;
    await verifyReviewFindings(many, "artifact", {
      maxFindings: 3,
      dispatch: async () => { calls++; return '{"verified": true, "rationale": ""}'; },
    });
    expect(calls).toBe(3);
  });
});
