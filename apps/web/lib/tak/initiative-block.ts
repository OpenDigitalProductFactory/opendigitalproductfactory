// apps/web/lib/tak/initiative-block.ts
//
// BI-E35A8AA4. The per-turn INITIATIVE contract injected into every in-portal
// coworker's system prompt, on BOTH the unified prompt-assembler path and the
// legacy persona path (surface-uniform with the decision-routing block).
//
// The coworker's Proactivity setting (quiet | balanced | assertive) used to
// affect ONLY notification cadence — the resolved proactivity plan never
// reached prompt assembly, so the coworker worked exactly as hard at "assertive"
// as at "quiet". This block makes the level modulate in-task initiative: how
// hard the coworker tries to close a gap with its own tools before handing back,
// and how readily it takes the next well-supported action.
//
// It shapes EFFORT only. It never widens authority, never overrides the
// advise/act mode gate, never licenses fabricating a missing value, and never
// sends anything externally — the assertive text re-states those bounds so a
// higher initiative level cannot be misread as permission to overreach.
//
// See docs/superpowers/specs/2026-07-03-proactivity-drives-in-task-initiative.md

import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";

const QUIET_BLOCK = `INITIATIVE — LOW (Quiet posture).
Do what the employee asked, then stop. Do not chase missing details or take extra steps beyond the request — surface what you found and let the employee drive the next move. Ask at most one short question, and only when the task genuinely cannot proceed without it.`;

const BALANCED_BLOCK = `INITIATIVE — MEDIUM (Balanced posture).
Take the next well-supported action rather than narrating it. If a needed detail is missing, make a reasonable effort to recover it yourself first (a quick lookup with your tools) before asking. Batch anything you still need into one short question, and offer the following step so the work keeps moving.`;

const ASSERTIVE_BLOCK = `INITIATIVE — HIGH (Assertive posture).
Drive the task to completion. When something is missing, exhaust the means you have to close the gap yourself first — research it, derive it, or look it up with your tools — and ask the employee ONLY for what you genuinely could not obtain, stating plainly what you already recovered. Once the request is done, take the next well-supported action that advances the goal without waiting to be told. This raises your EFFORT, not your authority: never invent a value to avoid asking, never exceed the employee's granted permissions or your current mode, and never send anything to a customer or external party on your own — those bounds hold at every posture.`;

const BLOCKS: Record<ProactivityLevel, string> = {
  quiet: QUIET_BLOCK,
  balanced: BALANCED_BLOCK,
  assertive: ASSERTIVE_BLOCK,
};

/**
 * The initiative directive for a coworker's Proactivity level. `null` (no saved
 * preference) resolves to `balanced` — the dock's effective default — so the
 * block always matches the level the employee sees.
 */
export function buildInitiativeBlock(level: ProactivityLevel | null | undefined): string {
  return BLOCKS[level ?? "balanced"];
}
