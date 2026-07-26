import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// BI-6EC1EE25. Clearing a decision gate requires TWO things
// (interactionWasCleared in decision-perspective/persistence.ts): a matching
// EscalationCapture/DeferralCapture row AND humanOutcome.clearsGate === true.
// If a code path sets clearsGate truthy WITHOUT writing a capture row, that
// decision reads "resolved" to the review queue while remaining un-cleared for
// gate purposes — a real build gate could then be dequeued-from-review while
// still blocking the build, invisibly. No path in main does this today (the 25
// live cases came from an out-of-band DB write), and both sanctioned writers
// create the capture and set clearsGate atomically in one transaction. This
// ratchet keeps it that way: a future writer that sets clearsGate truthy must
// also create a capture row.

const here = dirname(fileURLToPath(import.meta.url));
const LIB_ROOT = join(here, "..");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...tsFiles(full));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

const WRITES_A_CAPTURE = /(escalationCapture|deferralCapture)\.create\b/;

function relativeSourcePath(file: string): string {
  return relative(LIB_ROOT, file).replaceAll("\\", "/");
}

/**
 * True when a source file contains a `clearsGate:` write whose value is not the
 * literal `false` — i.e. `clearsGate: true` or a dynamic expression that can
 * evaluate true. Captures the first token after the colon so `clearsGate: false`
 * is exempt but `clearsGate: row.outcomeType === "escalate"` is caught.
 */
function setsClearsGateTruthy(src: string): boolean {
  const re = /clearsGate:\s*([A-Za-z0-9_$]+)/g;
  for (const match of src.matchAll(re)) {
    if (match[1] !== "false") return true;
  }
  return false;
}

describe("gate-clear write invariant (BI-6EC1EE25)", () => {
  it("only sets clearsGate truthy in a file that also creates a capture row", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(LIB_ROOT)) {
      const src = readFileSync(file, "utf8");
      if (!setsClearsGateTruthy(src)) continue;
      if (!WRITES_A_CAPTURE.test(src)) {
        offenders.push(relativeSourcePath(file));
      }
    }
    expect(
      offenders,
      `these files set humanOutcome.clearsGate truthy without creating an ` +
        `EscalationCapture/DeferralCapture row — a gate would read resolved-to-review ` +
        `while still blocking (BI-6EC1EE25): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("recognises the two sanctioned writers so the ratchet is proven live", () => {
    // Guards against the regex silently matching nothing (e.g. a rename) and the
    // invariant passing vacuously.
    const writers = tsFiles(LIB_ROOT).filter((f) => setsClearsGateTruthy(readFileSync(f, "utf8")));
    const rel = writers.map(relativeSourcePath).sort();
    expect(rel).toEqual([
      "actions/decision-perspective.ts",
      "actions/org-decision-capture.ts",
    ]);
  });
});
