#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/pregate-evidence-guard.mjs
//
// PreToolUse guard (BI-563F6AB6 P2): refuse git push / gh pr create when the
// worktree has no unexpired SHA-bound local-CI sandbox evidence for HEAD.
//
// Git's pre-push-gate already blocks many host-side pushes, but agents can
// still open PRs or push in ways that skip hooks (or skip pr:health entirely).
// This guard runs on Claude/Codex/Grok PreToolUse (Bash/Shell) so the peer
// surface that finishes "too fast" without pregate is denied at the tool edge.
//
// Fail OPEN on parse/IO errors (never wedge the session). Deny only when we
// can positively identify a publish command and positively lack evidence.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

import {
  readHookPayload,
  isShellTool,
  emitDeny,
  inDpfWorkspace,
  shellCommandFromInput,
} from "./lib/hook-io.mjs";
import { executableCommandText } from "./command-text.mjs";
import { classifyLocalCiOverride } from "./lib/local-ci-override.mjs";

/** Commands that publish runtime code and must carry pregate evidence. */
const PUBLISH_PATTERNS = [
  /\bgit\s+push\b/,
  /\bgh\s+pr\s+create\b/,
];

const BYPASS_MARKERS = [
  /DPF_PREPUSH_GATE_INFLIGHT=1/,
  /DPF_ALLOW_UNGATED_PUSH=1/,
  /gate-worktree\.(sh|mjs)/,
  /pnpm\s+run\s+pregate\b/,
  /pnpm\s+pregate\b/,
];

const GUIDANCE =
  "Publish blocked — no local-CI sandbox evidence for this branch HEAD (BI-563F6AB6). " +
  "AGENTS.md requires runtime-bound gates via the shared lease; worktree vitest alone is not enough. " +
  "Run: pnpm run pregate  (claims local-integration-ci, records SHA-bound evidence). " +
  "Then re-try git push / gh pr create. " +
  "Emergency (closed code only): DPF_SKIP_PREPUSH_GATE=1 DPF_SKIP_PREPUSH_GATE_REASON=\"operator-emergency: <why>\" git push " +
  "or prefix the command with DPF_ALLOW_UNGATED_PUSH=1 (audited; pr:health still enforces allowlisted override).";

/**
 * @param {string} cwd
 * @returns {{ branch: string, sha: string, statePath: string, topLevel: string } | null}
 */
