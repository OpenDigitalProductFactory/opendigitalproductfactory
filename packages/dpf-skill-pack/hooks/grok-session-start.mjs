#!/usr/bin/env node
// Grok SessionStart entry (BI-BCA23DBB).
//
// Grok's hook plane ignores plugin-bundled hooks; host + sandbox installers
// wire this file into ~/.grok/hooks/dpf-guards.json SessionStart. It:
//   1. Probes active Grok plugins via grok-skill-exposure-adapter (when `grok`
//      is on PATH) so process-spine can report exposed vs installed honestly;
//   2. Runs process-spine-health-check --hook (injects additionalContext when
//      replacements are missing or competitive plugins still win);
//   3. Runs governance-freshness-check for branch drift of plane-1 wiring;
//   4. Runs toolchain-freshness (BI-A67B65F4): installed copies vs the portal
//      manifest. It always answers current, stale or unknown.
//
// Fail-open: any sub-step error exits 0 so SessionStart never wedges Grok.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hooksDir = dirname(fileURLToPath(import.meta.url));
const skillPackRoot = join(hooksDir, "..");

function runNode(script, args, env, input) {
  try {
    return spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env,
      input,
      timeout: 25_000,
      windowsHide: true,
    });
  } catch {
    return { status: 1, stdout: "", stderr: "spawn failed" };
  }
}

function contextOf(result) {
  if (!result.stdout?.trim()) return null;
  try {
    const ctx = JSON.parse(result.stdout)?.hookSpecificOutput?.additionalContext;
    return typeof ctx === "string" && ctx.trim() ? ctx.trim() : null;
  } catch {
    return null;
  }
}

function main() {
  const env = { ...process.env };
  const adapter = join(hooksDir, "grok-skill-exposure-adapter.mjs");
  const adapterResult = runNode(adapter, ["--skill-pack-root", skillPackRoot], env);
  if (adapterResult.status === 0 && adapterResult.stdout?.trim()) {
    env.DPF_PROCESS_SPINE_EXPOSED_SKILLS_JSON = adapterResult.stdout.trim();
  }

  const contexts = [];

  // BI-84C1F526: refresh Grok's DPF credential when missing or near expiry
  // (self-bounded to a few seconds; prints one plain repair line on failure).
  const credential = runNode(join(hooksDir, "grok-credential-refresh.mjs"), [], env);
  if (credential.stdout?.trim()) contexts.push(credential.stdout.trim());

  const spine = runNode(
    join(hooksDir, "process-spine-health-check.mjs"),
    ["--hook", "--skill-pack-root", skillPackRoot],
    env,
  );
  if (spine.stdout?.trim()) {
    try {
      const parsed = JSON.parse(spine.stdout);
      const ctx = parsed?.hookSpecificOutput?.additionalContext;
      if (typeof ctx === "string" && ctx.trim()) contexts.push(ctx.trim());
    } catch {
      // ignore non-JSON (severity ok exits with empty stdout)
    }
  }

  const freshness = runNode(join(hooksDir, "governance-freshness-check.mjs"), [], env);
  if (freshness.stdout?.trim()) {
    try {
      const parsed = JSON.parse(freshness.stdout);
      const ctx = parsed?.hookSpecificOutput?.additionalContext;
      if (typeof ctx === "string" && ctx.trim()) contexts.push(ctx.trim());
    } catch {
      // ignore
    }
  }

  // This entry never reads its own stdin (a held-open pipe would stall Grok's
  // session start), so the advisory gets the session folder from the cwd.
  const toolchain = contextOf(
    runNode(join(hooksDir, "toolchain-freshness.mjs"), [], env, JSON.stringify({ cwd: process.cwd() })),
  );
  if (toolchain) contexts.push(toolchain);

  if (contexts.length > 0) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: contexts.join("\n\n"),
        },
      }),
    );
  }
  process.exit(0);
}

main();
