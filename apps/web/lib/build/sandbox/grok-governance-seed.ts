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

import { sandboxExec, writeSandboxFile } from "./agent-cli-runtime";

const WORKSPACE_SKILL_PACK = "/workspace/packages/dpf-skill-pack";
const NODE_HOME = "/home/node";
const MANAGED_PLUGIN = `${NODE_HOME}/.agents/plugins/plugins/dpf-platform`;
const HOOKS_FILE = `${NODE_HOME}/.grok/hooks/dpf-guards.json`;

const PRE_TOOL_GUARDS = [
  "lease-punt-guard.mjs",
  "decision-routing-guard.mjs",
  "lease-guard.mjs",
  "root-clone-guard.mjs",
  "compose-guard.mjs",
  "plan-backlog-coverage-guard.mjs",
] as const;

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

function commandEntry(scriptPath: string, timeout: number) {
  return {
    hooks: [
      {
        type: "command" as const,
        command: `node "${scriptPath}"`,
        timeout,
      },
    ],
  };
}

/** Build the same global hooks payload host install_grok_hooks writes. */
export function buildSandboxGrokHooksPayload(hooksDir: string): {
  hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string; timeout: number }> }>>;
} {
  const pre = PRE_TOOL_GUARDS.map((g) => commandEntry(`${hooksDir}/${g}`, 15));
  const sessionStart = commandEntry(`${hooksDir}/grok-session-start.mjs`, 30);
  const sessionEnd = commandEntry(`${hooksDir}/uncommitted-work-guard.mjs`, 15);
  return {
    hooks: {
      PreToolUse: pre,
      SessionStart: [sessionStart],
      SessionEnd: [sessionEnd],
      Stop: [sessionEnd],
    },
  };
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

  // Global hooks plane (PreToolUse + SessionStart + Stop).
  const hooksDir = `${MANAGED_PLUGIN}/hooks`;
  const payload = buildSandboxGrokHooksPayload(hooksDir);
  try {
    await writeSandboxFile({
      containerId,
      path: HOOKS_FILE,
      content: `${JSON.stringify(payload, null, 2)}\n`,
      mode: "644",
      asNodeUser: true,
      mkdirParents: `${NODE_HOME}/.grok/hooks`,
      timeoutMs: 15_000,
    });
  } catch (e) {
    return {
      ok: false,
      plugin: pluginStatus,
      hooks: "failed-write",
      competitive: "skipped",
      detail: (e as Error).message.slice(0, 300),
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
    hooks: `wired ${PRE_TOOL_GUARDS.length} PreToolUse + SessionStart/Stop -> ${HOOKS_FILE}`,
    competitive: competitiveParts.join("; ").slice(0, 400),
  };
}