export function readGitHead(cwd) {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const statePath = execFileSync("git", ["rev-parse", "--git-path", "dpf-local-ci-gate.json"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const absState = statePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(statePath)
      ? statePath
      : join(cwd, statePath);
    let topLevel = "";
    try {
      topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      topLevel = "";
    }
    return { branch, sha, statePath: absState, topLevel };
  } catch {
    return null;
  }
}

/**
 * BI-5529B5AC. Gate state is written PER SLOT: slot-0 writes
 * `dpf-local-ci-gate.json`, slot-1 writes `dpf-local-ci-gate-slot-1.json`
 * (scripts/lib/local-ci-slot-manifest.mjs). This hook used to open only the
 * slot-0 file, so a PASS earned on slot-1 was invisible and the only way past
 * was an override — the same decay the git hook paid for under BI-A167CF8A.
 *
 * The verdict rules live in ONE reader, scripts/pregate-status.mjs (the git
 * pre-push hook already defers to it). When that reader is present in the
 * worktree it IS the answer (kernel DI-C799769FCDC5). This plugin also ships
 * to installs that carry no scripts/ tree, so when the reader is absent the
 * hook falls back to reading every slot record beside the slot-0 path and
 * accepting any that passes for HEAD. A recorded, allowlisted override is a
 * hook-level concept the reader does not grade, so it is honoured on either
 * path.
 */
const SLOT_STATE_FILE = /^dpf-local-ci-gate(-slot-\d+)?\.json$/;

function readCanonicalVerdict(readerPath, cwd, spawnImpl) {
  if (!readerPath || !existsSync(readerPath)) return null;
  try {
    const result = spawnImpl(process.execPath, [readerPath, "--json"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
    });
    const parsed = JSON.parse(String(result.stdout || "").trim() || "null");
    if (!parsed || typeof parsed.verdict !== "string") return null;
    return parsed;
  } catch {
    // An unreadable reader is not a verdict either way; fall through to the
    // per-slot records so a broken script never wedges a publish.
    return null;
  }
}

function listSlotStateFiles(statePath) {
  const dir = dirname(statePath);
  let names = [];
  try {
    names = readdirSync(dir).filter((name) => SLOT_STATE_FILE.test(name));
  } catch {
    names = [];
  }
  // slot-0 first so the legacy message is preserved when nothing else exists.
  names.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return names.map((name) => join(dir, name));
}

/**
 * @param {{ sha: string, statePath: string, topLevel?: string }} head
 * @param {{ cwd?: string, readerPath?: string, spawnImpl?: typeof spawnSync }} [opts]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function evaluateGateVerdict(head, opts = {}) {
  const cwd = opts.cwd || head.topLevel || process.cwd();
  const readerPath = opts.readerPath !== undefined
    ? opts.readerPath
    : (head.topLevel ? join(head.topLevel, "scripts", "pregate-status.mjs") : "");
  const canonical = readCanonicalVerdict(readerPath, cwd, opts.spawnImpl || spawnSync);
  if (
    canonical
    && canonical.verdict === "PASS"
    && (!canonical.headSha || !head.sha || canonical.headSha === head.sha)
  ) {
    return { ok: true };
  }

  const files = listSlotStateFiles(head.statePath);
  if (files.length === 0) {
    return evaluateGateRecord(head.statePath, head.sha);
  }
  let firstMiss = null;
  for (const file of files) {
    const verdict = evaluateGateRecord(file, head.sha);
    if (verdict.ok) return verdict;
    if (!firstMiss) firstMiss = verdict;
  }
  if (canonical && canonical.reason) {
    return { ok: false, reason: `pregate:status ${canonical.verdict} — ${canonical.reason}` };
  }
  return firstMiss || { ok: false, reason: "gate record present but not passed" };
}

/**
 * @param {string} statePath
 * @param {string} headSha
 * @returns {{ ok: boolean, reason?: string }}
 */
export function evaluateGateRecord(statePath, headSha) {
  if (!existsSync(statePath)) {
    return { ok: false, reason: "no dpf-local-ci-gate.json for this worktree" };
  }
  let rec;
  try {
    rec = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return { ok: false, reason: "unreadable dpf-local-ci-gate.json" };
  }
  if (!rec || typeof rec !== "object") {
    return { ok: false, reason: "invalid gate record" };
  }
  if (rec.sha && headSha && rec.sha !== headSha) {
    return {
      ok: false,
      reason: `gate record SHA ${String(rec.sha).slice(0, 12)} ≠ HEAD ${headSha.slice(0, 12)} — re-run pregate`,
    };
  }
  if (rec.gatePassed === true) {
    if (rec.expiresAt) {
      const exp = Date.parse(rec.expiresAt);
      if (Number.isFinite(exp) && exp < Date.now()) {
        return { ok: false, reason: "local-CI gate record expired — re-run pregate" };
      }
    }
    return { ok: true };
  }
  if (rec.skipped && rec.skipReason) {
    const c = classifyLocalCiOverride(rec.skipReason);
    if (c.ok) return { ok: true };
    return { ok: false, reason: c.reason };
  }
  return { ok: false, reason: "gate record present but not passed" };
}

/**
 * Pure-ish decision for tests. `git` helpers injectable.
 * @param {string} command
 * @param {Record<string, string|undefined>} env
 * @param {{ cwd?: string, head?: { branch: string, sha: string, statePath: string } | null }} [opts]
 */
export function decide(command, env = {}, opts = {}) {
  if (typeof command !== "string" || command.trim() === "") return { block: false };
  if (env.DPF_ALLOW_UNGATED_PUSH === "1") return { block: false };
  if (env.DPF_PREPUSH_GATE_INFLIGHT === "1") return { block: false };
  if (BYPASS_MARKERS.some((re) => re.test(command))) return { block: false };

  const execText = executableCommandText(command);
  const isPublish = PUBLISH_PATTERNS.some((re) => re.test(execText));
  if (!isPublish) return { block: false };

  // Explicit skip in the command line (mirrors git pre-push env).
  if (
    /DPF_SKIP_PREPUSH_GATE=1/.test(command) ||
    env.DPF_SKIP_PREPUSH_GATE === "1"
  ) {
    const reasonMatch =
      command.match(/DPF_SKIP_PREPUSH_GATE_REASON=(?:"([^"]+)"|'([^']+)'|(\S+))/) ||
      null;
    const reason =
      reasonMatch?.[1] ||
      reasonMatch?.[2] ||
      reasonMatch?.[3] ||
      env.DPF_SKIP_PREPUSH_GATE_REASON ||
      "";
    const c = classifyLocalCiOverride(reason);
    if (c.ok) return { block: false };
    return {
      block: true,
      reason:
        `Publish blocked — DPF_SKIP_PREPUSH_GATE requires an allowlisted reason code. ${c.reason}`,
    };
  }

  const cwd = opts.cwd || process.cwd();
  const head = opts.head !== undefined ? opts.head : readGitHead(cwd);
  if (!head) {
    // Not a git worktree or git missing — fail open (pre-push hook / CI still apply).
    return { block: false };
  }
  if (head.branch === "main" || head.branch === "HEAD") {
    return { block: false };
  }

  const gate = evaluateGateVerdict(head, { cwd: head.topLevel || cwd });
  if (gate.ok) return { block: false };
  return {
    block: true,
    reason: `${GUIDANCE} (${gate.reason})`,
  };
}

function main() {
  const payload = readHookPayload();
  if (payload === null) process.exit(0);
  if (!inDpfWorkspace(payload.cwd)) process.exit(0);
  if (!isShellTool(payload.toolName)) process.exit(0);

  const command = shellCommandFromInput(payload.toolInput);
  const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();
  const verdict = decide(command, process.env, { cwd });
  if (!verdict.block) process.exit(0);
  emitDeny(verdict.reason);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("pregate-evidence-guard.mjs")) {
  main();
}
