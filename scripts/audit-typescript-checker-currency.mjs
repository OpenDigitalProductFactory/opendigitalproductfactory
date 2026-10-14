#!/usr/bin/env node
// Is the TypeScript 7 checker pin current? (BI-D2FE6931)
//
// scripts/run-tsc.mjs type-checks with TypeScript 7, pinned once at the root as
// the npm alias "typescript7": "npm:typescript@<version>" (BI-2B8D67A9). Nothing
// documents Dependabot updating an `npm:`-aliased dependency, so this check does
// not rely on it: it compares the pin with npm's `latest` dist-tag and reports
//   current   - the pin is npm's latest
//   behind    - a newer release of the same major exists: bump the pin
//   new-major - npm's latest is a later major: upgrade deliberately
//   ahead     - the pin is newer than latest (a pre-release was pinned)
// It reports; it never edits package.json. .github/workflows/
// audit-typescript-checker-currency.yml runs it weekly and files one tracking issue.
//
// Usage: node scripts/audit-typescript-checker-currency.mjs [--require-online]
//   writes sbom/typescript-checker-currency.json and .md; exit 0, or 2 when
//   --require-online and the registry could not be read.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryModule } from "./lib/entry-module.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REGISTRY_URL = "https://registry.npmjs.org/typescript";

/** The pinned version from the root package.json's `typescript7` alias, or null. */
export function parsePinnedTs7(rootPackageJson) {
  const spec = rootPackageJson?.devDependencies?.typescript7 ?? rootPackageJson?.dependencies?.typescript7;
  const match = /^npm:typescript@(\d+\.\d+\.\d+)$/.exec(String(spec ?? ""));
  return match ? match[1] : null;
}

/**
 * npm's latest dist-tag as a plain `X.Y.Z`, rebuilt from its numbers, or null.
 * The registry response is untrusted and ends up in a report and an issue body,
 * so anything other than a release version (a pre-release, markup) is refused.
 */
export function normalizeRegistryVersion(raw) {
  const match = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(typeof raw === "string" ? raw : "");
  return match ? match.slice(1, 4).map(Number).join(".") : null;
}

function parts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ""));
  return match ? match.slice(1, 4).map(Number) : null;
}

/** Compare the pin with npm's latest. Pure. */
export function assessCurrency({ pinned, latest }) {
  const p = parts(pinned);
  const l = parts(latest);
  if (!p || !l) return { status: "unknown", pinned, latest };
  if (l[0] > p[0]) return { status: "new-major", pinned, latest };
  for (let i = 0; i < 3; i++) {
    if (l[i] > p[i]) return { status: "behind", pinned, latest };
    if (l[i] < p[i]) return { status: "ahead", pinned, latest };
  }
  return { status: "current", pinned, latest };
}

export function renderMarkdown(result) {
  const advice = {
    current: "The TypeScript 7 checker pin is npm's latest release. Nothing to do.",
    behind: `TypeScript ${result.latest} is out; the checker is pinned at ${result.pinned}. Bump \`typescript7\` in the root package.json (\`pnpm add -w -D typescript7@npm:typescript@${result.latest}\`), then run the TS6 parity reference before merging.`,
    "new-major": `npm's latest TypeScript is ${result.latest}, a later major than the pinned ${result.pinned}. Upgrade deliberately, under a backlog item, as BI-2B8D67A9 did for 7.`,
    ahead: `The pin ${result.pinned} is newer than npm's latest ${result.latest}, so a pre-release is pinned. Confirm that is intended.`,
    unknown: `Could not compare the pin (${result.pinned ?? "not found"}) with npm's latest (${result.latest ?? "unavailable"}).`,
  }[result.status];
  return `# TypeScript checker currency\n\n**${result.status}** - ${advice}\n`;
}

async function main() {
  const requireOnline = process.argv.includes("--require-online");
  const pinned = parsePinnedTs7(JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")));
  let latest = null;
  try {
    const response = await fetch(REGISTRY_URL, { headers: { accept: "application/vnd.npm.install-v1+json" } });
    if (response.ok) latest = normalizeRegistryVersion((await response.json())?.["dist-tags"]?.latest);
  } catch {
    latest = null;
  }
  const result = assessCurrency({ pinned, latest });
  writeFileSync(resolve(ROOT, "sbom/typescript-checker-currency.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(resolve(ROOT, "sbom/typescript-checker-currency.md"), renderMarkdown(result));
  process.stdout.write(`[typescript-checker-currency] ${result.status}: pinned ${pinned ?? "?"}, npm latest ${latest ?? "?"}\n`);
  if (requireOnline && latest === null) process.exit(2);
}

if (isEntryModule(import.meta.url)) {
  await main();
}
