// The TypeScript emitter (PR-3b-4, BI-6DA17863). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §4.5 (the emitted module), §7.4 (L2); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-4).
//
// Type checking is proved with the TypeScript compiler itself, not asserted:
// emitted modules are written to a temp directory, their one import of
// "../work-shapes" is pointed at the real module, and a program built from
// apps/web/tsconfig.json's options reports the semantic diagnostics of those
// files only. Test files are outside `pnpm --filter web typecheck`, so an
// `expectTypeOf` here would never meet tsc; the literal-type assertions are
// written into a probe module that the same program checks.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import { WORK_SHAPE_PRIOR_VERSIONS } from "@/lib/work-management/work-shape-prior-versions";
import { listWorkShapes, type WorkShapeDefinition } from "@/lib/work-management/work-shapes";

import { WEB_ROOT } from "../source-files";
import { compileShapeDocument } from "./compile";
import { decompile } from "./decompile";
import {
  emitShapeModule,
  GENERATED_SHAPE_TYPE_IMPORT,
  lowerToDefinition,
  shapeConstantName,
} from "./emit";
import { GATE_RATIFICATION, type GateRatificationEntry } from "./gate-ratification";
import { gppShapeDocumentSchema, type GppGate, type GppShapeDocument } from "./gpp-shape-schema";
import type { GppResolveSources } from "./resolve";
import { defaultResolveSources, liveDirectExecuteSites } from "./resolve-sources";

const FIXTURES = join(__dirname, "__fixtures__");
const DRC_DIR = join(FIXTURES, "drc");
const WORKED_EXAMPLE_TEXT = readFileSync(join(FIXTURES, "inquiry-response-watch.worked-example.gpp.json"), "utf8");
const WORKED_EXAMPLE = gppShapeDocumentSchema.parse(JSON.parse(WORKED_EXAMPLE_TEXT));
const DRC_RATIFICATION = JSON.parse(readFileSync(join(DRC_DIR, "ratification.json"), "utf8")) as Record<string, GateRatificationEntry>;
const PASSING_FIXTURES = ["pass-environment-binding.gpp.json", "pass-gated-irreversible-stage.gpp.json"];
const WORK_SHAPES_MODULE = join(WEB_ROOT, "lib", "work-management", "work-shapes");

function workedExampleGate(): GppGate {
  const advance = WORKED_EXAMPLE.stages[1]?.advance;
  if (advance?.kind !== "governed-decision" || !advance.gate) throw new Error("worked example has no gate");
  return advance.gate;
}

/** Test-only: the real table plus the worked example's gate ratified, and the DRC corpus scopes. */
const TEST_RATIFICATION: Readonly<Record<string, GateRatificationEntry>> = {
  ...GATE_RATIFICATION,
  ...DRC_RATIFICATION,
  "outbound-customer-communication": {
    status: "ratified",
    proposed: workedExampleGate(),
    basis: "Test-only ratification; no production entry changes.",
    decisionId: "DI-000000000000",
    ratifiedAt: "2026-10-02",
  },
};

let sources: GppResolveSources;
let directSites: ReadonlyMap<string, readonly string[]>;
beforeAll(() => {
  sources = defaultResolveSources();
  directSites = liveDirectExecuteSites();
}, 120_000);

async function compileOk(text: string, sourcePath: string) {
  const result = await compileShapeDocument(text, sources, { sourcePath, ratification: TEST_RATIFICATION, directSites });
  if (!result.accepted) throw new Error(`${sourcePath} was refused: ${JSON.stringify(result.diagnostics.filter((d) => d.severity === "error"))}`);
  return result;
}

// ── tsc over emitted modules ────────────────────────────────────────────────

function webCompilerOptions(): ts.CompilerOptions {
  const configPath = join(WEB_ROOT, "tsconfig.json");
  const read = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, WEB_ROOT, undefined, configPath);
  return { ...parsed.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined, plugins: [] };
}

/**
 * Semantic and syntactic diagnostics for `files` (name → text), written to a
 * temp directory. Each emitted module's "../work-shapes" import is pointed at
 * the real module; nothing else in the text changes.
 */
