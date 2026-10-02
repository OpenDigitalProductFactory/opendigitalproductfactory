// AC-EMIT-INTEGRITY, the vitest twin of `pnpm --filter web check:gpp-shapes`
// (PR-3b-5, BI-6DA17863). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §7.1 step 7, §7.5 ("hand edits to generated files fail check:gpp-shapes in
// CI ... and in a vitest test, so the fast local gate catches them too");
// plan: docs/superpowers/plans/2026-10-02-gpp-shape-notation-compiler-phase-3.md
// (PR-3b-5).
//
// Runs the same function as `--check` (runGppShapesGenerator), in-process.
// The committed tree must be fresh. Every other case works on a temp root
// holding a real shape document — a registry definition, decompiled, that
// compiles with the real ratification table — so the stale-file rules are
// exercised on a non-empty generated set without touching the repository.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { listWorkShapes, type WorkShapeDefinition } from "@/lib/work-management/work-shapes";

import {
  buildGppShapeOutputs,
  defaultGppShapesContext,
  GENERATED_INDEX_REL,
  GENERATED_SHAPES_REL,
  listGeneratedShapeModules,
  PRIOR_SHAPE_DOCUMENTS_REL,
  RATIFICATION_REPORT_REL,
  runGppShapesGenerator,
  SHAPE_DOCUMENTS_REL,
  type GppShapesContext,
} from "../../../scripts/build-gpp-shapes";
import { compileShapeDocument } from "./compile";
import { decompile } from "./decompile";

const REPO_ROOT = join(__dirname, "../../../../..");

let context: GppShapesContext;
/** Two registry definitions whose decompiled documents compile cleanly: one placed as current, one as prior. */
let current: WorkShapeDefinition;
let prior: WorkShapeDefinition;
const roots: string[] = [];

async function compilesClean(definition: WorkShapeDefinition): Promise<boolean> {
  const { document } = decompile(definition, { ratification: context.ratification });
  const result = await compileShapeDocument(JSON.stringify(document), context.sources, {
    sourcePath: "probe",
    ratification: context.ratification,
    directSites: context.directSites,
  });
  return result.accepted;
}

beforeAll(async () => {
  context = defaultGppShapesContext();
  // Every frozen prior version is refused today (C-1, see drc-registry.test.ts),
  // so the prior-directory document is a second clean current definition: the
  // generator names and indexes a document by its directory, not its history.
  const clean: WorkShapeDefinition[] = [];
  for (const definition of listWorkShapes()) {
    if (await compilesClean(definition)) clean.push(definition);
    if (clean.length === 2) break;
  }
  if (clean.length < 2) throw new Error("fewer than two registry definitions compile cleanly with the real ratification table");
  [current, prior] = clean as [WorkShapeDefinition, WorkShapeDefinition];
}, 180_000);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "gpp-integrity-"));
  roots.push(root);
  return root;
}

function write(root: string, relativePath: string, text: string): void {
  mkdirSync(dirname(join(root, relativePath)), { recursive: true });
  writeFileSync(join(root, relativePath), text, "utf8");
}

const read = (root: string, relativePath: string) => readFileSync(join(root, relativePath), "utf8");
const documentText = (definition: WorkShapeDefinition) => `${JSON.stringify(decompile(definition).document, null, 2)}\n`;
const currentDocRel = () => `${SHAPE_DOCUMENTS_REL}/${current.key}.gpp.json`;
const currentModuleRel = () => `${GENERATED_SHAPES_REL}/${current.key}.shape.generated.ts`;
const priorDocRel = () => `${PRIOR_SHAPE_DOCUMENTS_REL}/${prior.key}@${prior.version}.gpp.json`;
const priorModuleRel = () => `${GENERATED_SHAPES_REL}/${prior.key}@${prior.version}.shape.generated.ts`;

/** A temp root with one current and one prior document, generated and fresh. */
async function generatedRoot(): Promise<string> {
  const root = tempRoot();
  write(root, currentDocRel(), documentText(current));
  write(root, priorDocRel(), documentText(prior));
  await runGppShapesGenerator({ root, check: false, context });
  await expect(runGppShapesGenerator({ root, check: true, context })).resolves.toBeDefined();
  return root;
}

describe("AC-EMIT-INTEGRITY: committed generated files equal a fresh compile", () => {
  it("the committed tree is fresh (the same function as --check)", async () => {
    const run = await runGppShapesGenerator({ root: REPO_ROOT, check: true, context });
    expect(run.files).toEqual(expect.arrayContaining([GENERATED_INDEX_REL, RATIFICATION_REPORT_REL]));
  });

  it("at merge there are no shape documents and the generated index is empty", async () => {
    expect(listGeneratedShapeModules(REPO_ROOT)).toEqual([]);
    const { outputs } = await buildGppShapeOutputs(REPO_ROOT, context);
    expect(outputs.get(GENERATED_INDEX_REL)).toMatch(/GENERATED_WORK_SHAPES: readonly WorkShapeDefinition\[\] = \[\];/);
    expect(outputs.get(GENERATED_INDEX_REL)).toMatch(/GENERATED_PRIOR_WORK_SHAPES: readonly WorkShapeDefinition\[\] = \[\];/);
  });

  it("the generated index is not imported by work-shapes.ts (Phase 3b: nothing reaches the runtime)", () => {
    expect(read(REPO_ROOT, "apps/web/lib/work-management/work-shapes.ts")).not.toMatch(/generated\/index\.generated/);
  });
});

