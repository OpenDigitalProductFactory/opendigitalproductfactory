/**
 * The sensitivity that raises a delivery shape, read from what the change
 * touches (BI-243BC956).
 *
 * Before this module every readiness caller passed `${title}\n${body}` to a
 * keyword regex, so an accurate defect report raised its own shape: BI-1669E08A
 * (two CLI modules) owed a medium baseline because its body said
 * "infrastructure", and BI-7DCA6159 (a two-file import swap) owed the large
 * gates because its body said "payment". The incentive that taught — keep
 * impact prose out of the body — is the opposite of what a backlog is for.
 *
 * WWMD DI-52BAAB9E6835: change facts govern whenever they exist, and prose is
 * the fallback only when none do. Change facts, most authoritative first:
 *   1. the Workroom's declared edit scope (claim_workroom_scope), which is what
 *      the change says it edits and is re-read at completion;
 *   2. the repo paths the item body cites — at claim time no diff exists yet,
 *      and a body that names its files is naming the change.
 * With change facts, prose cannot raise above what the paths warrant.
 *
 * Operator direction 2026-10-07 supersedes DI-52BAAB9E6835's prose fallback: a
 * word is not evidence. On 2026-10-06, 47 of 126 builds parked in plan owed the
 * large gates only because their prose said "permission", "outbound",
 * "schema"... With no change fact the shape stays as declared, and a build's
 * plan is a change fact (3, below), so sensitive work is still raised on the
 * files it will touch, at the plan-to-build gate where the plan exists.
 *   3. the files a Build Studio plan lists (buildPlan.fileStructure), outranked
 *      by a declared scope and outranking paths the body cites.
 *
 * WWMD DI-B9DCC3F456F9: substrate is STRUCTURAL. Schema, migrations, routes and
 * external surfaces are elevated; the access-control boundary is high. A domain
 * noun in a module name (payment, invoice) is not substrate, or the keyword
 * defect would simply reappear one level down. Tests and docs touch no runtime
 * substrate whatever they are named.
 */

import type { ReadinessSensitivity, SensitivityTrigger } from "./types";

export type { SensitivityTrigger };
export type SensitivitySource = SensitivityTrigger["source"];

export type DeliverySensitivityAssessment = {
  level: ReadinessSensitivity;
  trigger: SensitivityTrigger | null;
};

const RANK: Record<ReadinessSensitivity, number> = { low: 0, elevated: 1, high: 2 };

const ACCESS_CONTROL_TOKENS = new Set([
  "auth", "authn", "authz", "oauth", "rbac", "permission", "permissions", "grant", "grants",
  "credential", "credentials", "secret", "secrets", "security", "middleware",
]);
const EXTERNAL_SURFACE_TOKENS = new Set(["webhook", "webhooks", "outbound", "federation"]);
// Directories, not words: `scripts/lib/local-integration-ci.mjs` is a CLI module.
const EXTERNAL_SURFACE_PATH = /(^|\/)(integrations|infra|docker)\/|(^|\/)(docker-compose[^/]*\.ya?ml|Dockerfile[^/]*)$|(^|\/)\.github\/workflows\//i;

function isNonRuntimePath(path: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/i.test(path)
    || /(^|\/)(__tests__|e2e|tests)\//.test(path)
    || /(^|\/)docs\//.test(path)
    || /\.mdx?$/i.test(path);
}

/**
 * The substrate class a changed path belongs to, or null when it touches none.
 * Pure and path-only: no file is read.
 */
export function classifyChangePath(rawPath: string): { level: ReadinessSensitivity; signal: string } | null {
  const path = rawPath.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || isNonRuntimePath(path)) return null;
  const tokens = new Set(path.toLowerCase().split(/[/._-]+/).filter(Boolean));
  if (/(^|\/)agent_registry\.json$/.test(path) || [...tokens].some((token) => ACCESS_CONTROL_TOKENS.has(token))) {
    return { level: "high", signal: "access-control" };
  }
  if (/(^|\/)prisma\/migrations\//.test(path)) return { level: "elevated", signal: "migration" };
  if (/(^|\/)prisma\/schema[^/]*\.prisma$|(^|\/)prisma\/schema\//.test(path)) return { level: "elevated", signal: "schema" };
  if (/(^|\/)app\/(.+\/)?route\.[cm]?[jt]sx?$/.test(path) || /(^|\/)app\/api\//.test(path)) {
    return { level: "elevated", signal: "route" };
  }
  if (EXTERNAL_SURFACE_PATH.test(path) || [...tokens].some((token) => EXTERNAL_SURFACE_TOKENS.has(token))) {
    return { level: "elevated", signal: "external-surface" };
  }
  return null;
}

// A repo path cited in prose: a known top-level root followed by at least one
// segment. Not preceded by `/` or `@`, so an import specifier such as
// `@/lib/finance/x` is not read as a file, and a `:620` line suffix is dropped.
const CITED_PATH = /(?<![\w@/.-])((?:apps|packages|scripts|services|prompts|skills|tools|infra|docker|lib|\.github)\/[\w.@/[\]()-]*[\w\])])/g;

export function extractCitedRepoPaths(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const match of (text ?? "").matchAll(CITED_PATH)) {
    const path = match[1]!.replace(/[.)]+$/, "");
    if (path.includes("/")) seen.add(path);
  }
  return [...seen];
}

function assessPaths(paths: readonly string[], source: SensitivitySource): DeliverySensitivityAssessment {
  let best: DeliverySensitivityAssessment = { level: "low", trigger: null };
  for (const path of paths) {
    const hit = classifyChangePath(path);
    if (hit && RANK[hit.level] > RANK[best.level]) {
      best = { level: hit.level, trigger: { signal: hit.signal, source, evidence: path } };
    }
  }
  return best;
}

export function assessDeliverySensitivity(input: {
  title?: string | null;
  body?: string | null;
  workType?: string | null;
  /** The bound Workroom's declared edit paths; outrank anything else. */
  declaredPaths?: readonly string[] | null;
  /** The files a Build Studio plan will create or change; outrank paths the body cites. */
  planPaths?: readonly string[] | null;
}): DeliverySensitivityAssessment {
  const declared = (input.declaredPaths ?? []).filter((path) => path.trim().length > 0);
  if (declared.length > 0) return assessPaths(declared, "declared-scope");
  const planned = (input.planPaths ?? []).filter((path) => path.trim().length > 0);
  if (planned.length > 0) return assessPaths(planned, "build-plan-paths");
  const cited = extractCitedRepoPaths(`${input.title ?? ""}\n${input.body ?? ""}`);
  if (cited.length > 0) return assessPaths(cited, "item-body-paths");
  return { level: "low", trigger: null };
}

/** The file paths a Build Studio plan lists, or [] when it lists none. */
export function buildPlanPaths(buildPlan: unknown): string[] {
  const files = (buildPlan as { fileStructure?: unknown } | null)?.fileStructure;
  if (!Array.isArray(files)) return [];
  return files
    .map((file) => (file as { path?: unknown } | null)?.path)
    .filter((path): path is string => typeof path === "string" && path.trim().length > 0);
}
