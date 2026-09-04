// Probe-conformance registry (BI-927D64C0, mechanism M4).
//
// Environment-probing modules must be tested against the world production
// actually is — partial, stale, absent, empty, plural — not only the healthy
// fixture. This suite does two things:
//
//   1. REGISTRY — a literal list of known probe modules, each mapped to the
//      test file that must carry its degenerate-shape coverage and the markers
//      that prove the coverage is present (kit usage, or an equivalent
//      injected-degraded resolver). Asserted by reading the test file, not by
//      duplicating its tests.
//
//   2. COMPLETENESS — a source-tree walk (fs only, no git) for the
//      availability-probe signature, asserting every match is either
//      enumerated above or carries an explicit reasoned waiver. A NEW probe
//      module fails this test until someone decides where its degenerate
//      coverage lives. The signature is deliberately narrow (calibrated on
//      the real tree, 2026-08-22: three matches) — an over-reporting measure
//      is a defect.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** apps/web — this file lives at apps/web/lib/testing/degenerate-env/. */
const WEB_ROOT = resolve(__dirname, "..", "..", "..");
const LIB_ROOT = join(WEB_ROOT, "lib");

/** Repo-relative paths below are relative to apps/web (posix separators). */
interface ProbeRegistryEntry {
  /** The environment-probing module. */
  module: string;
  /** Which degenerate shapes this probe MUST have at least one test for. */
  shapes: string[];
  /** The test file that carries the coverage. */
  testFile: string;
  /**
   * Literal markers whose presence in `testFile` proves the degenerate cases
   * exist there — kit builder names, degenerate verdicts, or the injected
   * degraded-resolver shape.
   */
  markers: string[];
}

const PROBE_REGISTRY: ProbeRegistryEntry[] = [
  {
    // The source-availability probe from the BI-EE2B243D fix: package.json
    // present said "available" while the tree was unanchored and partial.
    module: "lib/mcp/packs/decision-reverify-pack.ts",
    shapes: ["partial tree (no .git, cited file absent)", "unanchored-but-available root"],
    testFile: "lib/decision/evidence-reverification.test.ts",
    markers: [
      "partialSourceTree", // the shared kit builds the image-synced shape
      "unanchored-source", // the degenerate verdict is asserted, not just reachable
      "UNANCHORED", // the readable-but-revision-unknown SourceAccess fixture
    ],
  },
  {
    // The re-verifier primitive: degradation arrives via an injected
    // LocatorResolver — that counts as the degenerate-environment fixture.
    module: "lib/decision/evidence-reverifier.ts",
    shapes: ["locator resolves to nothing", "resolver throws (fails closed)"],
    testFile: "lib/decision/evidence-reverifier.test.ts",
    markers: [
      "resolved: false", // injected resolver returning a miss
      '"unresolved"', // the miss verdict asserted
      "fails closed", // the throwing-resolver case
    ],
  },
];

/**
 * Modules that match the probe signature but are NOT enumerated, each with the
 * reason the waiver is sound. Keep this list SHORT — a waiver is a decision,
 * not a default.
 */
const PROBE_WAIVERS: Array<{ module: string; reason: string }> = [
  {
    module: "lib/build/codebase-tools.ts",
    reason:
      "getProjectRoot()'s package.json check is a root-locator helper; the environment " +
      "VERDICT built on it (available/anchored) lives in decision-reverify-pack.ts, which is " +
      "enumerated with degenerate coverage. A second registry row here would double-count " +
      "the same probe.",
  },
  {
    module: "lib/actions/platform-dev-config.ts",
    reason:
      "existsSync(.git/MERGE_HEAD) reads a merge-in-progress marker inside a tree already " +
      "known to be a checkout — git-state detail, not a source-availability probe deciding " +
      "whether the environment can be trusted.",
  },
];

/**
 * The availability-probe signature, calibrated against the real probe
 * (decision-reverify-pack.ts): a filesystem existence/stat/read check aimed at
 * the two files that make a directory look like a repo root — `.git` and
 * `package.json`. `[^)\n]*` keeps the match within one call on one line, which
 * is what keeps precision high.
 */
const PROBE_SIGNATURE =
  /existsSync\([^)\n]*\.git|existsSync\([^)\n]*package\.json|statSync\([^)\n]*package\.json|readFileSync\([^)\n]*package\.json/;

function walkTsSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      walkTsSources(abs, out);
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".d.ts")) continue;
    out.push(abs);
  }
  return out;
}

function toWebRelative(abs: string): string {
  return relative(WEB_ROOT, abs).split(sep).join("/");
}

describe("degenerate-environment probe conformance", () => {
  it("every enumerated probe module exists and its test file carries the degenerate cases", () => {
    for (const entry of PROBE_REGISTRY) {
      const modulePath = join(WEB_ROOT, entry.module);
      const testPath = join(WEB_ROOT, entry.testFile);
      expect(existsSync(modulePath), `registry module missing: ${entry.module}`).toBe(true);
      expect(existsSync(testPath), `registry test file missing: ${entry.testFile}`).toBe(true);

      const testSource = readFileSync(testPath, "utf8");
      for (const marker of entry.markers) {
        expect(
          testSource.includes(marker),
          `${entry.testFile} no longer contains the degenerate-case marker ${JSON.stringify(marker)} ` +
            `required for ${entry.module} (shapes: ${entry.shapes.join("; ")}). ` +
            "If the test was reworded, update the marker; if the case was deleted, restore it — " +
            "the healthy fixture alone shipped BI-EE2B243D.",
        ).toBe(true);
      }
    }
  });

  it("every module matching the availability-probe signature is enumerated or explicitly waived", () => {
    const matches = walkTsSources(LIB_ROOT)
      .filter((abs) => PROBE_SIGNATURE.test(readFileSync(abs, "utf8")))
      .map(toWebRelative)
      .sort();

    const enumerated = new Set(PROBE_REGISTRY.map((e) => e.module));
    const waived = new Set(PROBE_WAIVERS.map((w) => w.module));

    const unaccounted = matches.filter((m) => !enumerated.has(m) && !waived.has(m));
    expect(
      unaccounted,
      "New availability-probe module(s) detected with no degenerate-environment coverage " +
        "decision. Add each to PROBE_REGISTRY (map it to a test file exercising the " +
        "partial/stale/absent shapes via @/lib/testing/degenerate-env or an injected degraded " +
        "resolver) or add a reasoned waiver. Do not widen the waiver list by default.",
    ).toEqual([]);

    // Waivers must stay honest: a waiver for a module that no longer matches
    // (or no longer exists) is stale and must be removed.
    const matchSet = new Set(matches);
    const staleWaivers = PROBE_WAIVERS.filter((w) => !matchSet.has(w.module)).map((w) => w.module);
    expect(staleWaivers, "Stale waiver(s): module no longer matches the probe signature").toEqual(
      [],
    );

    // Calibration guard: the signature itself must keep matching the real
    // probe it was derived from, or the completeness check is measuring nothing.
    expect(matchSet.has("lib/mcp/packs/decision-reverify-pack.ts")).toBe(true);
  });
});