function typecheck(files: Record<string, string>): string[] {
  const dir = mkdtempSync(join(tmpdir(), "gpp-emit-typecheck-"));
  try {
    const roots: string[] = [];
    for (const [name, text] of Object.entries(files)) {
      const importLine = `from "${GENERATED_SHAPE_TYPE_IMPORT}";`;
      const rewritten = text.includes(importLine) ? text.replace(importLine, `from ${JSON.stringify(WORK_SHAPES_MODULE)};`) : text;
      const path = join(dir, name);
      writeFileSync(path, rewritten, "utf8");
      roots.push(path);
    }
    const program = ts.createProgram(roots, webCompilerOptions());
    const out: string[] = [];
    for (const root of roots) {
      const sourceFile = program.getSourceFile(root);
      if (!sourceFile) throw new Error(`tsc did not load ${root}`);
      for (const diagnostic of [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)]) {
        const at = diagnostic.start === undefined ? "" : `:${sourceFile.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`;
        out.push(`${root.slice(dir.length + 1)}${at} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
      }
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── the module text ─────────────────────────────────────────────────────────

describe("emitShapeModule", () => {
  it("writes the §4.5 header, the type import and an `as const satisfies` constant, with no timestamp", async () => {
    const { module, digest } = await compileOk(WORKED_EXAMPLE_TEXT, "apps/web/lib/work-management/shape-documents/inquiry-response-watch.gpp.json");
    const lines = module.split("\n");
    expect(lines.slice(0, 6)).toEqual([
      "// @generated by gpp-shape-compiler 0.1 from",
      "//   apps/web/lib/work-management/shape-documents/inquiry-response-watch.gpp.json",
      `//   ${digest}`,
      "// Do not edit. `pnpm --filter web check:gpp-shapes` fails if this file differs from a fresh compile.",
      'import type { WorkShapeDefinition } from "../work-shapes";',
      "",
    ]);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(lines[6]).toBe("export const INQUIRY_RESPONSE_WATCH_1_0_0 = {");
    expect(module.endsWith("} as const satisfies WorkShapeDefinition;\n")).toBe(true);
    expect(module).not.toContain("\r");
    expect(module).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("writes keys in WorkShapeDefinition declaration order, two-space indented", () => {
    const module = emitShapeModule(lowerToDefinition(WORKED_EXAMPLE), { sourcePath: "x.gpp.json", digest: "sha256:0" });
    const topLevel = module
      .split("\n")
      .filter((line) => /^ {2}[A-Za-z]+:/.test(line))
      .map((line) => line.trim().split(":")[0]);
    expect(topLevel).toEqual([
      "key", "version", "title", "description", "triggers", "stages", "stopConditions",
      "grants", "measures", "budgets", "reviewPoint", "collaborationShape",
    ]);
  });

  it("escapes strings with JSON.stringify, so quotes, backslashes and control characters stay literal", () => {
    const tricky = structuredClone(WORKED_EXAMPLE);
    tricky.title = 'A "quoted" \\ back\tslash\nline';
    const module = emitShapeModule(lowerToDefinition(tricky), { sourcePath: "x.gpp.json", digest: "sha256:0" });
    expect(module).toContain(`title: ${JSON.stringify(tricky.title)},`);
    expect(module.split("\n").filter((line) => line.startsWith("  title:"))).toHaveLength(1);
  });

  it("names the constant from key and version", () => {
    expect(shapeConstantName("inquiry-response-watch", "1.0.0")).toBe("INQUIRY_RESPONSE_WATCH_1_0_0");
    expect(shapeConstantName("a", "10.2.3")).toBe("A_10_2_3");
  });

  it("refuses a multi-line header value instead of writing a broken comment", () => {
    expect(() => emitShapeModule(lowerToDefinition(WORKED_EXAMPLE), { sourcePath: "a\nb", digest: "sha256:0" })).toThrow(/single-line/);
  });

  it("keeps `tools` absence and `tools: []` distinct in the text", () => {
    const withEmpty = structuredClone(WORKED_EXAMPLE);
    const send = withEmpty.stages[1];
    if (!send) throw new Error("no send stage");
    send.tools = [];
    const absent = emitShapeModule(lowerToDefinition(WORKED_EXAMPLE), { sourcePath: "x", digest: "sha256:0" });
    const empty = emitShapeModule(lowerToDefinition(withEmpty), { sourcePath: "x", digest: "sha256:0" });
    expect(absent.match(/tools:/g)).toHaveLength(1);
    expect(empty.match(/tools:/g)).toHaveLength(2);
    expect(empty).toContain("tools: [],");
  });
});

// ── type checking ───────────────────────────────────────────────────────────

