import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ratchet for the Work Atlas rule "one health vocabulary" (BI-930A4C88): a new
 * file must not invent its own working / waiting / attention grouping. Group
 * rooms by health through `classifyAtlasHealth` in `atlas-health.ts` and keep
 * only labels locally. The allowlist holds files that already declare such
 * literals; it may only shrink.
 */
const WEB_ROOT = join(__dirname, "..", "..");
const SCANNED = ["lib", "components"];

const ALLOWED = new Set([
  // The shared vocabulary and its two workroom adapters.
  "lib/work-management/atlas-health.ts",
  "lib/work-capsules/workroom-operator-summary.ts",
  "lib/work-capsules/delivery-task-hub.ts",
  // Labels over the adapters; WorkroomInventory is retired by Work Atlas A2.
  "components/build/work-control/DeliveryTaskHub.tsx",
  "components/ops/workrooms/WorkroomInventory.tsx",
  // Other subjects (participants, semantic review runs), not workroom health.
  "lib/work-management/room-types.ts",
  "lib/work-management/room-participation-prisma.server.ts",
  "lib/work-capsules/workroom-recovery-projection.ts",
]);

const WORKING = /["']working["']/;
const WAITING = /["']waiting["']/;
const ATTENTION = /["'](needs-attention|attention|needs-you|stuck|blocked|needs-person)["']/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("one workroom health vocabulary", () => {
  it("no new file declares its own working / waiting / attention grouping", () => {
    const offenders = SCANNED.flatMap((dir) => sourceFiles(join(WEB_ROOT, dir)))
      .filter((path) => {
        const text = readFileSync(path, "utf8");
        return WORKING.test(text) && WAITING.test(text) && ATTENTION.test(text);
      })
      .map((path) => relative(WEB_ROOT, path).split("\\").join("/"))
      .filter((path) => !ALLOWED.has(path));
    expect(offenders, "Group workrooms by health through classifyAtlasHealth (lib/work-management/atlas-health.ts)").toEqual([]);
  });

  it("the allowlist only names files that still exist", () => {
    const missing = [...ALLOWED].filter((path) => {
      try { return !statSync(join(WEB_ROOT, path)).isFile(); } catch { return true; }
    });
    expect(missing).toEqual([]);
  });
});
