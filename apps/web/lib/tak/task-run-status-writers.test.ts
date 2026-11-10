/**
 * Invariant: every TaskRun writer names a status from TASK_STATES (BI-CB4A6435).
 *
 * Migration 20260916140000_delivery_run_status_closed_sets closed
 * TaskRun.status with a CHECK built from TASK_STATES. A writer that still
 * spells a legacy alias ("active") or a vocabulary from another table
 * ("queued", "running") compiles, passes mocked-Prisma unit tests, and then
 * fails in production with 23514. Two such writers survived the migration:
 * the deliberation orchestrator's bootstrap TaskRun (every build review trail
 * failed) and brand extraction. This scan fails the build instead.
 *
 * It reads every prisma `taskRun.create/createMany/update/updateMany/upsert`
 * call under apps/web and checks each `status:` string literal inside it —
 * data and where clauses alike, since a where filter on a non-member value is
 * dead code that hides the same misunderstanding.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TASK_STATES } from "./task-states";

const WEB_ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["lib", "app"];
const WRITER_CALL = /\btaskRun\.(create|createMany|update|updateMany|upsert)\s*\(/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Text of the call's argument list, from the opening paren to its match. */
function callArguments(source: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(openParen, i + 1);
  }
  return source.slice(openParen);
}

/** Every string literal given to a `status:` key, bare or inside `in: [...]`. */
function statusLiterals(args: string): string[] {
  const found: string[] = [];
  for (const m of args.matchAll(/\bstatus\s*:\s*(\{[^}]*\}|"[^"]*"|'[^']*')/g)) {
    for (const lit of m[1]!.matchAll(/"([^"]*)"|'([^']*)'/g)) {
      found.push(lit[1] ?? lit[2]!);
    }
  }
  return found;
}

function findNonMemberTaskRunStatusWrites(
  files: Array<{ path: string; source: string }>,
): string[] {
  const members = new Set<string>(TASK_STATES);
  const violations: string[] = [];
  for (const { path, source } of files) {
    for (const call of source.matchAll(WRITER_CALL)) {
      const openParen = call.index! + call[0].length - 1;
      for (const value of statusLiterals(callArguments(source, openParen))) {
        if (!members.has(value)) {
          const line = source.slice(0, call.index).split("\n").length;
          violations.push(`${path}:${line} taskRun.${call[1]} status "${value}"`);
        }
      }
    }
  }
  return violations;
}

describe("TaskRun status writers stay inside TASK_STATES (BI-CB4A6435)", () => {
  it("flags a writer that uses a non-member literal", () => {
    const source = [
      "await prisma.taskRun.create({ data: { title: 'x', status: \"active\" } });",
      "await tx.taskRun.updateMany({ where: { status: { in: [\"working\", \"queued\"] } }, data: { status: \"completed\" } });",
    ].join("\n");
    expect(findNonMemberTaskRunStatusWrites([{ path: "fixture.ts", source }])).toEqual([
      'fixture.ts:1 taskRun.create status "active"',
      'fixture.ts:2 taskRun.updateMany status "queued"',
    ]);
  });

  it("finds no non-member status literal in any apps/web TaskRun writer", () => {
    const files = SCAN_DIRS.flatMap((d) => sourceFiles(join(WEB_ROOT, d))).map((full) => ({
      path: relative(WEB_ROOT, full).replace(/\\/g, "/"),
      source: readFileSync(full, "utf8"),
    }));
    expect(files.length).toBeGreaterThan(100);
    expect(findNonMemberTaskRunStatusWrites(files)).toEqual([]);
  });
});