describe("emitted modules type-check against WorkShapeDefinition", () => {
  it("the worked example type-checks; a corrupted copy fails `satisfies`", async () => {
    const { module } = await compileOk(WORKED_EXAMPLE_TEXT, "apps/web/lib/work-management/shape-documents/inquiry-response-watch.gpp.json");
    const badEvidence = module.replace('"draft-artifact"', '"not-an-evidence-kind"');
    const extraField = module.replace("  collaborationShape:", '  flow: { nodes: [], edges: [] },\n  collaborationShape:');
    const badGate = module.replace('mode: "enforced"', 'mode: "advisory"');
    expect(badEvidence).not.toBe(module);
    expect(extraField).not.toBe(module);
    expect(badGate).not.toBe(module);

    const diagnostics = typecheck({
      "good.shape.generated.ts": module,
      "bad-evidence.shape.generated.ts": badEvidence,
      "extra-field.shape.generated.ts": extraField,
      "bad-gate.shape.generated.ts": badGate,
    });
    expect(diagnostics.filter((line) => line.startsWith("good."))).toEqual([]);
    expect(diagnostics.some((line) => line.startsWith("bad-evidence.") && /not-an-evidence-kind/.test(line))).toBe(true);
    expect(diagnostics.some((line) => line.startsWith("extra-field.") && /flow/.test(line))).toBe(true);
    expect(diagnostics.some((line) => line.startsWith("bad-gate.") && /advisory/.test(line))).toBe(true);
  }, 120_000);

  it("`evidence` and `collaborationShape` keep their literal types (checked by tsc through a probe module)", async () => {
    const { module } = await compileOk(WORKED_EXAMPLE_TEXT, "inquiry-response-watch.gpp.json");
    const probe = (constant: string) =>
      [
        `import { ${constant} as S } from "./shape.generated";`,
        "type AssertTrue<T extends true> = T;",
        "type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;",
        'export type Evidence = AssertTrue<Exactly<(typeof S)["stages"][0]["evidence"][number], "draft-artifact">>;',
        'export type Collaboration = AssertTrue<Exactly<(typeof S)["collaborationShape"], "outward-review">>;',
        'export type Gate = AssertTrue<Exactly<(typeof S)["stages"][1]["advance"]["gate"]["mode"], "enforced">>;',
        "",
      ].join("\n");
    expect(typecheck({ "shape.generated.ts": module, "probe.ts": probe("INQUIRY_RESPONSE_WATCH_1_0_0") })).toEqual([]);

    // The probe is not vacuous: a JSON-style widened copy fails it.
    const widened = module.replace(" as const satisfies WorkShapeDefinition;", " satisfies WorkShapeDefinition;");
    const findings = typecheck({ "shape.generated.ts": widened, "probe.ts": probe("INQUIRY_RESPONSE_WATCH_1_0_0") });
    expect(findings.some((line) => line.startsWith("probe.ts"))).toBe(true);
  }, 120_000);
});

describe("every clean registry document compiles to a module that type-checks", () => {
  it("decompiled with the real table, and again with every scope test-ratified (typed gates present)", async () => {
    const allRatified: Record<string, GateRatificationEntry> = Object.fromEntries(
      Object.entries(GATE_RATIFICATION).map(([scope, entry]) => [
        scope,
        { status: "ratified", proposed: entry.proposed, basis: entry.basis, decisionId: "DI-000000000000", ratifiedAt: "2026-10-02" },
      ]),
    );
    const files: Record<string, string> = {};
    let gated = 0;
    for (const definition of [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS]) {
      for (const [variant, ratification] of [["real", GATE_RATIFICATION], ["ratified", allRatified]] as const) {
        const { document } = decompile(definition, { ratification });
        const text = JSON.stringify(document, null, 2);
        const result = await compileShapeDocument(text, sources, { sourcePath: `${definition.key}.gpp.json`, ratification, directSites });
        if (!result.accepted) continue;
        if (variant === "ratified" && result.module.includes("gate: {")) gated += 1;
        files[`${variant}-${definition.key}@${definition.version}.shape.generated.ts`] = result.module;
      }
    }
    // Most of the registry is clean (drc-registry.test.ts names the D-4 / C-1 exceptions).
    expect(Object.keys(files).length).toBeGreaterThan(40);
    expect(gated).toBeGreaterThan(0);
    expect(typecheck(files)).toEqual([]);
  }, 300_000);
});

// ── L2 ──────────────────────────────────────────────────────────────────────

describe("L2: decompile(compile(D)) ≡ D", () => {
  const cases: Array<[string, string]> = [
    ["the worked example", WORKED_EXAMPLE_TEXT],
    ...PASSING_FIXTURES.map((name): [string, string] => [name, readFileSync(join(DRC_DIR, name), "utf8")]),
  ];

  it.each(cases)("%s", async (_name, text) => {
    const { definition, document } = await compileOk(text, "fixture.gpp.json");
    const original = JSON.parse(text) as GppShapeDocument;
    const { document: back, awaitingRatification } = decompile(definition as WorkShapeDefinition, { ratification: TEST_RATIFICATION });
    expect(awaitingRatification).toEqual([]);
    expect(canonicalJson(back)).toBe(canonicalJson(original));
    expect(canonicalJson(back)).toBe(canonicalJson(document));
  });

  it("the passing fixtures exercise a typed gate and a stage binding", () => {
    const texts = cases.map(([, text]) => text).join("\n");
    expect(texts).toContain('"gate"');
    expect(texts).toContain('"binding"');
  });
});
