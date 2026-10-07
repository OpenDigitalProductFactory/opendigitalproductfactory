// AC-NOT-EXECUTABLE (PR-3b-3, BI-6DA17863). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §5 (Exec column), §5.4, §11 (AC-NOT-EXECUTABLE); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-3).
//
// 1. The executable subset: every construct is executable. Parallel
//    split/join since GPP Phase 3c PR-3c-2 (BI-8875C9DF), rework edge (incl.
//    gate.onRefuse) since PR-3c-3, stage deadline (PR-3c-4) and sub-shape
//    (PR-3c-5) since BI-086DC167, which made a graph marking one run that
//    crosses calendar boundaries (both were held off 2026-10-07 until then);
//    each flipped with its drive-versus-interpreter parity test
//    (lib/work-management/drive-parity-parallel.test.ts,
//    drive-parity-rework.test.ts, drive-parity-deadline.test.ts,
//    drive-parity-sub-shape.test.ts).
// 2. AC-NOT-EXECUTABLE, kept as the kill switch: each former refusal fixture
//    (now pass-*.gpp.json) compiles with no finding under the real flags, and
//    setting its construct's flag back to false (test-only) brings back
//    exactly its E-NOT-EXECUTABLE naming the construct and element id, while
//    setting any OTHER flag to false changes nothing: the flag is the only
//    switch.
// 3. AC-3C-FLAG-FLIP for each construct, in the PR that flipped it.
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

/** Each formerly refused construct's fixture, now passing, and the element its refusal names. */
const CASES: ReadonlyArray<{ file: string; construct: GppConstruct; elementId: string }> = [
  { file: "pass-parallel-split-join.gpp.json", construct: "parallel-split-join", elementId: "node:p" },
  { file: "pass-rework-edge.gpp.json", construct: "rework-edge", elementId: "edge:b->a" },
  { file: "pass-refuse-edge.gpp.json", construct: "rework-edge", elementId: "gate:a" },
  { file: "pass-stage-deadline.gpp.json", construct: "stage-deadline", elementId: "stage:a" },
  { file: "pass-sub-shape.gpp.json", construct: "sub-shape", elementId: "stage:a" },
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
  it("is the spec §5 Exec column with every Phase 3c construct enabled (PR-3c-2 to PR-3c-5; the last two with BI-086DC167): no construct is off", () => {
    expect(GPP_CONSTRUCTS.filter((construct) => !CONSTRUCT_EXECUTABLE[construct])).toEqual([]);
    for (const construct of ["parallel-split-join", "rework-edge", "stage-deadline", "sub-shape"] as const) expect(CONSTRUCT_EXECUTABLE[construct], construct).toBe(true);
    expect(Object.keys(CONSTRUCT_EXECUTABLE).sort()).toEqual([...GPP_CONSTRUCTS].sort());
    expect(Object.isFrozen(CONSTRUCT_EXECUTABLE)).toBe(true);
  });

  it("every construct has an E-NOT-EXECUTABLE code, so flipping a flag never widens the closed set", () => {
    expect(GPP_NOT_EXECUTABLE_CODES).toEqual(GPP_CONSTRUCTS.map((construct) => `E-NOT-EXECUTABLE/${construct}`));
  });
});

describe("AC-NOT-EXECUTABLE as the kill switch: a construct's flag set back to false refuses its document", () => {
  it.each(CASES)("$file compiles with no error under the real flags", async ({ file }) => {
    const findings = await compile(file);
    expect(findings.filter((finding) => finding.rule === "E-NOT-EXECUTABLE")).toEqual([]);
    expect(hasBlockingDiagnostic(findings)).toBe(false);
  });

  it.each(CASES)("$file: with only the $construct flag off it is refused with E-NOT-EXECUTABLE $construct at $elementId, and nothing else changes", async ({ file, construct, elementId }) => {
    const on = await compile(file);
    const off = await compile(file, withFlag(construct, false));
    const onKeys = new Set(on.map(key));
    const added = off.filter((finding) => !onKeys.has(key(finding)));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ rule: "E-NOT-EXECUTABLE", severity: "error", elementId, code: `E-NOT-EXECUTABLE/${construct}` });
    expect(added[0]?.message.startsWith(`E-NOT-EXECUTABLE ${construct} at ${elementId}`)).toBe(true);
    expect(off.length).toBe(on.length + 1);
  });

  it.each(CASES)("$file: setting any other construct's flag to false changes nothing", async ({ file, construct }) => {
    const before = (await compile(file)).map(key);
    for (const other of GPP_CONSTRUCTS.filter((candidate) => candidate !== construct)) {
      expect((await compile(file, withFlag(other, false))).map(key), other).toEqual(before);
    }
  });
});

// AC-3C-FLAG-FLIP (GPP Phase 3c PR-3c-2): the parallel flag is on, and only that finding is gone.
describe("AC-3C-FLAG-FLIP: parallel split/join compiles", () => {
  const PARALLEL = "pass-parallel-split-join.gpp.json";

  it("the parallel fixture compiles with no error under the real flags", async () => {
    const findings = await compile(PARALLEL);
    expect(findings.filter((finding) => finding.rule === "E-NOT-EXECUTABLE")).toEqual([]);
    expect(hasBlockingDiagnostic(findings)).toBe(false);
  });

  it("with the parallel flag set back to false (the kill switch), exactly its E-NOT-EXECUTABLE returns", async () => {
    const on = await compile(PARALLEL);
    const off = await compile(PARALLEL, withFlag("parallel-split-join", false));
    const onKeys = new Set(on.map(key));
    const added = off.filter((finding) => !onKeys.has(key(finding)));
    expect(added.map((finding) => `${finding.code} ${finding.elementId}`)).toEqual(["E-NOT-EXECUTABLE/parallel-split-join node:p"]);
    expect(off.length).toBe(on.length + 1);
  });
});

