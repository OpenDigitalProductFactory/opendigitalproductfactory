import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PERSON_FACING_WRITE_PRIMITIVES } from "./person-facing-write-sites";

// BI-5CA6AB34: a decision reaches a person only with a qualifying kernel
// record. Every caller of a write that puts something in front of a person is
// classified here, so a new caller cannot quietly turn a notice path into an
// unrecorded decision request: it fails this test until someone classifies it.

const WEB_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.cases\.ts$/.test(name)) out.push(path);
  }
  return out;
}

const REGISTRY = fileURLToPath(new URL("./person-facing-write-sites.ts", import.meta.url));
const FILES = [...sourceFiles(join(WEB_ROOT, "lib")), ...sourceFiles(join(WEB_ROOT, "app"))]
  .filter((file) => file !== REGISTRY);

function callersOf(call: string): string[] {
  return FILES.filter((file) => readFileSync(file, "utf8").includes(call))
    .map((file) => relative(WEB_ROOT, file).replace(/\\/g, "/"))
    .sort();
}

describe("person-facing write sites are classified", () => {
  for (const primitive of PERSON_FACING_WRITE_PRIMITIVES) {
    it(`every caller of ${primitive.call} is classified`, () => {
      const classified = Object.keys(primitive.callers).sort();
      expect(callersOf(primitive.call)).toEqual(classified);
    });
  }

  it("a decision-governed primitive names the check that enforces its record", () => {
    for (const primitive of PERSON_FACING_WRITE_PRIMITIVES) {
      if (primitive.classification !== "decision-governed") continue;
      expect(primitive.enforcedBy, primitive.call).toBeTruthy();
      const [file, symbol] = primitive.enforcedBy!.split("#");
      expect(readFileSync(join(WEB_ROOT, file), "utf8"), primitive.enforcedBy).toContain(symbol);
    }
  });

  it("every exemption says why", () => {
    for (const primitive of PERSON_FACING_WRITE_PRIMITIVES) {
      expect(primitive.rationale.length, primitive.call).toBeGreaterThan(20);
    }
  });
});
