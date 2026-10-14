import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { diffInitiativeScopeManifests, parseInitiativeScopeManifest } from "./baseline-manifest";
import { renderBuildDesignText } from "./render-build-design-text";
import { renderMarkdown } from "../../shared/markdown";

const digest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const scope = (row = "| AC-1 | OBJ-1 | Keep all source text. |") => [
  "**OBJ-1:** Preserve the source.", "", "| ID | Objectives | Criterion |", "| --- | --- | --- |", row,
].join("\n");

describe("lossless governed scope", () => {
  it.each([
    "Preserve A | B without truncation",
    String.raw`Keep C:\source\file and A \| B`,
    "Keep a trailing slash\\",
    "Keep species | status | days waiting.",
  ])("round trips the complete structured criterion: %s", (criterion) => {
    const text = renderBuildDesignText({ problemStatement: "Preserve the source.", acceptanceCriteria: [criterion] })!;
    const parsed = parseInitiativeScopeManifest(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.acceptance[0]!.statementDigest).toBe(digest(criterion));
    expect(renderMarkdown(text)).toContain(criterion);
  });

  it("detects a semantic change after a literal pipe", () => {
    const manifest = (suffix: string) => parseInitiativeScopeManifest(renderBuildDesignText({
      problemStatement: "Preserve the source.", acceptanceCriteria: [`Preserve A | ${suffix}`],
    })!);
    const before = manifest("B"), after = manifest("C");
    if (!before.ok || !after.ok) throw new Error("fixtures must parse");
    expect(diffInitiativeScopeManifests(before, after).removedOrChangedAcceptanceIds).toEqual(["AC-1"]);
    expect(before.artifactDigest).not.toBe(after.artifactDigest);
  });

  it("preserves the objective, including pipes, and normalizes multiline structured statements", () => {
    const parsed = parseInitiativeScopeManifest(renderBuildDesignText({
      problemStatement: "Keep A | B.\nKeep the source.", acceptanceCriteria: ["Keep both\nparts | intact."],
    })!);
    expect(parsed).toMatchObject({ ok: true, objectives: [{ statementDigest: digest("Keep A | B. Keep the source.") }],
      acceptance: [{ statementDigest: digest("Keep both parts | intact.") }] });
  });

  it("reads escaped pipes in external Markdown without changing the raw artifact digest", () => {
    const text = scope(String.raw`| AC-1 | OBJ-1 | Keep A \| B. |`);
    expect(parseInitiativeScopeManifest(text)).toMatchObject({ ok: true, artifactDigest: digest(text),
      acceptance: [{ statementDigest: digest("Keep A | B.") }] });
  });

  it("retains a declared fourth evidence column without including it in the statement", () => {
    const text = scope("| AC-1 | OBJ-1 | Keep all source text. | regression test |").replace("| Criterion |", "| Criterion | Evidence |").replace("| --- | --- | --- |", "| --- | --- | --- | --- |");
    expect(parseInitiativeScopeManifest(text)).toMatchObject({ ok: true,
      acceptance: [{ artifactAnchor: "line:5", statementDigest: digest("Keep all source text.") }] });
  });

  it.each([
    ["unescaped pipe", "| AC-1 | OBJ-1 | Keep A | B. |"],
    ["missing closing delimiter", "| AC-1 | OBJ-1 | Keep source."],
    ["missing cell", "| AC-1 | OBJ-1 |"],
    ["lowercase acceptance id", "| AC-invalid | OBJ-1 | Keep source. |"],
    ["malformed objective link", "| AC-1 | OBJ-invalid | Keep source. |"],
    ["duplicate objective link", "| AC-1 | OBJ-1, OBJ-1 | Keep source. |"],
  ])("rejects %s with a source location", (_reason, row) => {
    const result = parseInitiativeScopeManifest(scope(row));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("line 5") });
  });

  it.each(["```", "~~~~"])("does not approve fenced examples (%s)", (fence) => {
    const text = `${fence}markdown\n${scope()}\n${fence}\n\nOrdinary prose.`;
    expect(parseInitiativeScopeManifest(text)).toMatchObject({ ok: false });
    const withRealScope = `${text}\n\n${scope()}`;
    const result = parseInitiativeScopeManifest(withRealScope);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.objectives).toHaveLength(1);
    expect(result.acceptance).toHaveLength(1);
  });

  it("does not approve indented code examples", () => {
    expect(parseInitiativeScopeManifest(scope().split("\n").map(line => `    ${line}`).join("\n")))
      .toMatchObject({ ok: false });
  });

  it("rejects a malformed marked objective rather than silently omitting it", () => {
    expect(parseInitiativeScopeManifest(`${scope()}\n\n**OBJ-invalid:** Lost scope.`))
      .toMatchObject({ ok: false, error: expect.stringContaining("line 7") });
  });

  it("does not treat an AC-ID column heading as an acceptance statement", () => {
    expect(parseInitiativeScopeManifest(scope().replace("| ID |", "| AC-ID |"))).toMatchObject({ ok: true });
  });

  it.each([
    "| AC-REPAIR-1: reconcile successful discovery | discover → persist | backend tests |",
    "| Reference interpreter | interpreter.ts | Reuse existing rules |\n| AC-INTERPRETER harness | parity.test.ts | Extend parity |",
  ])("ignores incidental AC references in ordinary tables", rows => {
    const text = `${scope()}\n\n| Existing work | File or flow | Verification |\n| --- | --- | --- |\n${rows}`;
    const result = parseInitiativeScopeManifest(text);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.acceptance).toHaveLength(1);
    expect(result.acceptance[0]!.acceptanceId).toBe("AC-1");
  });

  it("includes a wrapped objective's complete Markdown paragraph", () => {
    expect(parseInitiativeScopeManifest(scope().replace("Preserve the source.", "Preserve the source.\nIncluding the remainder.")))
      .toMatchObject({ ok: true, objectives: [{ statementDigest: digest("Preserve the source. Including the remainder.") }] });
  });

  it("retains unambiguous legacy three-cell rows without a table header", () => {
    const text = "**OBJ-1:** Preserve the source.\n| AC-1 | OBJ-1 | Keep all source text. |";
    expect(parseInitiativeScopeManifest(text)).toMatchObject({ ok: true,
      objectives: [{ statementDigest: digest("Preserve the source.") }],
      acceptance: [{ statementDigest: digest("Keep all source text.") }] });
  });

  it("rejects a wrapped acceptance statement instead of dropping its continuation", () => {
    expect(parseInitiativeScopeManifest(`${scope()}\nIncluding the remainder.`))
      .toMatchObject({ ok: false, error: expect.stringContaining("line 6") });
  });
});
