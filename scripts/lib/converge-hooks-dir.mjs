// Converge one repository's .githooks directory to the tracked, enforcing hooks.
//
// WHY THIS IS SHARED (BI-3727106F)
//   Two callers need identical convergence semantics:
//     1. scripts/set-hooks-path.mjs        — install time (pnpm postinstall)
//     2. scripts/hooks/converge-git-hooks.mjs — session start, incl. sibling sweep
//   Keeping the sequencing in one place is the single-source-of-truth rule
//   applied to enforcement: two copies drift, and a drifted copy of a GATE
//   installer is indistinguishable from a working one until a push slips
//   through ungated. That is exactly how BI-5CBDC146 stayed invisible.
//
// THE HAZARD THIS GUARDS
//   The generated pre-push shim does `exec sh .githooks/lib/pre-push-chained.sh`.
//   Writing that shim into a tree whose checkout PREDATES pre-push-chained.sh
//   would make every push in that tree fail with "No such file or directory".
//   So convergence is refused — reported as `chain-absent`, never written —
//   unless the tracked chained script is actually present. A tree on an old
//   base is told to refresh, not broken.

import fs from "node:fs";
import path from "node:path";

import { ensurePrePushHook } from "./ensure-pre-push-hook.mjs";
import { ensurePostCheckoutHook } from "./ensure-post-checkout-hook.mjs";

/** Tracked script the generated pre-push shim delegates to. */
export const CHAINED_PRE_PUSH_REL = path.join("lib", "pre-push-chained.sh");

/**
 * Is this hooks dir safe to converge? A shim that delegates to an absent
 * script is worse than no shim: it breaks push instead of merely not gating.
 * @param {string} hooksDir
 * @param {{ existsSync?: (p: string) => boolean }} [io]
 */
export function canConverge(hooksDir, io = {}) {
  const exists = io.existsSync ?? fs.existsSync;
  return exists(path.join(hooksDir, CHAINED_PRE_PUSH_REL));
}

/**
 * Converge a single .githooks directory.
 *
 * Never throws: a hook that breaks session start is a worse defect than the
 * one it fixes. Every failure mode is returned as data so the caller can
 * report it — silence is what hid BI-5CBDC146 for the life of the script.
 *
 * @param {string} hooksDir absolute path to a `.githooks` directory
 * @returns {{ hooksDir: string, prePush: string, postCheckout: string, error?: string }}
 *   prePush/postCheckout are 'written' | 'unchanged' | 'left-custom' |
 *   'chain-absent' | 'error'.
 */
export function convergeHooksDir(hooksDir) {
  if (!canConverge(hooksDir)) {
    return { hooksDir, prePush: "chain-absent", postCheckout: "chain-absent" };
  }
  let prePush = "error";
  let postCheckout = "error";
  let error;
  try {
    prePush = ensurePrePushHook(hooksDir).action;
  } catch (err) {
    error = err?.message ?? String(err);
  }
  try {
    postCheckout = ensurePostCheckoutHook(hooksDir).action;
  } catch (err) {
    error ??= err?.message ?? String(err);
  }
  return error ? { hooksDir, prePush, postCheckout, error } : { hooksDir, prePush, postCheckout };
}

/**
 * One-line human summary of a sweep. Reports repairs and refusals; stays
 * quiet-but-truthful when everything was already converged.
 * @param {Array<ReturnType<typeof convergeHooksDir>>} results
 */
export function summarizeConvergence(results) {
  const count = (action) => results.filter((r) => r.prePush === action).length;
  const repaired = count("written");
  const chainAbsent = count("chain-absent");
  const custom = count("left-custom");
  const errored = count("error");
  const parts = [`${results.length} tree(s) checked`];
  if (repaired) parts.push(`${repaired} pre-push gate(s) REPAIRED`);
  if (custom) parts.push(`${custom} custom hook(s) left untouched`);
  if (chainAbsent) parts.push(`${chainAbsent} skipped (base predates the chained gate — refresh from origin/main)`);
  if (errored) parts.push(`${errored} FAILED`);
  return parts.join(", ");
}
