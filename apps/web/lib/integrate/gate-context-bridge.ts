// Gate-context bridge (BI-121DC3A3, parent BI-2677A465).
//
// The gate-context pack generator lives in scripts/lib/gate-context.mjs and
// MUST stay the single source of constraint knowledge — this bridge never
// reimplements a rule. The portal shells out to the CLI's `--stdin-json` mode
// against the host repo checkout (DPF_REPO_ROOT bind mount, the same
// resolution Work Control uses; PROJECT_ROOT / cwd in dev), feeding it the
// PLANNED file changes so agents receive the CI constraints BEFORE code
// exists. Advisory by contract: any failure returns null and the caller
// proceeds without the section — the pack must never block a build, and it
// must never claim a gate passed.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type PlannedChange = { path: string; status: "A" | "M" | "D" };
type GateContextInputChange = { path: string; status: PlannedChange["status"] | "P" };

export type GateContextJson = {
  schemaVersion: number;
  changedFileCount: number;
  guardObligations: Array<{ id: string; name: string; commands: unknown[]; because: string }>;
  testImpact: Array<{ path: string; action: string; tool: string; rule: string }>;
  unresolvedPaths?: string[];
  [key: string]: unknown;
};

export type ChangeImpactContract = {
  schemaVersion: 1;
  source: "gate-context";
  status: "resolved" | "unresolved";
  paths: string[];
  instructions: string[];
  gateContext?: GateContextJson;
  reason?: string;
  unresolvedPaths?: string[];
};

type PlanFileEntry = { path?: unknown; action?: unknown };

/** Extract the intended diff from an approved build plan's fileStructure. */
export function plannedChangesFromPlan(plan: Record<string, unknown> | null | undefined): PlannedChange[] {
  const buildPlan = (plan?.["buildPlan"] ?? plan) as Record<string, unknown> | null | undefined;
  const entries = Array.isArray(buildPlan?.["fileStructure"])
    ? (buildPlan["fileStructure"] as PlanFileEntry[])
    : [];
  return entries
    .map((entry) => ({
      path: typeof entry?.path === "string" ? entry.path.trim().replace(/\\/g, "/") : "",
      status: (entry?.action === "create" ? "A" : "M") as PlannedChange["status"],
    }))
    .filter((entry) => entry.path.length > 0);
}

export function resolveGateContextRepoRoot(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const candidates = [env.DPF_REPO_ROOT, env.PROJECT_ROOT].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  let ancestor = process.cwd();
  for (;;) {
    candidates.push(ancestor);
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, "scripts", "gate-context.mjs"))) {
      return candidate;
    }
  }
  return null;
}

/**
 * Run the generator for the given planned changes and return the markdown
 * pack, or null when the generator is unavailable/failed (advisory contract).
 */
export async function computeGateContextMarkdown(
  changedFiles: GateContextInputChange[],
  options: { repoRoot?: string | null; timeoutMs?: number; json?: boolean } = {},
): Promise<string | null> {
  if (changedFiles.length === 0) return null;
  const repoRoot = options.repoRoot ?? resolveGateContextRepoRoot();
  if (!repoRoot) return null;

  return new Promise((resolve) => {
    const args = [join(repoRoot, "scripts", "gate-context.mjs"), "--stdin-json"];
    if (options.json) args.push("--json");
    const child = execFile(
      process.execPath,
      args,
      { cwd: repoRoot, timeout: options.timeoutMs ?? 15_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          if (error) console.warn("[gate-context-bridge] generator unavailable (advisory, continuing):", error.message);
          resolve(null);
          return;
        }
        resolve(stdout.trim());
      },
    );
    child.stdin?.end(JSON.stringify({ changedFiles }));
  });
}

/** Return the generator's typed JSON form, or null on any unavailable/invalid result. */
export async function computeGateContextJson(
  changedFiles: GateContextInputChange[],
  options: { repoRoot?: string | null; timeoutMs?: number } = {},
): Promise<GateContextJson | null> {
  const raw = await computeGateContextMarkdown(changedFiles, { ...options, json: true });
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GateContextJson>;
    if (
      typeof parsed.schemaVersion !== "number" ||
      typeof parsed.changedFileCount !== "number" ||
      !Array.isArray(parsed.guardObligations) ||
      !Array.isArray(parsed.testImpact)
    ) return null;
    return parsed as GateContextJson;
  } catch {
    return null;
  }
}

/** Build the fail-safe contract persisted when a capsule claims edit paths. */
export async function computeChangeImpactContract(
  paths: string[],
  options: { repoRoot?: string | null; timeoutMs?: number } = {},
): Promise<ChangeImpactContract> {
  const normalized = [...new Set(paths.map((path) => path.trim().replace(/\\/g, "/")).filter(Boolean))].sort();
  const gateContext = await computeGateContextJson(
    normalized.map((path) => ({ path, status: "P" as const })),
    options,
  );
  const instructions = [
    "Resolve every testImpact entry before Red and include the affected tests in the implementation loop.",
    "Exercise every guardObligation before treating the change as complete.",
    "CI remains authoritative; missing, stale, or unresolved advice expands to exhaustive verification.",
  ];
  const unresolvedPaths = gateContext?.unresolvedPaths ?? [];
  if (!gateContext || unresolvedPaths.length > 0) {
    return {
      schemaVersion: 1,
      source: "gate-context",
      status: "unresolved",
      paths: normalized,
      instructions,
      reason: !gateContext
        ? "gate-context generator unavailable or returned invalid JSON"
        : "scope contains directories; claim concrete files to resolve tests and guards",
      ...(unresolvedPaths.length > 0 ? { unresolvedPaths } : {}),
    };
  }
  return {
    schemaVersion: 1,
    source: "gate-context",
    status: "resolved",
    paths: normalized,
    instructions,
    gateContext,
  };
}
