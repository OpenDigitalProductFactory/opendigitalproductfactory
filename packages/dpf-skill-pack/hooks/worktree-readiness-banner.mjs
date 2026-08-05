#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/worktree-readiness-banner.mjs
//
// SessionStart hook (BI-1C1483C6): announce whether this worktree can actually
// run the gates an agent is about to promise.
//
// WHAT WAS OBSERVED (2026-08-04, worktree claude/approval-surfaces-auth-sweep-dd17fd)
// `apps/web/node_modules` was an EMPTY directory and the worktree root had no
// `node_modules` at all. The root clone was fine. NOTHING announced this. It
// surfaced much later as `'next' is not recognized` from the pre-commit
// typecheck gate and 14 vitest suites failing with "Cannot find package
// 'react'" — which look exactly like real breakage. Confirming they were
// environmental cost a `git stash` + re-run per suspicion, and an agent that
// does not think to stash reports them as regressions its own change caused.
//
// WHY DETECTION, NOT PROVISIONING
// The obvious reading is "worktree-create should install". It deliberately does
// not: `worktree-create.mjs` only PLACES the worktree, and BI-3047C122 recorded
// a principle_decide outcome that a multi-minute install must never gate the
// blocking WorktreeCreate hook — bootstrap is opt-in (DPF_WORKTREE_BOOTSTRAP=1
// via the seed script). That decision stands. What was wrong is not that the
// half-tree is legal; it is that the hand-over was SILENT. This hook makes it
// loud without reversing a ratified decision.
//
// The classification itself is not new either — `dpf-worktree-per-session`
// documents a "compile-ready vs source-only" split and
// scripts/lib/bootstrap-worktree-deps.mjs computes it. It was simply never
// surfaced at runtime. This hook is the missing last hop.
//
// READ-ONLY. It probes with existsSync/readdirSync and nothing else. A
// worktree's node_modules is normally a JUNCTION to the root clone: `rm -rf` on
// it has gutted the root clone before (1198 deleted sources), and a bare
// `pnpm install` writes THROUGH it. This hook must never grow a repair path.
//
// Fail-open in every direction — a banner that breaks session start is worse
// than the silence it replaces.

import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inDpfWorkspace } from "./lib/hook-io.mjs";

const hooksDir = dirname(fileURLToPath(import.meta.url));
const repoRootGuess = resolve(hooksDir, "../../..");

function readPayload() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function sessionCwd(payload) {
  return payload.cwd || payload.workspaceRoot || payload.workspace_root || process.cwd();
}

/** The worktree root, so a session started in a subdirectory still classifies correctly. */
function resolveWorktreeRoot(cwd) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
  });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : cwd;
}

async function loadProbe(worktreeRoot) {
  // Prefer THIS worktree's copy so the probe matches the tree being classified.
  for (const base of [worktreeRoot, repoRootGuess]) {
    const candidate = join(base, "scripts/lib/bootstrap-worktree-deps.mjs");
    if (existsSync(candidate)) {
      try {
        return await import(pathToFileURL(candidate).href);
      } catch {
        // Try the next candidate rather than failing the session.
      }
    }
  }
  return null;
}

function emitContext(text) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }),
  );
}

async function main() {
  if (process.env.DPF_SKIP_WORKTREE_READINESS_BANNER === "1") process.exit(0);

  const payload = readPayload();
  const cwd = sessionCwd(payload);
  if (!inDpfWorkspace(cwd)) process.exit(0);

  const worktreeRoot = resolveWorktreeRoot(cwd);
  const probe = await loadProbe(worktreeRoot);
  if (!probe?.probeWorktreeReadiness || !probe?.formatReadinessBanner) process.exit(0);

  const readiness = probe.probeWorktreeReadiness(worktreeRoot);
  const lines = probe.formatReadinessBanner(readiness, worktreeRoot);
  // A compile-ready worktree says nothing: the banner exists to correct a false
  // belief, and there is no false belief to correct when the tree is ready.
  if (lines.length > 0) emitContext(lines.join("\n"));
  process.exit(0);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("worktree-readiness-banner.mjs")) {
  main().catch(() => process.exit(0));
}
