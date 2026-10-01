#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/decision-routing-guard.mjs
//
// PreToolUse guard (BI-383668B9, EP-5560770F — Gate A of the harness-enforced
// decision-routing + lease-punt spec, docs/superpowers/specs/2026-07-03-...).
//
// `consult-scopes-before-asking` is a COMMANDMENT: before asking a human to
// choose on a platform/build decision, an agent must consult the governed scope
// (WWMD / principle_decide via dpf-decision-via-kernel) and act on a
// high-confidence recommendation; it escalates to the human only if the kernel
// returns low confidence or flags a commandment conflict. Until now this lived
// only in prose + skill guidance, so a session could — and did — skip straight
// to a numbered menu ("Option 3 it is").
//
// This guard blocks an AskUserQuestion that presents a platform/build DECISION
// (2+ options in engineering approach/architecture vocabulary) with no evidence
// of a kernel consultation. The block mode (vs a soft nudge) is the founder
// kernel's own high-confidence recommendation for this choice (principle_decide,
// 2026-07-03: hard_block composite 4.54 vs warn 3.78, margin 0.75).
//
// False-positive control is the NARROW scope, not the block strength: the guard
// trips on codebase-decision signals, so operator-owned questions (naming,
// branding, business strategy) do not match and are never blocked. Two
// escapes remain: (a) once the agent HAS consulted and is legitimately surfacing
// a low-confidence/defer result, its question references the ledger
// (principle_decide / composite / margin) and is allowed; (b) explicit bypass via
// the DPF_ALLOW_DIRECT_ASK=1 env var or a `[direct-ask]` / `[operator-owned]`
// token in the question. Fails OPEN on any error.
//
// Decision protocol mirrors lease-guard.mjs (deny + reason, exit 0).

import { readHookPayload, isDecisionTool, emitDeny, inDpfAgentHost } from "./lib/hook-io.mjs";
// The vocabulary is shared with the prose-channel Stop guard (BI-E4DE3825) so
// the two channels cannot drift apart: lib/decision-signals.mjs is its home.
import { ALL_SIGNALS, BYPASS_TOKEN, LEDGER_MARKERS } from "./lib/decision-signals.mjs";

const GUIDANCE =
  "Decision-routing gate (BI-383668B9): this looks like a platform/build decision with multiple options, asked of the operator without a kernel consultation. " +
  "`consult-scopes-before-asking` is a commandment — route it through the kernel FIRST: dpf-decision-via-kernel -> principle_decide. Act on a high-confidence recommendation; do not ask. " +
  "Only surface to the operator if the kernel returns low confidence (margin < tieMargin) or a commandment conflict — and when you do, include the ledger (composite/margin) in the question so this gate recognizes the legitimate escalation. " +
  "For a genuinely operator-owned call (naming, branding, business strategy), bypass with DPF_ALLOW_DIRECT_ASK=1 or a `[operator-owned]` tag in the question.";

/**
 * Pure decision: should this AskUserQuestion be blocked? Exported for tests.
 * @param {string} toolName
 * @param {{ questions?: Array<{question?:string, header?:string, options?:Array<{label?:string,description?:string}>}> }} toolInput
 * @param {Record<string,string|undefined>} env
 * @returns {{ block: boolean, reason?: string, header?: string }}
 */
export function decide(toolName, toolInput = {}, env = {}) {
  if (!isDecisionTool(toolName)) return { block: false };
  if (env.DPF_ALLOW_DIRECT_ASK === "1") return { block: false };
  const questions = Array.isArray(toolInput?.questions) ? toolInput.questions : [];
  for (const q of questions) {
    const options = Array.isArray(q?.options) ? q.options : [];
    if (options.length < 2) continue; // single-path / factual clarification
    const text = [
      q?.question,
      q?.header,
      ...options.map((o) => `${o?.label ?? ""} ${o?.description ?? ""}`),
    ]
      .filter(Boolean)
      .join(" ");
    if (BYPASS_TOKEN.test(text)) continue;
    if (LEDGER_MARKERS.some((re) => re.test(text))) continue; // consulted → surfacing
    if (ALL_SIGNALS.some((re) => re.test(text))) {
      return { block: true, reason: GUIDANCE, header: q?.header };
    }
  }
  return { block: false };
}

function main() {
  const payload = readHookPayload();
  if (payload === null) process.exit(0); // fail open on read/parse error
  // A checkout OR an install folder: sessions start in the install (BI-310949BC).
  if (!inDpfAgentHost(payload.cwd)) process.exit(0);

  // Operator-decision tool across surfaces (AskUserQuestion / AskQuestion).
  if (!isDecisionTool(payload.toolName)) process.exit(0);
  const verdict = decide(payload.toolName, payload.toolInput ?? {}, process.env);
  if (!verdict.block) process.exit(0);

  emitDeny(verdict.reason); // dual-envelope deny — blocks on every surface
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("decision-routing-guard.mjs")) {
  main();
}
