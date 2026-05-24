/**
 * Detect whether the current process is running an autonomous session
 * (Build Studio executor, scheduled task, overnight loop) or an interactive
 * session (operator at a terminal).
 *
 * Spec: docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md §3.2
 *
 * Heuristic: DPF_AUTONOMOUS_SESSION_ID is set by Build Studio's executor
 * + scheduled-task runner at spawn time. It is NOT set when an operator
 * runs claude / codex from their terminal directly. The runtime gate uses
 * the result to pick interactiveMode (typed-confirm) vs autonomousMode
 * (refuse outright) per the principle's frontmatter.
 */

import type { SessionClass } from "./runtime-gate";

export function detectSessionClass(): SessionClass {
  return process.env.DPF_AUTONOMOUS_SESSION_ID ? "autonomous" : "interactive";
}
