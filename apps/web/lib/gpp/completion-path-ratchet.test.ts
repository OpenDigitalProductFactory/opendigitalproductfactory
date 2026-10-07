// BI-BDB63485 AC-COMPLETION-PATH: no path writes FeatureBuild.phase = "complete" without
// reconcileBuildCompletion's checks (every applicable ship fork terminal, and
// the merged SHA deployed unless upstream is skipped) —
// lib/build-flow-state.ts reconcileBuildCompletion.
//
// The only writer of `complete` is completeFeatureBuildTransition
// (lib/backlog/initiative-readiness/build-terminal-transition.ts), which checks
// initiative readiness (delivery/acceptance/objective evidence) but NOT forks or
// deployment. So the AC holds exactly when only lib/build-flow-state.ts calls
// that function — reconcileBuildCompletion and completeBuildWhenDelivered, both
// behind evaluateBuildCompletionPreconditions — and nothing else writes a
// literal `complete`.
// Same scanner shape as direct-phase-writes-ratchet.test.ts (BI-45F9CB7A).
import { describe, expect, it } from "vitest";

import { findDirectPhaseWrites } from "./direct-phase-writes";
import { readWebSourceFiles } from "./source-files";

const TERMINAL_MODULE = "lib/backlog/initiative-readiness/build-terminal-transition.ts";
const RECONCILER_MODULE = "lib/build-flow-state.ts";
const CALL = /\b(completeFeatureBuildTransition|assertFeatureBuildCompletion)\s*\(/g;

function stripLineComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
}

const files = readWebSourceFiles().filter((f) => !/\.test\.tsx?$/.test(f.path));

describe("AC-COMPLETION-PATH — `complete` only behind the delivery preconditions (BI-BDB63485)", () => {
  it("no production code outside the reconciler calls the terminal transition", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.path === TERMINAL_MODULE || file.path === RECONCILER_MODULE) continue;
      const text = stripLineComments(file.content);
      CALL.lastIndex = 0;
      for (let match = CALL.exec(text); match; match = CALL.exec(text)) {
        const line = text.slice(0, match.index).split("\n").length;
        offenders.push(`${file.path}:${line} ${match[1]}`);
      }
    }
    expect(offenders, "Complete a build through lib/build-flow-state.ts (fork + deploy preconditions)").toEqual([]);
  });

  it("no literal phase = \"complete\" write outside the terminal transition", () => {
    const literal = findDirectPhaseWrites(files)
      .filter((w) => w.target === "complete" && w.path !== TERMINAL_MODULE)
      .map((w) => `${w.path}:${w.line}`);
    expect(literal).toEqual([]);
  });
});
