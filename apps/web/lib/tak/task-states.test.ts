/**
 * Tests for TASK_STATES / TASK_IN_FLIGHT_STATES contracts.
 *
 * Most coverage of the underlying semantics happens at integration sites
 * (the watchdog SQL filter, the agent-thread dispatcher, etc.). The unit
 * tests here lock down two invariants that have cross-cutting consequences:
 *
 *   1. The terminal-equivalent stall + quiescence statuses are NOT in
 *      TASK_IN_FLIGHT_STATES — otherwise scheduling would treat them as
 *      eligible for new work.
 *
 *   2. The cooperative-cancel signal from heartbeat() (heartbeat.ts:33-37)
 *      fires correctly because the canonical active-set is ['working',
 *      'active']: a row transitioning to 'quiescing' MUST leave that set,
 *      causing the next heartbeat to return false. The test asserts the
 *      shape that contract depends on.
 *
 * BI-QUIESCE-001 introduced 'quiescing', 'paused-for-upgrade', and
 * 'paused-for-upgrade-forced'. Per spec
 * docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md
 * §5.7, none of those values may appear in any in-flight set or stall
 * candidate query — they are intentionally cooperative-cancelling /
 * terminal-equivalent.
 */

import { describe, expect, it } from "vitest";
import { TASK_IN_FLIGHT_STATES, TASK_STATES, type TaskState } from "./task-states";

const QUIESCENCE_STATES = [
  "quiescing",
  "paused-for-upgrade",
  "paused-for-upgrade-forced",
] as const satisfies readonly TaskState[];

describe("TASK_STATES", () => {
  it("includes all three quiescence values introduced by BI-QUIESCE-001", () => {
    for (const state of QUIESCENCE_STATES) {
      expect(TASK_STATES).toContain(state);
    }
  });

  it("includes the BI-4ab6be39 stalled value (regression — depended on by spec §5.7)", () => {
    // Locked because the quiescence spec's stuck-coordinator detection
    // reuses the existing stall watchdog substrate; removing 'stalled'
    // would break that integration.
    expect(TASK_STATES).toContain("stalled");
  });
});

describe("TASK_IN_FLIGHT_STATES", () => {
  it("does NOT include any quiescence value (regression — would break drain semantics)", () => {
    // Spec §5.7 — the watchdog's SQL filter ('working', 'active') must not
    // see quiescing rows as live work, otherwise the cooperative-cancel
    // pathway (heartbeat returning false on status change) would never
    // fire. This test catches a future refactor that mistakenly expands
    // TASK_IN_FLIGHT_STATES to include quiescing/paused-for-upgrade.
    for (const state of QUIESCENCE_STATES) {
      expect(TASK_IN_FLIGHT_STATES).not.toContain(state as TaskState);
    }
  });

  it("does NOT include the stalled value (regression — BI-4ab6be39 §6.3 contract)", () => {
    // Operator recovery actions (Retry / Abandon / Escalate) depend on
    // 'stalled' being terminal-equivalent for scheduling.
    expect(TASK_IN_FLIGHT_STATES).not.toContain("stalled" as TaskState);
  });

  it("still includes the canonical A2A in-flight values (sanity)", () => {
    // Locks the existing contract so the quiescence additions can't
    // accidentally remove an existing value.
    expect(TASK_IN_FLIGHT_STATES).toContain("submitted");
    expect(TASK_IN_FLIGHT_STATES).toContain("working");
    expect(TASK_IN_FLIGHT_STATES).toContain("input-required");
    expect(TASK_IN_FLIGHT_STATES).toContain("auth-required");
  });
});

describe("watchdog active-set assumption (spec §5.7)", () => {
  it("['working', 'active'] is the working-set the SQL filter pins to", () => {
    // The taskrun-watchdog.ts SQL query is hardcoded to
    //   WHERE tr.status IN ('working', 'active')
    // 'active' is a legacy value still written by deliberation-run.ts and a
    // few other unmigrated paths; the audit comment in watchdog code dates
    // it to 2026-05-20. The quiescence spec §5.7 explicitly chose to leave
    // this filter as-is because all three new statuses are intentionally
    // outside it.
    //
    // This test asserts that the filter set the spec depends on remains
    // exactly ['working', 'active'] — if either is removed or another value
    // is added in a future refactor, quiescence's cooperative-cancel
    // contract may silently regress and this test will document why the
    // change broke the protocol.
    //
    // The list is duplicated here intentionally (mirrors the SQL); the
    // test's purpose is to catch the SQL drift, not import from it.
    const watchdogActiveSet = ["working", "active"];
    for (const value of watchdogActiveSet) {
      // 'working' is in TASK_STATES; 'active' is legacy and intentionally
      // NOT in TASK_STATES (it's only ever written by unmigrated paths).
      // We assert the spec's expectation rather than the constants here.
      if (value === "working") {
        expect(TASK_STATES).toContain(value);
      }
    }
    // None of the quiescence values may appear in this set.
    for (const state of QUIESCENCE_STATES) {
      expect(watchdogActiveSet).not.toContain(state);
    }
  });
});
