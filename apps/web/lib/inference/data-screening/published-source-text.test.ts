// BI-3D5AC133: text the public forge already serves is not new disclosure.
//
// Owner report 2026-11-19: semantic reviews of public-repository PRs were
// screened restricted/local-only by text already published in their own diff
// (#7152: two vocabulary hits in renewed baselines; #7154: fake test tokens),
// so no cloud reviewer could take them and Failure Readiness never passed.
//
// A trusted caller may name exact spans it read from a proven-public repository
// at commits the public forge serves (`publishedText`). Those spans cannot
// raise the payload. Everything the author wrote around them is screened
// exactly as before.
import { describe, expect, it } from "vitest";
import { classifyInferencePayload } from "./classify-payload";
import { screenInferencePayload } from "./screen-inference-payload";
import type { SourceCodeProvenance } from "./types";

const REPO = "OpenDigitalProductFactory/opendigitalproductfactory";

// The shapes that tripped #7154 and #7152, as they appear in a diff.
const FIXTURE_TOKEN_DIFF = [
  "diff --git a/apps/web/lib/executor-drivers/claude/claude-driver.test.ts b/apps/web/lib/executor-drivers/claude/claude-driver.test.ts",
  "+    mockGetProviderBearerToken.mockResolvedValue({ token: \"sk-ant-oat01-x\" });",
  "+    const driver = createClaudeDriver({ auth: async () => ({ mode: \"apikey\", apiKey: \"sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789\" }) });",
].join("\n");
const VOCABULARY_DIFF = [
  "diff --git a/scripts/module-size-baseline.txt b/scripts/module-size-baseline.txt",
  "+apps/web/lib/hr/employee-records-sync.ts 812",
  "+apps/web/lib/finance/payment-reconciliation.ts 845 invoice payment ledger",
  "+apps/web/lib/hr/employee personnel file employment record export 790",
].join("\n");

function classify(content: string, provenance?: SourceCodeProvenance) {
  return classifyInferencePayload({
    messages: [{ role: "user", content }],
    systemPrompt: "You review committed changes.",
    ...(provenance ? { sourceCodeProvenance: provenance } : {}),
  });
}

function reviewPrompt(diff: string, authored = "Tests pass; 5,495 tests in 449 files.") {
  return `CHANGE: one Claude driver\n\nCODE CHANGES:\n${diff}\n\nVERIFICATION EVIDENCE:\n${authored}`;
}

describe("published source text does not raise the payload (BI-3D5AC133)", () => {
  for (const [name, diff] of [["fixture tokens (#7154)", FIXTURE_TOKEN_DIFF], ["baseline vocabulary (#7152)", VOCABULARY_DIFF]] as const) {
    it(`an unpublished diff with ${name} is still restricted`, () => {
      expect(classify(reviewPrompt(diff), { repository: REPO, visibility: "public" }).overallSensitivity).toBe("restricted");
    });

    it(`the same diff, published by the public repository, is not restricted: ${name}`, () => {
      const result = classify(reviewPrompt(diff), { repository: REPO, visibility: "public", publishedText: [diff] });
      expect(result.overallSensitivity).not.toBe("restricted");
      expect(result.overallSensitivity).not.toBe("confidential");
      // The matches are kept on the record; they only stop counting as evidence.
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.dataEvidencedClasses).not.toContain("secrets-credentials");
      expect(result.dataEvidencedClasses).not.toContain("employee-records");
    });
  }

  it("a secret in the author's own text is still restricted", () => {
    const authored = "Smoke test used ANTHROPIC_API_KEY=sk-ant-api03-ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210 against prod.";
    const result = classify(reviewPrompt(FIXTURE_TOKEN_DIFF, authored),
      { repository: REPO, visibility: "public", publishedText: [FIXTURE_TOKEN_DIFF] });
    expect(result.overallSensitivity).toBe("restricted");
  });

  it("gives no exemption for a private or unproven repository", () => {
    for (const visibility of ["private", "unknown"] as const) {
      const result = classify(reviewPrompt(FIXTURE_TOKEN_DIFF),
        { repository: REPO, visibility, publishedText: [FIXTURE_TOKEN_DIFF] });
      expect(result.overallSensitivity).toBe("restricted");
    }
  });

  it("exempts only the exact span: a span that is not in the payload exempts nothing", () => {
    const result = classify(reviewPrompt(FIXTURE_TOKEN_DIFF),
      { repository: REPO, visibility: "public", publishedText: ["some other diff"] });
    expect(result.overallSensitivity).toBe("restricted");
  });

  it("routes the review as a public room does: cloud-eligible, not local-only", () => {
    for (const diff of [FIXTURE_TOKEN_DIFF, VOCABULARY_DIFF]) {
      const screen = (publishedText?: string[]) => screenInferencePayload({
        messages: [{ role: "user", content: reviewPrompt(diff) }],
        systemPrompt: "You review committed changes.",
        taskType: "build-review",
        routeContext: { sensitivity: "development" },
        sourceCodeProvenance: { repository: REPO, visibility: "public", ...(publishedText ? { publishedText } : {}) },
      }).routeContext;
      expect(screen().residencyPolicy).toBe("local_only");
      const published = screen([diff]);
      expect(published.residencyPolicy).not.toBe("local_only");
      expect(["public", "internal"]).toContain(published.sensitivity);
    }
  });
});
