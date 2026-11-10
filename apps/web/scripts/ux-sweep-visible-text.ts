/**
 * Per-route visible-text diagnostics for the UX route sweep (BI-99909E53).
 *
 * The budget report carries COUNTS only, so a same-tree word-count flap
 * (/inventory 945 ↔ 946 across merge-group runs of one SHA) was undiagnosable
 * from CI — finding the moving words meant reproducing the route against a live
 * portal by hand. This writes the words the budget actually counted, in the
 * exact scope it counted them (default-visible, volatile text already
 * collapsed), one file per route, uploaded with the budget report. The next
 * flap is then a one-line diff between two runs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { visibleText } from "../lib/owner-first/ux-audit";
import { defaultVisibleHtml } from "../lib/ux-budget/scope";

export const VISIBLE_TEXT_REL = "apps/web/test-results/ux-route-sweep/visible-text";

/** File-safe name for a route path: `/workspace/inbox` → `workspace__inbox.txt`. */
export function visibleTextFileName(routePath: string): string {
  const slug = routePath.replace(/^\/+/, "").replace(/[^A-Za-z0-9._-]+/g, "__");
  return `${slug || "root"}.txt`;
}

/**
 * Persist one route's counted words. Diagnostic only — a write failure must
 * never cost the route its measurement.
 */
export function recordVisibleText(root: string, routePath: string, normalisedHtml: string): void {
  try {
    const dir = join(root, VISIBLE_TEXT_REL);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, visibleTextFileName(routePath)),
      `${visibleText(defaultVisibleHtml(normalisedHtml))}\n`,
      "utf8",
    );
  } catch (err) {
    console.error(`[ux-sweep] could not record visible text for ${routePath}: ${(err as Error).message}`);
  }
}
