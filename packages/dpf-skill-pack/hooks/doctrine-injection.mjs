#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/doctrine-injection.mjs
//
// SessionStart hook (BI-E659ED37, kernel decision DI-48014BCBA44F):
// put the canonical rulebook in context when the per-branch pointer will not.
//
// WHY
// Doctrine reached a thread only through CLAUDE.md, a per-branch file. On 70 of
// 80 live worktrees (measured 2026-08-22) that file was the pre-#4477 prose
// link — "Read [/AGENTS.md](AGENTS.md) ..." — which the client does not follow.
// Those threads ran with NO doctrine and no way to know it. This is what the
// operator meant by "just pointing to the folder doesn't seem to work now, it
// used to": pointing worked when worktrees were few and short-lived.
//
// WHAT THIS DOES
// Resolves the rulebook from the ROOT CLONE (kept fast-forwarded to origin/main
// by root-clone-freshness.mjs, reachable from any worktree however old) and
// injects it — but ONLY when the pointer would not load it, so a conformant
// worktree does not carry the rulebook twice.
//
// Front-loading the full rulebook rather than a summary is the ratified stance
// (DI-F844365B0DCC Option B). This hook does not re-litigate it; it makes the
// stance actually hold on a branch that predates the pointer fix.
//
// READ-ONLY, and fail-open at the hook boundary: a hook that breaks session
// start is worse than the silence it replaces. The VERDICT still fails closed —
// thread-conformance reports doctrine as not loaded, and the guards enforce it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inDpfWorkspace } from "./lib/hook-io.mjs";

const hooksDir = dirname(fileURLToPath(import.meta.url));

function readPayload() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function emitContext(text) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }),
  );
}

async function main() {
  if (process.env.DPF_SKIP_DOCTRINE_INJECTION === "1") process.exit(0);

  const payload = readPayload();
  const cwd = payload.cwd || payload.workspaceRoot || payload.workspace_root || process.cwd();
  if (!inDpfWorkspace(cwd)) process.exit(0);

  const mod = await import(pathToFileURL(join(hooksDir, "lib/doctrine-source.mjs")).href);
  const delivery = mod.doctrineDelivery({ cwd });

  // The pointer already imports the rulebook — injecting would duplicate ~24KB.
  if (!delivery.needsInjection) process.exit(0);

  const header = [
    "DPF CANONICAL RULEBOOK — injected because this worktree's CLAUDE.md does not import it.",
    `Source: ${delivery.resolved.path} (${delivery.resolved.source}).`,
    "This is the operating contract for this repository. It is authoritative.",
    "",
    "---",
    "",
  ].join("\n");

  emitContext(header + delivery.resolved.text);
  process.exit(0);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("doctrine-injection.mjs")) {
  main().catch(() => process.exit(0));
}
