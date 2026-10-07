// AC-DRC: the design-rule fixture corpus (PR-3b-3, BI-6DA17863). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §7.2, §11 (AC-DRC); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-3).
//
// Every `*.gpp.json` under __fixtures__/drc/ except `pass-*` holds exactly one
// seeded violation; expected.json names its rule and element id. Each fixture
// goes through the pipeline as the compiler will run it — strict parse,
// resolve with the seed-backed default sources, then runDesignRules with the
// live direct-execute sites and the corpus's test-only ratification table —
// and must yield exactly that finding among its errors and warnings.
//
// Non-executable constructs: a fixture whose seeded violation needs a
// construct whose Exec flag is off (S-3's unpaired split) also carries
// E-NOT-EXECUTABLE for it. So each fixture is checked twice: with every flag
// on (test-only override) it yields exactly its finding; with the real flags
// it yields its finding plus nothing but E-NOT-EXECUTABLE. (An
// E-NOT-EXECUTABLE fixture would be the converse: its finding exists only
// under the real flags; none is left.) Parallel split/join became executable
// in Phase 3c PR-3c-2, rework edges with refuse routes in PR-3c-3, stage
// deadlines in PR-3c-4 and sub-shapes in PR-3c-5; their fixtures are now pass-parallel-split-join.gpp.json,
// pass-rework-edge.gpp.json, pass-refuse-edge.gpp.json,
// pass-stage-deadline.gpp.json and pass-sub-shape.gpp.json.
//
// C-5 appears on every compile as `not-evaluated`, and never as a pass.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import type { GppDiagnostic } from "./diagnostics";
import { runDesignRules } from "./drc";
import { CONSTRUCT_EXECUTABLE, GPP_CONSTRUCTS, type GppConstruct } from "./executable-constructs";
import { GATE_RATIFICATION, gateRatificationRefusals, type GateRatificationEntry } from "./gate-ratification";
import { gppLayoutSchema } from "./gpp-layout-schema";
import { parseShapeDocument } from "./parse";
import { resolveShapeDocument, type GppResolveSources } from "./resolve";
import { defaultResolveSources, liveDirectExecuteSites } from "./resolve-sources";

const FIXTURE_DIR = join(__dirname, "__fixtures__", "drc");
type Expected = { rule: string; elementId: string; construct?: GppConstruct };
const EXPECTED = JSON.parse(readFileSync(join(FIXTURE_DIR, "expected.json"), "utf8")) as Record<string, Expected>;
const RATIFICATION = JSON.parse(readFileSync(join(FIXTURE_DIR, "ratification.json"), "utf8")) as Record<string, GateRatificationEntry>;
const DOCUMENTS = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".gpp.json")).sort();
const VIOLATIONS = DOCUMENTS.filter((name) => !name.startsWith("pass-"));
const PASSING = DOCUMENTS.filter((name) => name.startsWith("pass-"));
const ALL_ON = Object.fromEntries(GPP_CONSTRUCTS.map((construct) => [construct, true])) as Record<GppConstruct, boolean>;

/** The rules AC-DRC names, plus the two warnings, each covered by a fixture. (E-NOT-EXECUTABLE has none since PR-3c-5.) */
const COVERED_RULES = [
  "C-1", "C-2", "C-3", "C-4", "C-7", "C-9",
  "S-1", "S-2", "S-3", "S-4", "S-5", "S-6",
  "D-1", "D-2", "D-3", "D-4", "D-5", "D-6", "D-7", "D-8", "D-9", "D-10",
  "W-ORPHAN-LAYOUT",
];
const WARNING_RULES = new Set(["C-9", "W-ORPHAN-LAYOUT"]);

let sources: GppResolveSources;
let directSites: ReadonlyMap<string, readonly string[]>;

beforeAll(() => {
  sources = defaultResolveSources();
  directSites = liveDirectExecuteSites();
}, 120_000);

async function compileFixture(name: string, executable?: Record<GppConstruct, boolean>): Promise<GppDiagnostic[]> {
  const parsed = parseShapeDocument(readFileSync(join(FIXTURE_DIR, name), "utf8"));
  if (!parsed.accepted) throw new Error(`${name} is not schema-valid: ${JSON.stringify(parsed.diagnostics)}`);
  const layoutFile = join(FIXTURE_DIR, name.replace(/\.gpp\.json$/, ".layout.json"));
  const layout = existsSync(layoutFile) ? gppLayoutSchema.parse(JSON.parse(readFileSync(layoutFile, "utf8"))) : undefined;
  const resolved = await resolveShapeDocument(parsed.document, sources);
  return runDesignRules(parsed.document, resolved, {
    ratification: RATIFICATION,
    directSites,
    ...(layout ? { layout } : {}),
    ...(executable ? { executable } : {}),
  });
}

/** Errors and warnings: what a reviewer must act on. Standing info and not-evaluated reports are excluded. */
const actionable = (findings: readonly GppDiagnostic[]) =>
  findings.filter((finding) => finding.severity === "error" || finding.severity === "warning");
const brief = (finding: GppDiagnostic) => ({ rule: finding.rule, elementId: finding.elementId });

