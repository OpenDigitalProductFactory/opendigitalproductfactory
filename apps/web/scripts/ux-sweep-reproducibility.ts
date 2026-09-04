// apps/web/scripts/ux-sweep-reproducibility.ts
//
// The confirm pass for the route sweep (BI-69FE5504). Extracted from the driver
// so ux-route-sweep.ts stays under the module soft ceiling and so this is
// testable without Playwright: the caller owns measuring, this owns the
// decision of what a second measurement means.
//
// Why a second pass at all — and why "did not reproduce" is not a pass — is
// documented once on findNotReproducibleBlocking in lib/ux-budget/ratchet.ts.

import { findNotReproducibleBlocking } from "../lib/ux-budget/ratchet";

/** Outcome of re-measuring the routes that blocked on the first pass. */
export type ConfirmPass = {
  /** Routes that produced a blocking verdict again. */
  blocking: readonly string[];
  /** Routes the confirm pass could not measure at all. */
  unmeasured: readonly string[];
};

/**
 * Re-measure the routes that blocked, and return those whose blocking verdict
 * did not survive. Returns [] when nothing blocked, so the caller can always
 * call it unconditionally.
 */
export async function confirmBlockingRoutes<Row extends { routePath: string }>(input: {
  rows: readonly Row[];
  firstPassBlocking: readonly string[];
  remeasure: (rows: readonly Row[]) => Promise<ConfirmPass>;
  onConfirmStart?: (count: number) => void;
}): Promise<string[]> {
  const blocking = new Set(input.firstPassBlocking);
  if (blocking.size === 0) return [];
  const confirmRows = input.rows.filter((row) => blocking.has(row.routePath));
  if (confirmRows.length === 0) return [];
  input.onConfirmStart?.(confirmRows.length);
  const confirmed = await input.remeasure(confirmRows);
  return findNotReproducibleBlocking({
    firstPassBlocking: [...blocking],
    confirmPassBlocking: confirmed.blocking,
    unmeasuredOnConfirm: confirmed.unmeasured,
  });
}
