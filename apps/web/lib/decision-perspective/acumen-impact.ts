// Acumen impact classifier (W16 — BI-18519A73, EP-413F2602).
//
// Maps the file paths a Build Studio phase intends to touch onto the platform
// acumens (WSID craft families) whose judgment is IMPACTED by the change, so a
// phase gate can consult each impacted acumen's profession gate instead of one
// flat decision layer. Pure and deterministic: no DB, no filesystem — a path
// either matches a rule or it does not, and the returned keys always come back
// deduped in acumen-registry order.
//
// Rule semantics: FIRST matching rule wins per path (rule order below is
// load-bearing — e.g. `api/mcp` must classify as mcp-integration before the
// broader `app/api` security rule can claim it); the result is the UNION of
// the per-path winners. A registered profession owns its own corpus path
// before those rules run. The profession registry validates every returned
// key; a missing resident coworker is a resolution obligation, not grounds
// to silently discard an impacted profession.

import { ACUMEN_ROOM_SHAPES } from "@/lib/work-management/acumen-room-shapes";
import { PROFESSION_REGISTRY, type ProfessionFamily } from "./resolve-profession-profile";

type AcumenPathRule = {
  professionKey: string;
  matches: (path: string) => boolean;
};

function isTypeScriptPath(path: string): boolean {
  return path.endsWith(".ts") || path.endsWith(".tsx");
}

/**
 * Ordered first-match rules. Keep the specific surfaces (mcp, a2a) ahead of
 * the broad ones (app/api, apps/web/lib) — see module header.
 */
const ACUMEN_PATH_RULES: readonly AcumenPathRule[] = [
  {
    professionKey: "data-architect",
    matches: (p) =>
      p.includes("packages/db/prisma")
      || p.includes("migrations")
      || p.includes("packages/db/src"),
  },
  {
    professionKey: "ux-design",
    matches: (p) =>
      p.includes("apps/web/components")
      || p.includes("app/(shell)")
      || p.endsWith(".css")
      || p.includes("design-tokens")
      || p.includes("design tokens"),
  },
  {
    professionKey: "mcp-integration",
    matches: (p) =>
      p.includes("apps/web/lib/mcp")
      || p.includes("api/mcp")
      || p.includes("api/a2a")
      || p.includes("lib/integrate"),
  },
  {
    professionKey: "security",
    matches: (p) =>
      p.includes("app/api")
      || p.includes("middleware")
      || p.includes("auth")
      || p.includes("lib/tak"),
  },
  {
    professionKey: "devops-platform",
    matches: (p) =>
      p.startsWith("scripts/")
      || p.includes("/scripts/")
      || p.includes("docker")
      || p.includes("compose")
      || p.includes(".github/workflows"),
  },
  {
    // Fallback craft: any other platform TypeScript under apps/web/lib or
    // packages is software engineering by default.
    professionKey: "software-engineer",
    matches: (p) =>
      isTypeScriptPath(p)
      && (p.includes("apps/web/lib") || p.startsWith("packages/") || p.includes("/packages/")),
  },
];

/**
 * Derive the impacted acumens (professionKeys) for a set of planned file
 * paths. Preserve existing resident order, then append other registered
 * professions in canonical registry order. Input order never changes output.
 * The optional registry projection supports pure verification of additions.
 */
export function deriveImpactedAcumens(
  filePaths: readonly string[],
  families: readonly Pick<ProfessionFamily, "professionKey">[] = PROFESSION_REGISTRY.families,
): string[] {
  const registered = new Set(families.map((family) => family.professionKey));
  const matched = new Set<string>();
  for (const raw of filePaths) {
    const path = raw.trim().replaceAll("\\", "/").toLowerCase();
    if (!path) continue;
    const corpusOwner = /(?:^|\/)docs\/professions\/([^/]+)\//.exec(path)?.[1];
    if (corpusOwner && registered.has(corpusOwner)) {
      matched.add(corpusOwner);
      continue;
    }
    const rule = ACUMEN_PATH_RULES.find((r) => r.matches(path));
    if (rule) matched.add(rule.professionKey);
  }

  const order = new Set([
    ...ACUMEN_ROOM_SHAPES.map((entry) => entry.professionKey),
    ...registered,
  ]);
  return [...order].filter((key) => registered.has(key) && matched.has(key));
}
