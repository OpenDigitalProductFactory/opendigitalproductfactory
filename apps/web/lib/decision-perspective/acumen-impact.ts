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
// the per-path winners. Every returned key is validated against the acumen
// room-shape registry so a rule can never nominate a craft that has no
// resident coworker to consult.

import {
  ACUMEN_ROOM_SHAPES,
  getAcumenRoomShape,
} from "@/lib/work-management/acumen-room-shapes";

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
 * paths. Deduped, in acumen-registry order (deterministic regardless of input
 * order). Paths matching no rule contribute nothing; empty input returns [].
 */
export function deriveImpactedAcumens(filePaths: readonly string[]): string[] {
  const matched = new Set<string>();
  for (const raw of filePaths) {
    const path = raw.trim();
    if (!path) continue;
    const rule = ACUMEN_PATH_RULES.find((r) => r.matches(path));
    if (rule) matched.add(rule.professionKey);
  }

  // Registry order + registry validation in one pass: a key that is not in the
  // acumen room-shape registry has no resident coworker and cannot be consulted.
  return ACUMEN_ROOM_SHAPES
    .map((entry) => entry.professionKey)
    .filter((key) => matched.has(key) && getAcumenRoomShape(key) !== null);
}
