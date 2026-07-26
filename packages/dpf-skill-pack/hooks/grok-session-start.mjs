#!/usr/bin/env node
// Grok SessionStart entry (BI-BCA23DBB).
//
// Grok's hook plane ignores plugin-bundled hooks; host + sandbox installers
// wire this file into ~/.grok/hooks/dpf-guards.json SessionStart. It:
//   1. Probes active Grok plugins via grok-skill-exposure-adapter (when `grok`
//      is on PATH) so process-spine can report exposed vs installed honestly;
//   2. Runs process-spine-health-check --hook (injects additionalContext when
//      replacements are missing or competitive plugins still win);
//   3. Runs governance-freshness-check for branch drift of plane-1 wiring.
//
// Fail-open: any sub-step error exits 0 so SessionStart never wedges Grok.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hooksDir = dirname(fileURLToPath(import.meta.url));
const skillPackRoot = join(hooksDir, "..");

function runNode(script, args, env) {
  try {
    return spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env,
      timeout: 25_000,
      windowsHide: true,
    });
  } catch {
    return { status: 1, stdout: "", stderr: "spawn failed" };
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
