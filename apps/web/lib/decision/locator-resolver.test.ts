// Anti-fabrication regression suite for the repo-backed LocatorResolver
// (BI-8192557E). The threat this guards: a citation that is STRUCTURALLY
// well-formed — it normalizes to a StructuredLocator and passes admissibility —
// but is FABRICATED. A plausible filePath+line that does not exist, or a real
// file that never contained the claimed excerpt, must degrade the affected
// dimension rather than certify it.
//
// Written before the resolver existed (dpf-tdd): admissibility is not truth.

import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRepoLocatorResolver } from "./locator-resolver";
import { reverifyCitations, type RecordedCitation } from "./evidence-reverifier";

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dpf-locator-"));
  await mkdir(join(root, "apps", "web", "lib"), { recursive: true });
  await writeFile(
    join(root, "apps", "web", "lib", "real.ts"),
    ["export function real() {", "  return \"grounded value\";", "}", ""].join("\n"),
    "utf8",
  );
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "docs", "spec.md"), "# Spec\n\nThe gate is fail-closed.\n", "utf8");
  return root;
}

function citation(over: Partial<RecordedCitation> & Pick<RecordedCitation, "locator">): RecordedCitation {
  return {
    optionId: over.optionId ?? "opt-a",
    dimensionKey: over.dimensionKey ?? "evidence_density",
    recordedExcerpt: over.recordedExcerpt ?? null,
    locator: over.locator,
  };
}

describe("createRepoLocatorResolver — fabrication resistance", () => {
  it("DEGRADES a well-formed citation whose file does not exist", async () => {
    const root = await fixtureRepo();
    const resolve = createRepoLocatorResolver({ repoRoot: root });

    // Plausible shape, plausible path, entirely invented.
    const report = await reverifyCitations(
      [citation({ locator: { sourceType: "code", filePath: "apps/web/lib/totally-invented.ts", line: 42 } })],
      resolve,
    );

    expect(report.allConfirmed).toBe(false);
    expect(report.unresolved).toBe(1);
    expect(report.degrade).toEqual([{ optionId: "opt-a", dimensionKey: "evidence_density" }]);
  });

  it("DEGRADES a real file that does not contain the claimed excerpt", async () => {
    const root = await fixtureRepo();
    const resolve = createRepoLocatorResolver({ repoRoot: root });

    const report = await reverifyCitations(
      [
        citation({
          locator: { sourceType: "code", filePath: "apps/web/lib/real.ts" },
          recordedExcerpt: "return \"a value that was never there\";",
        }),
      ],
      resolve,
    );

    expect(report.degraded).toBe(1);
    expect(report.allConfirmed).toBe(false);
    expect(report.results[0]?.verdict).toBe("degraded");
    // The live excerpt is reported so a reviewer can see what IS there.
    expect(report.results[0]?.liveExcerpt).toContain("grounded value");
  });

  it("CONFIRMS a citation whose excerpt is genuinely present", async () => {
    const root = await fixtureRepo();
    const resolve = createRepoLocatorResolver({ repoRoot: root });

    const report = await reverifyCitations(
      [
        citation({
          locator: { sourceType: "code", filePath: "apps/web/lib/real.ts" },
          recordedExcerpt: "grounded value",
        }),
        citation({
          optionId: "opt-b",
          locator: { sourceType: "spec", path: "docs/spec.md" },
          recordedExcerpt: "The gate is fail-closed.",
        }),
      ],
      resolve,
    );

    expect(report.confirmed).toBe(2);
    expect(report.allConfirmed).toBe(true);
    expect(report.degrade).toEqual([]);
  });

  it("is whitespace-insensitive so reformatting does not false-degrade", async () => {
    const root = await fixtureRepo();
    const resolve = createRepoLocatorResolver({ repoRoot: root });

    const report = await reverifyCitations(
      [citation({ locator: { sourceType: "code", filePath: "apps/web/lib/real.ts" }, recordedExcerpt: "return    \"grounded    value\";" })],
      resolve,
    );

    expect(report.results[0]?.verdict).toBe("confirmed");
  });

  it("refuses to escape the repo root (path traversal is unresolved, never read)", async () => {
    const root = await fixtureRepo();
    const resolve = createRepoLocatorResolver({ repoRoot: root });

    const report = await reverifyCitations(
      [
        citation({ locator: { sourceType: "code", filePath: "../../../../etc/passwd" } }),
        citation({ optionId: "opt-b", locator: { sourceType: "doc", path: "/etc/hosts" } }),
      ],
      resolve,
    );

    expect(report.unresolved).toBe(2);
    expect(report.results.every((r) => r.liveExcerpt === null)).toBe(true);
  });

  it("treats source types it cannot reach as unresolved, never confirmed", async () => {
    const root = await fixtureRepo();
    const resolve = createRepoLocatorResolver({ repoRoot: root });

    // A repo resolver cannot verify a live DB query or runtime state. Fail-closed:
    // out-of-reach is NOT evidence of truth.
    const report = await reverifyCitations(
      [
        citation({ locator: { sourceType: "db-query", query: "SELECT 1" } as never }),
        citation({ optionId: "opt-b", locator: { sourceType: "runtime-state", ref: "portal" } as never }),
      ],
      resolve,
    );

    expect(report.unresolved).toBe(2);
    expect(report.allConfirmed).toBe(false);
  });

  it("scopes a line-anchored code citation to a window around that line", async () => {
    const root = await fixtureRepo();
    const resolve = createRepoLocatorResolver({ repoRoot: root, lineWindow: 1 });

    // Line 1 is `export function real() {`. With a ±1 window the body is in
    // range, but a claim about something far away is not.
    const near = await reverifyCitations(
      [citation({ locator: { sourceType: "code", filePath: "apps/web/lib/real.ts", line: 1 }, recordedExcerpt: "grounded value" })],
      resolve,
    );
    expect(near.results[0]?.verdict).toBe("confirmed");

    const far = await reverifyCitations(
      [citation({ locator: { sourceType: "code", filePath: "apps/web/lib/real.ts", line: 99 }, recordedExcerpt: "grounded value" })],
      resolve,
    );
    expect(far.results[0]?.verdict).not.toBe("confirmed");
  });
});
