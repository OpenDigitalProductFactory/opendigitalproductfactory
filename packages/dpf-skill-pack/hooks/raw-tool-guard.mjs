#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/raw-tool-guard.mjs
//
// PreToolUse guard (BI-F87BD9BF): refuse the RAW form of a command whose
// correct invocation in this repository carries a non-obvious wrapper, and
// print only the command to run instead.
//
// Why a hook and not prose: the knowledge already existed as prose — the
// header of scripts/run-tsc.mjs (BI-CD7706B5), a preflight warning
// (BI-99CAE42F), AGENTS.md §2 — and an agent that had read none of it ran
// `pnpm exec tsc --noEmit`, watched Node abort at its default 4 GB heap after
// 33 s, diagnosed an infrastructure error as if it were a code error, and
// retried. Every retry is paid for. A refusal that names the right command
// costs one line.
//
// Refused → redirected:
//   - bare `tsc` (also `pnpm exec tsc`, `pnpm tsc`, `npx tsc`)
//       → `pnpm --filter <pkg> typecheck` (scripts/run-tsc.mjs, 8 GB heap)
//   - `vitest` from the WORKSPACE ROOT with no `--filter <pkg>`
//       → `pnpm --filter <pkg> exec vitest run <files>` (a root-level run
//         prunes sibling links — BI-99CAE42F)
//   - `npx <anything>`
//       → the `pnpm --filter <pkg> exec <tool>` form (AGENTS.md §2: npx
//         ignores pinned versions)
//
// Allowed: `node scripts/run-tsc.mjs …`, `pnpm --filter <pkg> typecheck`,
// `pnpm --filter <pkg> exec vitest …`, `pnpm exec vitest` run from inside a
// package directory, and anything under DPF_ALLOW_RAW_TOOL=1 (bypass, when the
// raw form is the point — e.g. reproducing the OOM).
//
// Shipped inside the dpf-platform plugin (hooks/hooks.json, matcher "Bash") so
// it travels to every surface; mirrors compose-guard.mjs. Decision protocol:
// DENY = emit the PreToolUse permissionDecision JSON and exit 0; ALLOW = exit 0
// with no output. Fails OPEN on any parse/IO error.
import {
  readHookPayload,
  isShellTool,
  emitDeny,
  inDpfWorkspace,
  shellCommandFromInput,
} from "./lib/hook-io.mjs";

export const BYPASS_ENV = "DPF_ALLOW_RAW_TOOL";

const PACKAGE_DIR_RE = /(^|[\\/])(apps|packages|services)[\\/][^\\/]+[\\/]?$/;

/** Split a shell command on the operators that separate simple commands. */
function segments(command) {
  return String(command)
    .split(/\n|&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Whitespace tokens with leading VAR=value assignments removed. */
function tokenize(segment) {
  const tokens = segment.split(/\s+/).filter(Boolean);
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
  return tokens;
}

/** True when this segment is a raw TypeScript compiler invocation. */
function isRawTsc(tokens) {
  if (tokens.length === 0) return false;
  const exe = tokens[0].replace(/^.*[\\/]/, "");
  if (exe === "tsc") return true;
  if (exe === "npx" && tokens[1] === "tsc") return true;
  if (exe === "pnpm" || exe === "yarn" || exe === "npm") {
    // pnpm [--filter x] [exec|run|dlx] tsc …  — any position after the manager
    return tokens.slice(1).some((t, i, rest) => t === "tsc" && (i === 0 || ["exec", "run", "dlx", "--"].includes(rest[i - 1]) || !rest[i - 1].startsWith("-")));
  }
  return false;
}

function hasFilter(tokens) {
  return tokens.some((t) => t === "--filter" || t === "-F" || t.startsWith("--filter="));
}

/** True when this segment runs vitest without a package scope. */
function isRootVitest(tokens, cwd) {
  if (tokens.length === 0) return false;
  const exe = tokens[0].replace(/^.*[\\/]/, "");
  const runsVitest = exe === "vitest" || (["pnpm", "npx", "yarn", "npm"].includes(exe) && tokens.slice(1).includes("vitest"));
  if (!runsVitest) return false;
  if (hasFilter(tokens)) return false;
  if (PACKAGE_DIR_RE.test(String(cwd ?? "").replace(/[\\/]+$/, ""))) return false; // inside a package dir
  if (tokens.some((t) => t === "-C" || t === "--dir" || t.startsWith("--dir="))) return false; // pnpm -C <pkg>
  return true;
}

function isNpx(tokens) {
  return tokens.length > 0 && tokens[0].replace(/^.*[\\/]/, "") === "npx";
}

const TSC_GUIDANCE =
  "Refused: a bare `tsc` runs at Node's default heap and aborts out of memory on this codebase (BI-CD7706B5).\n" +
  "Run instead:  pnpm --filter <pkg> typecheck     (scripts/run-tsc.mjs raises the heap to 8 GB; add :tests for the test program)\n" +
  `Raw form on purpose?  prefix with ${BYPASS_ENV}=1`;

const VITEST_GUIDANCE =
  "Refused: vitest from the workspace root without --filter prunes sibling links and runs the wrong config (BI-99CAE42F).\n" +
  "Run instead:  pnpm --filter <pkg> exec vitest run <files>     (e.g. --filter web)\n" +
  `Raw form on purpose?  prefix with ${BYPASS_ENV}=1`;

const NPX_GUIDANCE =
  "Refused: npx ignores the pinned versions in this workspace (AGENTS.md §2).\n" +
  "Run instead:  pnpm --filter <pkg> exec <tool> …     (or pnpm exec <tool> inside the package directory)\n" +
  `Raw form on purpose?  prefix with ${BYPASS_ENV}=1`;

/**
 * Pure decision. Exported for unit tests.
 * @param {{ command: string, cwd?: string, env?: Record<string, string|undefined> }} args
 * @returns {{ block: boolean, reason?: string }}
 */
export function decide({ command, cwd = "", env = {} }) {
  if (typeof command !== "string" || command.trim() === "") return { block: false };
  if (env[BYPASS_ENV] === "1" || new RegExp(`\\b${BYPASS_ENV}=1\\b`).test(command)) return { block: false };
  for (const seg of segments(command)) {
    const tokens = tokenize(seg);
    if (isRawTsc(tokens)) return { block: true, reason: TSC_GUIDANCE };
    if (isRootVitest(tokens, cwd)) return { block: true, reason: VITEST_GUIDANCE };
    if (isNpx(tokens)) return { block: true, reason: NPX_GUIDANCE };
  }
  return { block: false };
}

function main() {
  const payload = readHookPayload();
  if (payload === null) process.exit(0);
  if (!inDpfWorkspace(payload.cwd)) process.exit(0);
  if (!isShellTool(payload.toolName)) process.exit(0);
  const command = shellCommandFromInput(payload.toolInput);
  const verdict = decide({ command, cwd: payload.cwd, env: process.env });
  if (!verdict.block) process.exit(0);
  emitDeny(verdict.reason);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("raw-tool-guard.mjs")) {
  main();
}