describe("AC-EMIT-INTEGRITY: the check names every stale file", () => {
  it("writes one module per document, named for current and prior versions, and lists them in the index", async () => {
    const root = await generatedRoot();
    expect(listGeneratedShapeModules(root)).toEqual([currentModuleRel(), priorModuleRel()].sort());
    const index = read(root, GENERATED_INDEX_REL);
    expect(index).toContain(`from "./${current.key}.shape.generated";`);
    expect(index).toContain(`from "./${prior.key}@${prior.version}.shape.generated";`);
    expect(read(root, currentModuleRel())).toContain(`//   ${currentDocRel()}`);
  });

  it("a hand-edited generated module is reported stale, by name", async () => {
    const root = await generatedRoot();
    const text = read(root, currentModuleRel());
    write(root, currentModuleRel(), text.replace(/: "/, ': "X'));
    await expect(runGppShapesGenerator({ root, check: true, context })).rejects.toThrow(`STALE - ${currentModuleRel()} is out of date`);
  });

  it("a one-byte edit anywhere (here: the trailing newline) is stale", async () => {
    const root = await generatedRoot();
    write(root, priorModuleRel(), read(root, priorModuleRel()).replace(/\n$/, ""));
    await expect(runGppShapesGenerator({ root, check: true, context })).rejects.toThrow(priorModuleRel());
  });

  it("a hand-edited index or report is stale", async () => {
    const root = await generatedRoot();
    write(root, GENERATED_INDEX_REL, `${read(root, GENERATED_INDEX_REL)}// edit\n`);
    write(root, RATIFICATION_REPORT_REL, read(root, RATIFICATION_REPORT_REL).replace('"proposed"', '"ratified"'));
    const failure = runGppShapesGenerator({ root, check: true, context });
    await expect(failure).rejects.toThrow(GENERATED_INDEX_REL);
    await expect(runGppShapesGenerator({ root, check: true, context })).rejects.toThrow(RATIFICATION_REPORT_REL);
  });

  it("a generated module without a source document is reported stale; writing removes it", async () => {
    const root = await generatedRoot();
    rmSync(join(root, currentDocRel()));
    await expect(runGppShapesGenerator({ root, check: true, context })).rejects.toThrow(`STALE - ${currentModuleRel()} has no source document`);
    const run = await runGppShapesGenerator({ root, check: false, context });
    expect(run.removed).toEqual([currentModuleRel()]);
    expect(existsSync(join(root, currentModuleRel()))).toBe(false);
    await expect(runGppShapesGenerator({ root, check: true, context })).resolves.toBeDefined();
  });

  it("a document without a generated module is reported stale", async () => {
    const root = await generatedRoot();
    rmSync(join(root, priorModuleRel()));
    await expect(runGppShapesGenerator({ root, check: true, context })).rejects.toThrow(`STALE - ${priorModuleRel()} is out of date`);
  });

  it("an edited document makes its module stale", async () => {
    const root = await generatedRoot();
    const document = JSON.parse(read(root, currentDocRel())) as { title: string };
    write(root, currentDocRel(), JSON.stringify({ ...document, title: `${document.title} (edited)` }));
    await expect(runGppShapesGenerator({ root, check: true, context })).rejects.toThrow(currentModuleRel());
  });

  it("a refused document fails the run in both modes and nothing is written", async () => {
    const root = tempRoot();
    write(root, `${SHAPE_DOCUMENTS_REL}/drc-unregistered-tool.gpp.json`, readFileSync(join(__dirname, "__fixtures__", "drc", "c-2-unregistered-tool.gpp.json"), "utf8"));
    await expect(runGppShapesGenerator({ root, check: false, context })).rejects.toThrow(/REFUSED[\s\S]*C-2/);
    await expect(runGppShapesGenerator({ root, check: true, context })).rejects.toThrow(/REFUSED/);
    expect(existsSync(join(root, GENERATED_INDEX_REL))).toBe(false);
    expect(listGeneratedShapeModules(root)).toEqual([]);
  });

  it("a document whose file name does not match its key is refused", async () => {
    const root = tempRoot();
    write(root, `${SHAPE_DOCUMENTS_REL}/not-the-key.gpp.json`, documentText(current));
    await expect(runGppShapesGenerator({ root, check: false, context })).rejects.toThrow(`must be named ${current.key}.gpp.json`);
  });
});
