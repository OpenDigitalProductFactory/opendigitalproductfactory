// AC-NOT-EXECUTABLE (PR-3b-3, BI-6DA17863). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §5 (Exec column), §5.4, §11 (AC-NOT-EXECUTABLE); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-3).
//
// 1. The executable subset. Parallel split/join is ON since GPP Phase 3c
//    PR-3c-2 (BI-8875C9DF), rework edge (incl. gate.onRefuse) since PR-3c-3
//    and stage deadline since BI-086DC167 (implemented in PR-3c-4), each
//    flipped with its drive-versus-interpreter parity test. Sub-shape
//    (PR-3c-5) is implemented and parity-proven (drive-parity-sub-shape.test.ts)
//    but OFF until its own change under BI-086DC167.
// 2. AC-NOT-EXECUTABLE: the schema-valid fixture for the off construct is
//    refused with exactly one E-NOT-EXECUTABLE naming its
//    construct and element id; turning only its flag on (test-only) removes
//    only that finding and leaves nothing blocking, and turning any other flag
//    on changes nothing: the flag is the only switch.
// 3. The kill switch for the ON constructs: each fixture compiles under the
//    real flags, and setting only its flag to false brings back exactly its
//    E-NOT-EXECUTABLE; setting any other flag to false changes nothing.
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

/** The fixtures of the constructs that are ON, and the element their refusal names when a flag is set back to false. */
const ON_CASES: ReadonlyArray<{ file: string; construct: GppConstruct; elementId: string }> = [
  { file: "pass-parallel-split-join.gpp.json", construct: "parallel-split-join", elementId: "node:p" },
  { file: "pass-rework-edge.gpp.json", construct: "rework-edge", elementId: "edge:b->a" },
  { file: "pass-refuse-edge.gpp.json", construct: "rework-edge", elementId: "gate:a" },
  { file: "pass-stage-deadline.gpp.json", construct: "stage-deadline", elementId: "stage:a" },
];

/** The fixture of the construct that is implemented but OFF (sub-shape, until its own change under BI-086DC167). */
const OFF_CASES: ReadonlyArray<{ file: string; construct: GppConstruct; elementId: string }> = [
  { file: "e-not-executable-sub-shape.gpp.json", construct: "sub-shape", elementId: "stage:a" },
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
  it("is the spec §5 Exec column with parallel split/join (PR-3c-2), rework edge (PR-3c-3) and stage deadline (BI-086DC167) on; sub-shape is off", () => {
    expect(GPP_CONSTRUCTS.filter((construct) => !CONSTRUCT_EXECUTABLE[construct])).toEqual(["sub-shape"]);
    for (const construct of ["parallel-split-join", "rework-edge", "stage-deadline"] as const) expect(CONSTRUCT_EXECUTABLE[construct], construct).toBe(true);
    expect(Object.keys(CONSTRUCT_EXECUTABLE).sort()).toEqual([...GPP_CONSTRUCTS].sort());
    expect(Object.isFrozen(CONSTRUCT_EXECUTABLE)).toBe(true);
  });

  it("every construct has an E-NOT-EXECUTABLE code, so flipping a flag never widens the closed set", () => {
    expect(GPP_NOT_EXECUTABLE_CODES).toEqual(GPP_CONSTRUCTS.map((construct) => `E-NOT-EXECUTABLE/${construct}`));
  });
});

describe("AC-NOT-EXECUTABLE: a schema-valid document using a construct that is off is refused", () => {
  it.each(OFF_CASES)("$file is refused with E-NOT-EXECUTABLE $construct at $elementId", async ({ file, construct, elementId }) => {
    const findings = await compile(file);
    expect(hasBlockingDiagnostic(findings)).toBe(true);
    const refusals = findings.filter((finding) => finding.rule === "E-NOT-EXECUTABLE");
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ severity: "error", elementId, code: `E-NOT-EXECUTABLE/${construct}` });
    expect(refusals[0]?.message.startsWith(`E-NOT-EXECUTABLE ${construct} at ${elementId}`)).toBe(true);
  });

  it.each(OFF_CASES)("$file: turning only the $construct flag on (test-only) removes only that finding; the implementation compiles clean", async ({ file, construct }) => {
    const before = await compile(file);
    const after = await compile(file, withFlag(construct, true));
    const afterKeys = new Set(after.map(key));
    expect(before.filter((finding) => !afterKeys.has(key(finding))).map((finding) => finding.code)).toEqual([`E-NOT-EXECUTABLE/${construct}`]);
    expect(after.length).toBe(before.length - 1);
    expect(hasBlockingDiagnostic(after)).toBe(false);
  });

  it.each(OFF_CASES)("$file: turning any other flag on changes nothing", async ({ file, construct }) => {
    const before = (await compile(file)).map(key);
    for (const other of GPP_CONSTRUCTS.filter((candidate) => candidate !== construct && !CONSTRUCT_EXECUTABLE[candidate])) {
      expect((await compile(file, withFlag(other, true))).map(key), other).toEqual(before);
    }
  });
});

// AC-3C-FLAG-FLIP for PR-3c-2, PR-3c-3 and the stage-deadline flip (BI-086DC167), kept as the kill switch.
describe("the kill switch: an ON construct's flag set back to false refuses its document", () => {
  it.each(ON_CASES)("$file compiles with no error under the real flags", async ({ file }) => {
    const findings = await compile(file);
    expect(findings.filter((finding) => finding.rule === "E-NOT-EXECUTABLE")).toEqual([]);
    expect(hasBlockingDiagnostic(findings)).toBe(false);
  });

  it.each(ON_CASES)("$file: with only the $construct flag off, exactly E-NOT-EXECUTABLE $construct at $elementId returns", async ({ file, construct, elementId }) => {
    const on = await compile(file);
    const off = await compile(file, withFlag(construct, false));
    const onKeys = new Set(on.map(key));
    expect(off.filter((finding) => !onKeys.has(key(finding))).map((finding) => `${finding.code} ${finding.elementId}`)).toEqual([`E-NOT-EXECUTABLE/${construct} ${elementId}`]);
    expect(off.length).toBe(on.length + 1);
  });

  it.each(ON_CASES)("$file: setting any other construct's flag to false changes nothing", async ({ file, construct }) => {
    const before = (await compile(file)).map(key);
    for (const other of GPP_CONSTRUCTS.filter((candidate) => candidate !== construct && CONSTRUCT_EXECUTABLE[candidate])) {
      expect((await compile(file, withFlag(other, false))).map(key), other).toEqual(before);
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
