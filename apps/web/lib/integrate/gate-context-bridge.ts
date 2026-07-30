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
import { join } from "node:path";

export type PlannedChange = { path: string; status: "A" | "M" | "D" };

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
  for (const candidate of [env.DPF_REPO_ROOT, env.PROJECT_ROOT, process.cwd()]) {
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
  changedFiles: PlannedChange[],
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
