#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/work-shape-banner.mjs
//
// SessionStart hook (BI-21B04901): state the work shape, in order, with the
// live status of each step for THIS session.
//
// WHY
// Six SessionStart hooks already spoke, each an independent paragraph in
// platform jargon, and none of them stated the required sequence. A thread
// could not answer "what am I required to do before I edit?" from what it was
// shown. Operator direction 2026-08-22: the work shape must be 100%
// understandable and obvious, followed and enforced wherever possible.
//
// This hook is the READABLE face of hooks/lib/thread-conformance.mjs. The
// PreToolUse guards (BI-865E1755) are the ENFORCING face of the same module,
// so what a thread is told and what it is blocked on cannot diverge.
//
// FAIL-OPEN AT THE HOOK BOUNDARY, FAIL-CLOSED IN THE VERDICT.
// A banner that breaks session start is worse than the silence it replaces, so
// every error path exits 0 silently. That is NOT a governance decision: the
// verdict itself treats `unknown` as not-passing, and the guards enforce it.
//
// READ-ONLY. No writes, no repairs.

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

function sessionCwd(payload) {
  return payload.cwd || payload.workspaceRoot || payload.workspace_root || process.cwd();
}

function emitContext(text) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }),
  );
}

async function main() {
  if (process.env.DPF_SKIP_WORK_SHAPE_BANNER === "1") process.exit(0);

  const payload = readPayload();
  const cwd = sessionCwd(payload);
  if (!inDpfWorkspace(cwd)) process.exit(0);

  const mod = await import(pathToFileURL(join(hooksDir, "lib/thread-conformance.mjs")).href);
  const result = await mod.evaluateThreadConformance({ cwd });

  // Unlike the readiness banner, this one speaks even when everything passes.
  // "5 of 5 ready" is the confirmation that the sequence was followed; silence
  // on success is what let an ungoverned session look identical to a governed
  // one for the first several turns.
  emitContext(mod.formatWorkShapeBanner(result).join("\n"));
  process.exit(0);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("work-shape-banner.mjs")) {
  main().catch(() => process.exit(0));
}
