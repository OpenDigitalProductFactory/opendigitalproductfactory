// BI-7BCC87BB (plan B6; spec D8, OBJ-CONVERGE): after PR-B nothing creates an
// AgentActionProposal. Every coworker action that needs a person raises a
// CoworkerActionEnvelope through the governed executor instead. The table,
// its rows and the non-executing legacy handlers stay (OBJ-HISTORY), so reads
// and status updates are fine; a new write is not.
//
// A source guard, because the creation sites were ordinary Prisma calls
// scattered across the app: S1 chat, S2 propose-interception, S3 the
// operations map, S4 field dispatch and S5 leave.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOTS = ["app", "components", "lib", "scripts"];
const CREATE = /agentActionProposal\s*\.\s*(create|createMany|createManyAndReturn|upsert)\s*\(/;
const TEST_FILE = /\.(test|spec)\.tsx?$|\.characterization\.test\.tsx?$/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|mts|mjs)$/.test(name) && !TEST_FILE.test(name)) out.push(path);
  }
  return out;
}

describe("no new AgentActionProposal (approval convergence B6)", () => {
  it("no non-test code creates a proposal", () => {
    const offenders = ROOTS.flatMap((root) => sourceFiles(join(WEB_ROOT, root)))
      .filter((file) => CREATE.test(readFileSync(file, "utf8")))
      .map((file) => relative(WEB_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("the guard recognises the shapes it forbids", () => {
    expect(CREATE.test("await prisma.agentActionProposal.create({ data })")).toBe(true);
    expect(CREATE.test("tx.agentActionProposal\n  .upsert({")).toBe(true);
    expect(CREATE.test("prisma.agentActionProposal.updateMany({ where })")).toBe(false);
    expect(CREATE.test("prisma.agentActionProposal.findMany({})")).toBe(false);
  });
});