// AC-3C-FLAG-FLIP (GPP Phase 3c PR-3c-3): the rework-edge flag is on, covering both notations (a
// `flow.edges[].rework` edge and a gate's `onRefuse` route, design §11 correction 1), and only those findings are gone.
describe("AC-3C-FLAG-FLIP: rework edges and refuse routes compile", () => {
  const REWORK = [
    { file: "pass-rework-edge.gpp.json", elementId: "edge:b->a" },
    { file: "pass-refuse-edge.gpp.json", elementId: "gate:a" },
  ];

  it.each(REWORK)("$file compiles with no error under the real flags", async ({ file }) => {
    const findings = await compile(file);
    expect(findings.filter((finding) => finding.rule === "E-NOT-EXECUTABLE")).toEqual([]);
    expect(hasBlockingDiagnostic(findings)).toBe(false);
  });

  it.each(REWORK)("$file: with the rework-edge flag set back to false (the kill switch), exactly its E-NOT-EXECUTABLE returns", async ({ file, elementId }) => {
    const on = await compile(file);
    const off = await compile(file, withFlag("rework-edge", false));
    const onKeys = new Set(on.map(key));
    const added = off.filter((finding) => !onKeys.has(key(finding)));
    expect(added.map((finding) => `${finding.code} ${finding.elementId}`)).toEqual([`E-NOT-EXECUTABLE/rework-edge ${elementId}`]);
    expect(off.length).toBe(on.length + 1);
  });

  it("the parallel fixture is unaffected: it still compiles with no E-NOT-EXECUTABLE", async () => {
    expect((await compile("pass-parallel-split-join.gpp.json")).filter((finding) => finding.rule === "E-NOT-EXECUTABLE")).toEqual([]);
  });
});

// AC-3C-FLAG-FLIP (GPP Phase 3c PR-3c-4, enabled with BI-086DC167): the stage-deadline flag is on, and only that finding is gone.
describe("AC-3C-FLAG-FLIP: a stage deadline compiles", () => {
  const DEADLINE = "pass-stage-deadline.gpp.json";

  it("the stage-deadline fixture compiles with no error under the real flags", async () => {
    const findings = await compile(DEADLINE);
    expect(findings.filter((finding) => finding.rule === "E-NOT-EXECUTABLE")).toEqual([]);
    expect(hasBlockingDiagnostic(findings)).toBe(false);
  });

  it("with the stage-deadline flag set back to false (the kill switch), exactly its E-NOT-EXECUTABLE returns", async () => {
    const on = await compile(DEADLINE);
    const off = await compile(DEADLINE, withFlag("stage-deadline", false));
    const onKeys = new Set(on.map(key));
    const added = off.filter((finding) => !onKeys.has(key(finding)));
    expect(added.map((finding) => `${finding.code} ${finding.elementId}`)).toEqual(["E-NOT-EXECUTABLE/stage-deadline stage:a"]);
    expect(off.length).toBe(on.length + 1);
  });

  it("the parallel, rework and refuse fixtures are unaffected", async () => {
    for (const file of ["pass-parallel-split-join.gpp.json", "pass-rework-edge.gpp.json", "pass-refuse-edge.gpp.json"]) {
      expect((await compile(file)).filter((finding) => finding.rule === "E-NOT-EXECUTABLE"), file).toEqual([]);
    }
  });
});

// AC-3C-FLAG-FLIP (GPP Phase 3c PR-3c-5, enabled with BI-086DC167): the sub-shape flag is on, and only that finding is gone.
describe("AC-3C-FLAG-FLIP: a sub-shape compiles; no construct is refused", () => {
  const SUB_SHAPE = "pass-sub-shape.gpp.json";

  it("the sub-shape fixture compiles with no error under the real flags", async () => {
    const findings = await compile(SUB_SHAPE);
    expect(findings.filter((finding) => finding.rule === "E-NOT-EXECUTABLE")).toEqual([]);
    expect(hasBlockingDiagnostic(findings)).toBe(false);
  });

  it("with the sub-shape flag set back to false (the kill switch), exactly its E-NOT-EXECUTABLE returns", async () => {
    const on = await compile(SUB_SHAPE);
    const off = await compile(SUB_SHAPE, withFlag("sub-shape", false));
    const onKeys = new Set(on.map(key));
    expect(off.filter((finding) => !onKeys.has(key(finding))).map((finding) => `${finding.code} ${finding.elementId}`)).toEqual(["E-NOT-EXECUTABLE/sub-shape stage:a"]);
  });

  it("every other gated construct's fixture still compiles", async () => {
    for (const { file } of CASES.filter((entry) => entry.construct !== "sub-shape")) {
      expect((await compile(file)).filter((finding) => finding.rule === "E-NOT-EXECUTABLE"), file).toEqual([]);
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