describe("the corpus", () => {
  it("expected.json lists exactly the violation fixtures, and they cover every rule once", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(VIOLATIONS);
    const rules = VIOLATIONS.map((name) => EXPECTED[name]?.rule);
    for (const rule of COVERED_RULES) {
      expect(rules.filter((candidate) => candidate === rule), rule).toHaveLength(1);
    }
    expect(new Set(rules)).toEqual(new Set(COVERED_RULES));
  });

  // GPP Phase 3c: parallel split/join (PR-3c-2), rework edges with refuse routes (PR-3c-3), stage deadlines
  // (PR-3c-4) and sub-shapes (PR-3c-5) are executable, so every former E-NOT-EXECUTABLE fixture is now a passing
  // document; not-executable.test.ts proves the kill switch brings each refusal back.
  it("has no E-NOT-EXECUTABLE fixture: every gated construct's fixture passes", () => {
    expect(VIOLATIONS.filter((name) => EXPECTED[name]?.rule === "E-NOT-EXECUTABLE")).toEqual([]);
    expect(PASSING).toEqual(expect.arrayContaining([
      "pass-parallel-split-join.gpp.json",
      "pass-rework-edge.gpp.json",
      "pass-refuse-edge.gpp.json",
      "pass-stage-deadline.gpp.json",
      "pass-sub-shape.gpp.json",
    ]));
  });

  it("the test-only ratification table is well-formed and names only test scopes", () => {
    expect(gateRatificationRefusals(RATIFICATION)).toEqual([]);
    for (const scope of Object.keys(RATIFICATION)) {
      expect(scope.startsWith("drc-"), scope).toBe(true);
      expect(Object.hasOwn(GATE_RATIFICATION, scope), scope).toBe(false);
    }
  });
});

describe("AC-DRC: each fixture is refused with exactly its rule on its element", () => {
  it.each(VIOLATIONS)("%s", async (name) => {
    const expected = EXPECTED[name] as Expected;
    const severity = WARNING_RULES.has(expected.rule) ? "warning" : "error";
    const real = actionable(await compileFixture(name));
    const allOn = actionable(await compileFixture(name, ALL_ON));

    if (expected.rule === "E-NOT-EXECUTABLE") {
      expect(real.map(brief)).toEqual([{ rule: expected.rule, elementId: expected.elementId }]);
      expect(real[0]?.code).toBe(`E-NOT-EXECUTABLE/${expected.construct}`);
      expect(allOn).toEqual([]);
    } else {
      expect(allOn.map(brief)).toEqual([{ rule: expected.rule, elementId: expected.elementId }]);
      expect(allOn[0]?.severity).toBe(severity);
      expect(allOn[0]?.message.length).toBeGreaterThan(0);
      // Under the real flags: the same finding, plus only E-NOT-EXECUTABLE for constructs the fixture needs.
      const seeded = real.filter((finding) => finding.rule === expected.rule);
      expect(seeded.map(brief)).toEqual([{ rule: expected.rule, elementId: expected.elementId }]);
      expect(real.filter((finding) => finding.rule !== expected.rule).every((finding) => finding.rule === "E-NOT-EXECUTABLE")).toBe(true);
    }
  });

  it("the S-3 fixture's unpaired split carries E-NOT-EXECUTABLE only while the parallel flag is off", async () => {
    // GPP Phase 3c PR-3c-2: the flag is on, so under the real flags only S-3 remains.
    expect(actionable(await compileFixture("s-3-unpaired-split.gpp.json")).map(brief)).toEqual([{ rule: "S-3", elementId: "node:p" }]);
    const parallelOff = { ...CONSTRUCT_EXECUTABLE, "parallel-split-join": false };
    expect(actionable(await compileFixture("s-3-unpaired-split.gpp.json", parallelOff)).map(brief)).toEqual([
      { rule: "E-NOT-EXECUTABLE", elementId: "node:p" },
      { rule: "S-3", elementId: "node:p" },
    ]);
  });

  it("findings carry RFC 6901 paths into the document", async () => {
    const [c2] = actionable(await compileFixture("c-2-unregistered-tool.gpp.json"));
    expect(c2?.path).toBe("/stages/0/tools/0");
    const [d1] = actionable(await compileFixture("d-1-status-into-oai.gpp.json"));
    expect(d1?.path).toBe("/stages/0/advance");
    const [d3] = actionable(await compileFixture("d-3-checkpoint-not-exact.gpp.json"));
    expect(d3?.path).toBe("/stages/0/advance/gate/checkpoint/exactAction");
  });
});

describe("C-5 is reported on every compile as not-evaluated, never as a pass", () => {
  it.each(DOCUMENTS)("%s", async (name) => {
    const findings = await compileFixture(name);
    const c5 = findings.filter((finding) => finding.rule === "C-5");
    expect(c5).toHaveLength(1);
    expect(c5[0]).toMatchObject({ severity: "not-evaluated", code: "C-5" });
    expect(c5[0]?.message).toMatch(/not evaluated/i);
    expect(c5[0]?.message).toMatch(/not a pass/i);
  });
});

describe("passing documents", () => {
  it("there is at least one", () => {
    expect(PASSING.length).toBeGreaterThan(0);
  });

  it.each(PASSING)("%s has no error or warning", async (name) => {
    expect(actionable(await compileFixture(name))).toEqual([]);
  });

  it("the real flags table is the one the corpus runs against", () => {
    expect(Object.isFrozen(CONSTRUCT_EXECUTABLE)).toBe(true);
  });
});
