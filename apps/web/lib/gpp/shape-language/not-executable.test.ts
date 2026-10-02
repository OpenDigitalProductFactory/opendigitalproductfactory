// AC-NOT-EXECUTABLE (PR-3b-3, BI-6DA17863). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §5 (Exec column), §5.4, §11 (AC-NOT-EXECUTABLE); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-3).
//
// 1. The executable subset is exactly the spec's: stage deadline, parallel
//    split/join, rework edge (incl. gate.onRefuse) and sub-shape are off.
// 2. Each of the five schema-valid fixtures (parallel split, rework edge,
//    stage deadline, sub-shape, refuse edge) is refused with E-NOT-EXECUTABLE
//    naming its construct and element id.
// 3. Flipping that construct's flag in a test-only override removes only that
//    finding, and flipping any other flag removes nothing: the flag is the only
//    switch.
// 4. No decompiled registry document uses a non-executable construct.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { WORK_SHAPE_PRIOR_VERSIONS } from "@/lib/work-management/work-shape-prior-versions";
import { listWorkShapes } from "@/lib/work-management/work-shapes";

import { decompile } from "./decompile";
import { GPP_NOT_EXECUTABLE_CODES, hasBlockingDiagnostic, type GppDiagnostic } from "./diagnostics";
import { runDesignRules } from "./drc";
import { CONSTRUCT_EXECUTABLE, GPP_CONSTRUCTS, type GppConstruct } from "./executable-constructs";
import type { GateRatificationEntry } from "./gate-ratification";
import { parseShapeDocument } from "./parse";
import { resolveShapeDocument, type GppResolveSources } from "./resolve";
import { defaultResolveSources } from "./resolve-sources";

const FIXTURE_DIR = join(__dirname, "__fixtures__", "drc");
const RATIFICATION = JSON.parse(readFileSync(join(FIXTURE_DIR, "ratification.json"), "utf8")) as Record<string, GateRatificationEntry>;

const CASES: ReadonlyArray<{ file: string; construct: GppConstruct; elementId: string }> = [
  { file: "e-not-executable-parallel-split.gpp.json", construct: "parallel-split-join", elementId: "node:p" },
  { file: "e-not-executable-rework-edge.gpp.json", construct: "rework-edge", elementId: "edge:b->a" },
  { file: "e-not-executable-stage-deadline.gpp.json", construct: "stage-deadline", elementId: "stage:a" },
  { file: "e-not-executable-sub-shape.gpp.json", construct: "sub-shape", elementId: "stage:a" },
  { file: "e-not-executable-refuse-edge.gpp.json", construct: "rework-edge", elementId: "gate:a" },
];

let sources: GppResolveSources;
beforeAll(() => {
  sources = defaultResolveSources();
}, 120_000);

async function compile(file: string, executable?: Record<GppConstruct, boolean>): Promise<GppDiagnostic[]> {
  const parsed = parseShapeDocument(readFileSync(join(FIXTURE_DIR, file), "utf8"));
  if (!parsed.accepted) throw new Error(`${file} is not schema-valid: ${JSON.stringify(parsed.diagnostics)}`);
  const resolved = await resolveShapeDocument(parsed.document, sources);
  return runDesignRules(parsed.document, resolved, { ratification: RATIFICATION, directSites: new Map(), ...(executable ? { executable } : {}) });
}

const withFlag = (construct: GppConstruct, value: boolean) => ({ ...CONSTRUCT_EXECUTABLE, [construct]: value });
const key = (finding: GppDiagnostic) => JSON.stringify(finding);

describe("the executable subset", () => {
  it("is exactly the spec §5 Exec column: deadline, split/join, rework and sub-shape are off", () => {
    expect(GPP_CONSTRUCTS.filter((construct) => !CONSTRUCT_EXECUTABLE[construct])).toEqual([
      "stage-deadline",
      "parallel-split-join",
      "rework-edge",
      "sub-shape",
    ]);
    expect(Object.keys(CONSTRUCT_EXECUTABLE).sort()).toEqual([...GPP_CONSTRUCTS].sort());
    expect(Object.isFrozen(CONSTRUCT_EXECUTABLE)).toBe(true);
  });

  it("every construct has an E-NOT-EXECUTABLE code, so flipping a flag never widens the closed set", () => {
    expect(GPP_NOT_EXECUTABLE_CODES).toEqual(GPP_CONSTRUCTS.map((construct) => `E-NOT-EXECUTABLE/${construct}`));
  });
});

describe("AC-NOT-EXECUTABLE: a schema-valid document using a non-executable construct is refused", () => {
  it.each(CASES)("$file is refused with E-NOT-EXECUTABLE $construct at $elementId", async ({ file, construct, elementId }) => {
    const findings = await compile(file);
    expect(hasBlockingDiagnostic(findings)).toBe(true);
    const refusals = findings.filter((finding) => finding.rule === "E-NOT-EXECUTABLE");
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ severity: "error", elementId, code: `E-NOT-EXECUTABLE/${construct}` });
    expect(refusals[0]?.message.startsWith(`E-NOT-EXECUTABLE ${construct} at ${elementId}`)).toBe(true);
  });

  it.each(CASES)("$file: flipping only the $construct flag removes only that finding", async ({ file, construct }) => {
    const before = await compile(file);
    const after = await compile(file, withFlag(construct, true));
    const afterKeys = new Set(after.map(key));
    const removed = before.filter((finding) => !afterKeys.has(key(finding)));
    expect(removed.map((finding) => finding.code)).toEqual([`E-NOT-EXECUTABLE/${construct}`]);
    expect(after.length).toBe(before.length - 1);
    expect(hasBlockingDiagnostic(after)).toBe(false);
  });

  it.each(CASES)("$file: flipping any other flag changes nothing", async ({ file, construct }) => {
    const before = (await compile(file)).map(key);
    for (const other of GPP_CONSTRUCTS.filter((candidate) => candidate !== construct && !CONSTRUCT_EXECUTABLE[candidate])) {
      expect((await compile(file, withFlag(other, true))).map(key), other).toEqual(before);
    }
  });
});

describe("the registry uses no non-executable construct", () => {
  it("no decompiled registry document yields E-NOT-EXECUTABLE", async () => {
    const definitions = [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS];
    expect(definitions.length).toBe(listWorkShapes().length + WORK_SHAPE_PRIOR_VERSIONS.length);
    for (const definition of definitions) {
      const { document } = decompile(definition);
      const findings = runDesignRules(document, await resolveShapeDocument(document, sources), { directSites: new Map() });
      expect(findings.filter((finding) => finding.rule === "E-NOT-EXECUTABLE"), `${definition.key}@${definition.version}`).toEqual([]);
    }
  }, 60_000);
});
