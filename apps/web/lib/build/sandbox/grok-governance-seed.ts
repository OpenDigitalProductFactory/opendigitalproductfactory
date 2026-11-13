// apps/web/lib/build/sandbox/grok-governance-seed.ts
// BI-C5F9A232 — seed dpf-platform skills + plane-1/session hooks into the Build
// Studio sandbox so Grok under --always-approve shares host governance outcomes.
//
// Grok's hook-execution plane ignores plugin-bundled hooks (BI-883FC2FC). Host
// installers write ~/.grok/hooks/dpf-guards.json; the sandbox must do the same
// for the `node` user that runs dispatch. Skills still need `grok plugin install`.
//
// Prefer the workspace skill pack at /workspace/packages/dpf-skill-pack (always
// the branch under build) so the sandbox tracks the PR, not a stale image bake.
//
// The hook file is generated inside the sandbox by the pack's own
// hooks/lib/grok-hook-plane.mjs, from hooks.json minus the Grok exclusions in
// client-hook-planes.json, which is how the host updater builds it too
// (BI-413882E5). This file used to keep its own six-guard list with no matchers.

import { sandboxExec } from "./agent-cli-runtime";

const WORKSPACE_SKILL_PACK = "/workspace/packages/dpf-skill-pack";
const NODE_HOME = "/home/node";
const MANAGED_PLUGIN = `${NODE_HOME}/.agents/plugins/plugins/dpf-platform`;
const HOOKS_FILE = `${NODE_HOME}/.grok/hooks/dpf-guards.json`;

const COMPETITIVE_PLUGIN_IDS = [
  "superpowers",
  "superpowers@openai-curated",
  "superpowers@openai-bundled",
] as const;

export type GrokGovernanceSeedResult = {
  ok: boolean;
  plugin: string;
  hooks: string;
  competitive: string;
  detail?: string;
};

const GENERATOR = "hooks/lib/grok-hook-plane.mjs";

/**
 * Shell (single-quote safe: no expansion happens outside the sandbox) that has
 * the managed pack's own generator write the sandbox's dpf-guards.json. The
 * generator writes atomically and prints "WIRED <n>". A pack without it (a
 * branch cut before BI-413882E5) prints NO-GENERATOR and the old file stays.
 */
export function sandboxGrokHooksCommand(managedPlugin: string = MANAGED_PLUGIN, hooksFile: string = HOOKS_FILE): string {
  const generator = `${managedPlugin}/${GENERATOR}`;
  return `if [ -f "${generator}" ]; then node "${generator}" "${managedPlugin}" "${managedPlugin}/hooks" --out "${hooksFile}"; else echo NO-GENERATOR; fi`;
}

/**
 * Ensure the sandbox `node` user has dpf-platform installed, global hooks wired,
 * and known competitive process plugins disabled. Idempotent; best-effort —
 * returns ok:false with detail rather than throwing so dispatch can decide.
 */
export async function ensureSandboxGrokGovernance(params: {
  containerId: string;
  skillPackPath?: string;
}): Promise<GrokGovernanceSeedResult> {
  const { containerId } = params;
  const skillPack = params.skillPackPath ?? WORKSPACE_SKILL_PACK;
  const exec = sandboxExec();

  const probe = await exec(
    `docker exec --user node ${containerId} sh -c "test -d '${skillPack}/.grok-plugin' && test -d '${skillPack}/skills' && echo OK || echo MISSING"`,
    { timeout: 10_000 },
  ).catch((e: Error) => ({ stdout: "", stderr: e.message }));
  if (!String((probe as { stdout?: string }).stdout ?? "").includes("OK")) {
    return {
      ok: false,
      plugin: "skipped",
      hooks: "skipped",
      competitive: "skipped",
      detail: `skill pack not present at ${skillPack} (workspace not bootstrapped?)`,
    };
  }

  // Sync managed copy for absolute hook paths that survive plugin reinstall.
  const sync = await exec(
    `docker exec --user node ${containerId} sh -c "mkdir -p '${NODE_HOME}/.agents/plugins/plugins' && rm -rf '${MANAGED_PLUGIN}' && cp -a '${skillPack}' '${MANAGED_PLUGIN}' && echo SYNCED"`,
    { timeout: 60_000 },
  ).catch((e: Error) => ({ stdout: "", stderr: e.message }));
  if (!String((sync as { stdout?: string }).stdout ?? "").includes("SYNCED")) {
    return {
      ok: false,
      plugin: "failed-sync",
      hooks: "skipped",
      competitive: "skipped",
      detail: String((sync as { stderr?: string }).stderr ?? "sync failed").slice(0, 300),
    };
  }

  // Install / reinstall into Grok's plugin store (skills surface).
  const install = await exec(
    `docker exec --user node ${containerId} sh -c '
      set -e
      if grok plugin list --json 2>/dev/null | grep -q "\\"name\\":\\"dpf-platform\\""; then
        grok plugin uninstall dpf-platform --confirm --keep-data 2>/dev/null || true
      fi
      grok plugin install "${MANAGED_PLUGIN}" --trust
      grok plugin list --json 2>/dev/null | head -c 2000
    '`,
    { timeout: 120_000 },
  ).catch((e: Error) => ({ stdout: "", stderr: e.message }));
  const installOut = String((install as { stdout?: string }).stdout ?? "");
  const pluginOk = installOut.includes("dpf-platform") || installOut.includes('"name"');
  const pluginStatus = pluginOk ? "installed" : `failed:${String((install as { stderr?: string }).stderr ?? installOut).slice(0, 200)}`;

  // Global hooks plane, generated from the workspace pack (BI-413882E5).
  const wire = await exec(
    `docker exec --user node ${containerId} sh -c '${sandboxGrokHooksCommand()}'`,
    { timeout: 30_000 },
  ).catch((e: Error) => ({ stdout: "", stderr: e.message }));
  const wireOut = String((wire as { stdout?: string }).stdout ?? "");
  const wired = /WIRED (\d+)/.exec(wireOut);
  if (!wired) {
    return {
      ok: false,
      plugin: pluginStatus,
      hooks: wireOut.includes("NO-GENERATOR") ? "skipped: workspace pack has no grok-hook-plane.mjs" : "failed-write",
      competitive: "skipped",
      detail: String((wire as { stderr?: string }).stderr ?? wireOut).slice(0, 300),
    };
  }

  // Disable competitive process plugins when present (disable-not-delete).
  const competitiveParts: string[] = [];
  for (const id of COMPETITIVE_PLUGIN_IDS) {
    const dis = await exec(
      `docker exec --user node ${containerId} sh -c "grok plugin list --json 2>/dev/null | grep -q '\\"name\\":\\"${id}\\"' && grok plugin disable '${id}' 2>&1 || echo not-installed:${id}"`,
      { timeout: 30_000 },
    ).catch((e: Error) => ({ stdout: e.message, stderr: "" }));
    competitiveParts.push(String((dis as { stdout?: string }).stdout ?? "").trim().slice(0, 80) || id);
  }

  return {
    ok: pluginOk,
    plugin: pluginStatus,
    hooks: `wired ${wired[1]} hook(s) from hooks.json -> ${HOOKS_FILE}`,
    competitive: competitiveParts.join("; ").slice(0, 400),
  };
}
