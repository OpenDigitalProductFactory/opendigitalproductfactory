import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import picomatch from "picomatch";
import { describe, expect, it } from "vitest";

// Guardrail against the PR #693 / PR #1013 class of bug: a narrowing of
// `vitest.config.ts`'s `include` glob silently excluded every
// `packages/db/src/*.test.ts` file from CI for a month, hiding ~520 unit tests
// and two latent failures. This file lives under `test/` (never excluded by
// any plausible narrowing) and asserts every `.test.ts` file under
// `packages/db/` is covered by at least one include pattern. If someone
// narrows the include again, this test fails in the same CI run rather than
// quietly skipping its siblings.

const pkgRoot = resolve(__dirname, "..");
const configPath = resolve(pkgRoot, "vitest.config.ts");

// Extract the include array from vitest.config.ts as source text. We avoid
// importing the config module because it has dotenv side effects at load
// time and because the source-text parse is robust to ESM/CJS interop
// quirks. The array is small and fixed-shape; a simple regex is sufficient.
function readIncludeGlobs(): string[] {
  const text = readFileSync(configPath, "utf8");
  const match = text.match(/include\s*:\s*\[([^\]]*)\]/);
  if (!match) {
    throw new Error(
      `Could not locate \`include: [...]\` in ${configPath}. ` +
        `If the config shape changed, update this guardrail.`,
    );
  }
  const items = match[1]!.match(/(['"`])([^'"`]+)\1/g) ?? [];
  return items.map((s) => s.slice(1, -1));
}

function listTestFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".generated" || entry === "generated") {
      continue;
    }
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      listTestFiles(full, out);
    } else if (entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("vitest.config.ts include glob covers every .test.ts file", () => {
  it("no .test.ts file under packages/db/ is silently excluded", () => {
    const globs = readIncludeGlobs();
    expect(globs.length, "include array is empty").toBeGreaterThan(0);

    const matchers = globs.map((g) => picomatch(g));
    const allTests = listTestFiles(pkgRoot);
    expect(allTests.length, "no .test.ts files found — listing logic broken").toBeGreaterThan(0);

    const unmatched: string[] = [];
    for (const file of allTests) {
      // picomatch expects forward-slash paths relative to the pattern's root.
      const rel = relative(pkgRoot, file).split(sep).join("/");
      if (!matchers.some((m) => m(rel))) {
        unmatched.push(rel);
      }
    }

    expect(
      unmatched,
      `${unmatched.length} test file(s) are not covered by any include glob ` +
        `in vitest.config.ts. Either widen the include or move/rename the files. ` +
        `Globs: ${JSON.stringify(globs)}. Unmatched:\n  ${unmatched.join("\n  ")}`,
    ).toEqual([]);
  });

  it("include globs are non-trivial (defensive — catches accidental empty/wildcard regressions)", () => {
    const globs = readIncludeGlobs();
    // Reject the degenerate "" or " " case that could match nothing.
    for (const g of globs) {
      expect(g.trim().length, `include glob \`${g}\` is empty or whitespace`).toBeGreaterThan(0);
      expect(g, `include glob \`${g}\` must end in .test.ts`).toMatch(/\.test\.ts$/);
    }
  });
});
