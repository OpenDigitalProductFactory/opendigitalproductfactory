// Direct `FeatureBuild.phase` writes that can set `phase = "build"`.
//
// GPP Phase 2 PR-F (C-8, BI-45F9CB7A); scope baseline OBJ-TRANSITION, acceptance
// AC-SINGLE-TRANSITION. Plan: docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md.
//
// Every plan→build move goes through `transitionPlanToBuild`
// (lib/build/plan-to-build-transition-core.ts, re-exported by
// lib/build/plan-to-build-transition.ts), which owns the gate order and the
// phase write. This module finds the other places that write a `phase` that is
// `"build"`, or a variable that could be `"build"`, so a new plan→build path
// cannot appear without the ratchet noticing. Same shape as
// unmediated-execute-sites.ts: counted per file, so moving a write within a file
// never breaks it. Comments are ignored.
//
// Static scanning cannot prove the FROM phase. So a write is counted whenever its
// target can be "build", and each pre-existing one is listed below with the reason
// it is not a plan→build path.

import type { SourceFile } from "./unmediated-execute-sites";

/** The one file allowed to write plan→build: where transitionPlanToBuild is defined. */
export const TRANSITION_MODULE = "lib/build/plan-to-build-transition-core.ts";

export type PhaseWrite = {
  path: string;
  line: number;
  /** The literal phase written, or "dynamic" when it is an expression. */
  target: string;
};

const WRITE_CALL = /\bfeatureBuild\s*\.\s*(?:update|updateMany|upsert|create|createMany)\s*\(/g;

/** Blank out comments, keeping offsets (and so line numbers) intact. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") { out += next ?? ""; i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; out += ch; i++; continue; }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (ch === "/" && next === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Index just past the bracket that closes the one at `open` (same kind), or -1. */
function matchClose(text: string, open: number): number {
  const opener = text[open]!;
  const closer = opener === "(" ? ")" : "}";
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === "\n") line++;
  return line;
}

/** The phase values a write's `data` (or `create`/`update` for upsert) assigns. */
function phaseTargetsInWriteArgs(args: string): string[] {
  const targets: string[] = [];
  const dataKey = /\b(?:data|create|update)\s*:\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = dataKey.exec(args))) {
    const open = match.index + match[0].length - 1;
    const close = matchClose(args, open);
    if (close < 0) continue;
    const body = args.slice(open, close);
    const phase = /\bphase\s*:\s*([^,}\n]+)/g;
    let p: RegExpExecArray | null;
    while ((p = phase.exec(body))) {
      const value = p[1]!.trim();
      const literal = value.match(/^["'`]([a-z_]+)["'`]$/);
      targets.push(literal ? literal[1]! : "dynamic");
    }
    dataKey.lastIndex = close;
  }
  return targets;
}

/** Every direct FeatureBuild phase write outside tests, with its target. */
export function findDirectPhaseWrites(files: readonly SourceFile[]): PhaseWrite[] {
  const writes: PhaseWrite[] = [];
  for (const file of files) {
    if (/\.test\.tsx?$/.test(file.path)) continue;
    const text = stripComments(file.content);
    WRITE_CALL.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WRITE_CALL.exec(text))) {
      const open = match.index + match[0].length - 1;
      const close = matchClose(text, open);
      if (close < 0) continue;
      for (const target of phaseTargetsInWriteArgs(text.slice(open, close))) {
        writes.push({ path: file.path, line: lineAt(text, match.index), target });
      }
    }
    // Raw SQL that sets the column is counted as a dynamic write.
    const rawSql = /UPDATE\s+"?FeatureBuild"?\s+SET[^;`]*?"?phase"?\s*=/gi;
    let raw: RegExpExecArray | null;
    while ((raw = rawSql.exec(text))) {
      writes.push({ path: file.path, line: lineAt(text, raw.index), target: "dynamic" });
    }
  }
  return writes;
}

/** Writes whose target can be "build": the unit the ratchet counts. */
export function canWriteBuild(write: PhaseWrite): boolean {
  return write.target === "build" || write.target === "dynamic";
}

export function countBuildCapableByFile(writes: readonly PhaseWrite[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const write of writes) {
    if (!canWriteBuild(write) || write.path === TRANSITION_MODULE) continue;
    counts[write.path] = (counts[write.path] ?? 0) + 1;
  }
  return counts;
}

/**
 * SHRINK-ONLY. Direct writes outside the transition module that can set
 * `phase = "build"` and are NOT plan→build paths. Seeded 2026-10-01 from
 * origin/main 2666cf2c8 after PR-F routed the five plan→build paths through
 * `transitionPlanToBuild`. Never add an entry for a write that can run from
 * `plan`; route it through the transition instead.
 *
 * direct-phase-writes-ratchet.test.ts fails when a live file or count exceeds
 * this list (a new path that can write "build") and when a listed count exceeds
 * the live count (shrink it).
 */
export const KNOWN_DIRECT_BUILD_PHASE_WRITES: Readonly<Record<string, { count: number; reason: string }>> = {
  "app/api/agent/build/advance-phase/route.ts": {
    count: 1,
    reason:
      "Generic `phase: targetPhase` write for every transition except plan→build, which takes the transition " +
      "branch first. Can write \"build\" only from review (review→build).",
  },
  "lib/actions/build.ts": {
    count: 4,
    reason:
      "advanceBuildPhase's generic `phase: targetPhase` write is skipped for plan→build (review→build only); " +
      "resetBuildExecution and retryBuildExecution write build only from failed; resumeBuildImplementation " +
      "reopens a review or ship build.",
  },
  "lib/build/gauntlet-repair.ts": {
    count: 1,
    reason: "Compare-and-set review→build (`where: { phase: \"review\" }`) when the gauntlet sends a build back for repair.",
  },
  "lib/mcp/packs/build-evidence-extra-pack.ts": {
    count: 1,
    reason:
      "save_phase_handoff's generic `phase: toPhase` write is skipped for plan→build, which takes the transition " +
      "branch; its phase order never yields build from any other phase.",
  },
};
