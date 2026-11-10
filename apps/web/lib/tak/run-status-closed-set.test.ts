import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TASK_STATES } from "./task-states";
import {
  SCHEDULED_AGENT_TASK_DISPOSITION,
  SCHEDULED_AGENT_TASK_STATUSES,
} from "./scheduled-agent-task-status";
import { OUTCOME_DISPOSITIONS, countsAsFailure } from "@/lib/shared/outcome-disposition";

// The delivery plane's own run-status columns are closed sets held in two
// places each: a TypeScript union, and a CHECK constraint in Postgres
// (20260916140000, BI-9F6AFFA0). WorkCapsule.source drifted twice before a test
// like this existed, and the second drift made every UPDATE to one row fail with
// 23514 — 1,147 times, because the constraint is NOT VALID and so bites at the
// first UPDATE rather than the INSERT. This makes that drift a red build.
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../packages/db/prisma/migrations/", import.meta.url));

function latestDbClosedSet(constraintName: string, column: string): string[] {
  const dirs = readdirSync(MIGRATIONS_DIR).filter((d) => /^\d{14}_/.test(d)).sort();
  for (const dir of [...dirs].reverse()) {
    let sql: string;
    try {
      sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
    } catch {
      continue;
    }
    const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const block = sql.match(
      new RegExp(`"${constraintName}" CHECK \\(\\s*(?:${escaped}|"${escaped}")[\\s\\S]*?ARRAY\\[([\\s\\S]*?)\\]\\)`),
    );
    if (block) return [...block[1].matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
  }
  throw new Error(`no migration defines ${constraintName}`);
}

describe("TaskRun.status closed set (BI-9F6AFFA0)", () => {
  it("is the same set in TypeScript and in the latest Postgres check constraint", () => {
    expect(latestDbClosedSet("TaskRun_status_closed_set", "status")).toEqual([...TASK_STATES].sort());
  });

  it("still carries the non-verdict states a review can legitimately end in", () => {
    // A1 (BI-FF63D266) writes "input-required" where it used to write "failed".
    // If either left the set, that fix would start failing at the first UPDATE.
    expect(TASK_STATES).toContain("input-required");
    expect(TASK_STATES).toContain("auth-required");
  });
});

describe("ScheduledAgentTask.lastStatus closed set (BI-9F6AFFA0)", () => {
  it("is the same set in TypeScript and in the latest Postgres check constraint", () => {
    expect(latestDbClosedSet("ScheduledAgentTask_lastStatus_closed_set", "lastStatus"))
      .toEqual([...SCHEDULED_AGENT_TASK_STATUSES].sort());
  });

  it("carries the third state the old comment denied", () => {
    // The column said "ok | error" while #5335 was already writing "proposed".
    expect(SCHEDULED_AGENT_TASK_STATUSES).toContain("proposed");
  });

  it("classifies every status, and a diverted proposal is not a failure", () => {
    for (const disposition of Object.values(SCHEDULED_AGENT_TASK_DISPOSITION)) {
      expect(OUTCOME_DISPOSITIONS).toContain(disposition);
    }
    expect(countsAsFailure(SCHEDULED_AGENT_TASK_DISPOSITION.proposed)).toBe(false);
    expect(countsAsFailure(SCHEDULED_AGENT_TASK_DISPOSITION.error)).toBe(true);
  });
});
