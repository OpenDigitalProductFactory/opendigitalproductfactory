#!/usr/bin/env node
// scripts/check-guard-conformance-marks.mjs — every guard self-test that asserts
// LIVE REPOSITORY STATE must be marked as a conformance assertion (BI-7B249AFE).
//
// WHY THIS GUARD EXISTS. The host-side pregate preflight strips `node --test`
// commands from the guard profiles, because a guard's unit tests prove the guard
// and CI runs them anyway. Some of those files are not unit tests: they read the
// repository and assert on what they find. Stripping one removes the only check,
// and the preflight then reports clean on a tree CI fails deterministically —
// measured on PR #4737, where the preflight said "52 guards clean" and CI failed
// on `check-instruction-plane-rule-coverage.test.mjs`.
//
// The same lesson had already been learned once, on #4558, and closed by hand-
// picking guards back into the plan. Hand-picking does not close a class. This
// guard does: it detects the shape statically and fails when a detected file is
// not carried by a `conformanceTest(...)` command, so the next repository-reading
// self-test cannot quietly rejoin the stripped set.
//
// It is deliberately NOT the inverse check. A command may be marked conformance
// on judgement the detector cannot reproduce; over-marking costs preflight
// seconds, under-marking costs a CI round trip and a false green.

import { readFileSync } from "node:fs";
import process from "node:process";

import {
  POLICY_GUARD_PROFILES,
  isPolicyGuardConformanceCommand,
} from "./lib/ci-policy-guards.mjs";
import { isConformanceAssertionSource, liveRepoReads } from "./lib/guard-conformance-detect.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";

/** Profiles whose commands the host-side preflight builds its plan from. */
export const HOST_PREFLIGHT_PROFILES = Object.freeze(["source", "workspace"]);

/**
 * Every unmarked `node --test` command carrying at least one file that asserts
 * live repository state.
 *
 * `readSource` is injected so the guard's own tests never touch the repository —
 * which would make this guard the thing it is guarding against.
 */
export function findUnmarkedConformanceCommands({
  profiles = POLICY_GUARD_PROFILES,
  profileNames = HOST_PREFLIGHT_PROFILES,
  readSource = (file) => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  },
} = {}) {
  const findings = [];
  for (const profileName of profileNames) {
    for (const guard of profiles[profileName] ?? []) {
      for (const command of guard.commands) {
        const [binary, args] = command;
        if (binary !== "node" || args[0] !== "--test") continue;
        if (isPolicyGuardConformanceCommand(command)) continue;
        for (const file of args.slice(1)) {
          const source = readSource(file);
          if (source == null || !isConformanceAssertionSource(source)) continue;
          findings.push({
            profile: profileName,
            guardId: guard.id,
            file,
            reads: liveRepoReads(source).slice(0, 3).map((read) => read.text),
          });
        }
      }
    }
  }
  return findings;
}

function main() {
  const findings = findUnmarkedConformanceCommands();
  if (findings.length === 0) {
    console.log("[guard-conformance-marks] Every repository-reading guard self-test is marked. OK.");
    return 0;
  }

  console.error(
    `[guard-conformance-marks] FAILED — ${findings.length} guard self-test(s) assert live repository`,
  );
  console.error("state but are stripped from the host-side preflight, so the preflight can report");
  console.error("clean on a tree CI fails deterministically.\n");
  for (const finding of findings) {
    console.error(`  ${finding.profile} / ${finding.guardId}`);
    console.error(`    ${finding.file}`);
    for (const read of finding.reads) console.error(`      reads: ${read}`);
  }
  console.error("\nFix: in scripts/lib/ci-policy-guards.mjs, carry each file above in a");
  console.error("`conformanceTest(...)` command instead of `node(\"--test\", ...)`. Split it out of");
  console.error("a multi-file command so the genuine unit tests stay stripped and the preflight");
  console.error("budget does not absorb the whole CI suite.");
  return 1;
}

if (isEntryModule(import.meta.url)) process.exit(main());
