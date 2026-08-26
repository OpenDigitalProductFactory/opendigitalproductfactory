import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// BI-CE93E314. BI-463BE12A shipped prompt provenance and wired it into exactly
// one of seven entry points. It merged, deployed, and changed nothing: on the
// live install, ZERO turns carried instruction spans, because the coworkers that
// were broken run on the SCHEDULED path, not on interactive chat.
//
// The failure was silent by construction. A caller that declares nothing is not
// an error — it means "the whole prompt is the turn's data", which is the safe
// default and exactly why nobody notices. So the coverage has to be asserted,
// not remembered.
//
// This test enumerates every call site that starts an agentic turn and requires
// each one to have made a provenance decision. To add a caller, either pass
// `systemPromptInstructionSpans`, or add it to DELIBERATELY_UNDECLARED below
// with a reason. Both are fine; silence is not.

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const LOOP_ENTRY = /\b(?:runAgenticLoop|executeAutonomousAgenticLoop)\(\{/;

/**
 * Call sites that intentionally declare nothing, with why. A prompt built
 * entirely from the turn's own data has no instruction span to name, and
 * declaring one would be the egress hole this whole mechanism exists to close.
 */
const DELIBERATELY_UNDECLARED: Record<string, string> = {
  // Re-dispatches a prompt its caller already built and already declared for.
  "apps/web/lib/tak/autonomous-work-run.ts":
    "forwards input.systemPromptInstructionSpans from its caller",
};

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "apps/web/**/*.ts"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\n")
    .filter((f) => f && !f.includes(".test.") && !f.endsWith(".d.ts"));
}

describe("every agentic-turn entry point has decided its prompt provenance", () => {
  const callers = trackedFiles().filter((file) =>
    LOOP_ENTRY.test(readFileSync(join(REPO_ROOT, file), "utf8")),
  );

  it("finds the call sites at all, so a rename cannot quietly empty this test", () => {
    // If the loop entry points are renamed, this list goes to zero and every
    // assertion below passes vacuously. Fail loudly instead.
    expect(callers.length).toBeGreaterThanOrEqual(6);
  });

  it.each(callers.map((f) => [f]))("%s declares provenance or says why not", (file) => {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    const declares = source.includes("systemPromptInstructionSpans");
    const exempt = Object.hasOwn(DELIBERATELY_UNDECLARED, file);

    expect(
      declares || exempt,
      `${file} starts an agentic turn without deciding prompt provenance.\n` +
        "Pass systemPromptInstructionSpans naming the platform-authored spans of " +
        "the system prompt, or add this file to DELIBERATELY_UNDECLARED with a " +
        "reason. Declaring nothing means the whole prompt is screened as the " +
        "turn's data, which pins finance- and people-facing coworkers to " +
        "local-only routing (BI-463BE12A).",
    ).toBe(true);
  });

  it("keeps the exemption list honest — no entries for files that are gone", () => {
    for (const file of Object.keys(DELIBERATELY_UNDECLARED)) {
      expect(callers, `${file} is exempted but no longer starts an agentic turn`)
        .toContain(file);
    }
  });
});
