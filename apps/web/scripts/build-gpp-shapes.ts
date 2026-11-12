/**
 * GPP shape generator — the one home for every artifact generated from GPP
 * shape documents (docs/superpowers/plans/2026-10-02-gpp-shape-notation-compiler-phase-3.md,
 * PR-3a-1 then PR-3b-5, BI-6DA17863; design
 * docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
 * §4.1, §7.1, §7.4, §7.5). Later phases extend this script; they do not add a
 * second one.
 *
 * Outputs, all committed:
 *   1. apps/web/lib/gpp/shape-language/gpp-shape.schema.json — the published
 *      JSON Schema 2020-12, from the Zod definition (gpp-shape-schema.ts).
 *   2. apps/web/lib/work-management/generated/<key>.shape.generated.ts per
 *      shape document apps/web/lib/work-management/shape-documents/<key>.gpp.json,
 *      and <key>@<version>.shape.generated.ts per frozen prior version
 *      shape-documents/prior/<key>@<version>.gpp.json — each the output of
 *      compileShapeDocument (parse → schema → resolve → design rules → emit),
 *      with the real gate ratification table. A document with any error
 *      finding fails the run; nothing half-checked is written.
 *   3. generated/index.generated.ts — GENERATED_WORK_SHAPES and
 *      GENERATED_PRIOR_WORK_SHAPES. work-shapes.ts reads GENERATED_WORK_SHAPES
 *      only to check that each compiled shape is registered, by reference, in
 *      its family file; it never spreads the index (plan "Spec refinements" 4).
 *   4. apps/web/lib/gpp/generated/gate-ratification-report.json —
 *      buildRatificationReport over the registry (property R).
 *
 * `--check` recompiles everything in memory and exits 1 naming every stale
 * file: a differing or missing output, and a generated module with no source
 * document. `--report` prints the design-rule findings for every registry
 * definition, decompiled, to stdout and writes nothing: it shows which shapes
 * are migratable.
 *
 * Deterministic: no timestamps, LF only, documents in code-unit order, key
 * order fixed by the lowering. Static — no DB, no network. Never writes
 * GPP_BINDING_ENFORCEMENT or GPP_BINDINGS.
 *
 * Not in scripts/lib/derived-artifacts-registry.mjs on purpose: it imports
 * Zod and workspace packages, which CI's lightweight source-policy job does
 * not install. .github/workflows/audit-gpp-shapes.yml runs it with a full
 * install, and lib/gpp/shape-language/generated-integrity.test.ts is the
 * vitest twin in the fast local gate.
 *
 * Usage:
 *   pnpm --filter web build:gpp-shapes           # write
 *   pnpm --filter web check:gpp-shapes           # fail if any generated file is stale
 *   pnpm --filter web exec tsx scripts/build-gpp-shapes.ts --report
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { WORK_SHAPE_PRIOR_VERSIONS } from "../lib/work-management/work-shape-prior-versions";
import { listWorkShapes, type WorkShapeDefinition } from "../lib/work-management/work-shapes";
import { compileShapeDocument } from "@/lib/gpp/shape-language/dpf-toolkit";
import { decompile } from "@/lib/gpp/shape-language/dpf-toolkit";
import { runDesignRules } from "@/lib/gpp/shape-language/dpf-toolkit";
import type { KnownFinding } from "../lib/gpp/shape-language/known-findings";
import {
  GENERATED_SHAPE_TYPE_IMPORT,
  GPP_SHAPE_COMPILER_ID,
  shapeConstantName,
} from "@/lib/gpp/shape-language/dpf-toolkit";
import { GATE_RATIFICATION, type GateRatificationEntry } from "../lib/gpp/shape-language/gate-ratification";
import { gppLayoutSchema } from "@dpf/validators/gpp/gpp-layout-schema";
import { gppShapeJsonSchema } from "@dpf/validators/gpp/gpp-shape-schema";
import { buildRatificationReport } from "../lib/gpp/shape-language/ratification-report";
import { resolveShapeDocument, type GppResolveSources } from "@dpf/validators/gpp/resolve";
import { defaultResolveSources, liveDirectExecuteSites } from "../lib/gpp/shape-language/resolve-sources";
import { findRepoRoot, serializeStableJson, writeOrCheckGeneratedText } from "./registry-generator-support";

export const GPP_SHAPE_SCHEMA_REL = "apps/web/lib/gpp/shape-language/gpp-shape.schema.json";
export const SHAPE_DOCUMENTS_REL = "apps/web/lib/work-management/shape-documents";
export const PRIOR_SHAPE_DOCUMENTS_REL = `${SHAPE_DOCUMENTS_REL}/prior`;
export const GENERATED_SHAPES_REL = "apps/web/lib/work-management/generated";
export const GENERATED_INDEX_REL = `${GENERATED_SHAPES_REL}/index.generated.ts`;
export const RATIFICATION_REPORT_REL = "apps/web/lib/gpp/generated/gate-ratification-report.json";
export const DECLARED_FLOWS_REL = "apps/web/lib/work-management/declared-flows";
export const GENERATED_FLOWS_INDEX_REL = `${GENERATED_SHAPES_REL}/declared-flows.generated.ts`;
const FLOW_MODULE_SUFFIX = ".flow.generated.ts";
const LABEL = "gpp-shapes";
const BUILD_COMMAND = "pnpm --filter web build:gpp-shapes";
const DOCUMENT_SUFFIX = ".gpp.json";
const MODULE_SUFFIX = ".shape.generated.ts";

/** What a compile reads besides the document. Production uses defaultGppShapesContext(); tests inject. */
export type GppShapesContext = {
  sources: GppResolveSources;
  directSites: ReadonlyMap<string, readonly string[]>;
  ratification: Readonly<Record<string, GateRatificationEntry>>;
  /** The registry the ratification report and `--report` read. */
  definitions: readonly WorkShapeDefinition[];
};

export function defaultGppShapesContext(): GppShapesContext {
  return {
    sources: defaultResolveSources(),
    directSites: liveDirectExecuteSites(),
    ratification: GATE_RATIFICATION,
    definitions: [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS],
  };
}

function byCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

type ShapeDocumentFile = {
  /** Repo-relative, forward slashes. */
  relativePath: string;
  prior: boolean;
  /** The file name without `.gpp.json`: `<key>`, or `<key>@<version>` for a prior. */
  stem: string;
};

/** Shape documents under `root`, current then prior, each in code-unit order. Layout sidecars are not documents. */
export function listShapeDocuments(root: string): ShapeDocumentFile[] {
  const list = (relativeDir: string, prior: boolean): ShapeDocumentFile[] => {
    const dir = join(root, relativeDir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith(DOCUMENT_SUFFIX))
      .sort(byCodeUnit)
      .map((name) => ({ relativePath: `${relativeDir}/${name}`, prior, stem: name.slice(0, -DOCUMENT_SUFFIX.length) }));
  };
  return [...list(SHAPE_DOCUMENTS_REL, false), ...list(PRIOR_SHAPE_DOCUMENTS_REL, true)];
}

/** Generated shape modules present under `root`, in code-unit order (the index is not one). */
export function listGeneratedShapeModules(root: string): string[] {
  const dir = join(root, GENERATED_SHAPES_REL);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(MODULE_SUFFIX))
    .sort(byCodeUnit)
    .map((name) => `${GENERATED_SHAPES_REL}/${name}`);
}

type IndexEntry = { constant: string; specifier: string; prior: boolean };

/** Flow modules are offline declarations, excluded from the runtime work-shape registry. */
export function listGeneratedFlowModules(root: string): string[] {
  const dir = join(root, GENERATED_SHAPES_REL);
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(FLOW_MODULE_SUFFIX)).sort(byCodeUnit).map((name) => `${GENERATED_SHAPES_REL}/${name}`) : [];
}

function flowIndexModule(entries: readonly IndexEntry[]): string {
  return [
    `// @generated by ${GPP_SHAPE_COMPILER_ID} from ${DECLARED_FLOWS_REL}/*.gpp.json`,
    "// Offline declared flows only. Never imported by the runtime registry.",
    `import type { WorkShapeDefinition } from "${GENERATED_SHAPE_TYPE_IMPORT}";`,
    ...entries.map((entry) => `import { ${entry.constant} } from "${entry.specifier}";`),
    "",
    `export const GENERATED_DECLARED_FLOWS: readonly WorkShapeDefinition[] = ${entries.length ? `[\n${entries.map((entry) => `  ${entry.constant},`).join("\n")}\n]` : "[]"};`,
    "",
  ].join("\n");
}

async function compileDeclaredFlows(root: string, context: GppShapesContext, outputs: Map<string, string>, refusals: string[]) {
  const dir = join(root, DECLARED_FLOWS_REL);
  const entries: IndexEntry[] = [];
  const registered = new Set(context.definitions.map((definition) => definition.key));
  const names = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(DOCUMENT_SUFFIX)).sort(byCodeUnit) : [];
  for (const name of names) {
    const sourcePath = `${DECLARED_FLOWS_REL}/${name}`;
    const stem = name.slice(0, -DOCUMENT_SUFFIX.length);
    try {
      const sidecarPath = join(dir, `${stem}.known-findings.ts`);
      let knownFindings: readonly KnownFinding[] | undefined;
      let sandboxStages: ReadonlySet<string> | undefined;
      if (existsSync(sidecarPath)) {
        const digest = createHash("sha256").update(readFileSync(sidecarPath)).digest("hex");
        // Trusted, source-controlled static modules; content addressing avoids cached stale sidecars.
        const sidecar = await import(/* @vite-ignore */ `${pathToFileURL(sidecarPath).href}?digest=${digest}`);
        if (!Array.isArray(sidecar.KNOWN_FINDINGS)) throw new Error("Sidecar KNOWN_FINDINGS must be an array.");
        knownFindings = sidecar.KNOWN_FINDINGS;
        if (sidecar.SANDBOX_STAGES !== undefined) {
          if (!(sidecar.SANDBOX_STAGES instanceof Set) || [...sidecar.SANDBOX_STAGES].some((stage) => typeof stage !== "string")) throw new Error("Sidecar SANDBOX_STAGES must be a set of stage keys.");
          sandboxStages = sidecar.SANDBOX_STAGES;
        }
      }
      const result = await compileShapeDocument(readFileSync(join(dir, name), "utf8"), context.sources, {
        sourcePath, ratification: context.ratification, directSites: context.directSites,
        ...(knownFindings !== undefined ? { knownFindings } : {}), ...(sandboxStages !== undefined ? { sandboxStages } : {}),
      });
      if (!result.accepted) {
        const blocking = result.diagnostics.filter((finding) => finding.severity === "error" || finding.severity === "not-evaluated");
        for (const finding of blocking) {
          refusals.push(`${sourcePath}: ${finding.code} at ${finding.elementId}: ${finding.message}`);
        }
        if (blocking.length === 0) refusals.push(`${sourcePath}: compilation was held; no generated artifacts may change.`);
        continue;
      }
      for (const entry of result.staleKnownFindings) refusals.push(`${sourcePath}: stale known finding ${entry.rule} at ${entry.elementId}.`);
      const { key, version } = result.definition;
      if (stem !== key) { refusals.push(`${sourcePath}: a declared flow for ${key} must be named ${key}${DOCUMENT_SUFFIX}.`); continue; }
      if (registered.has(key)) { refusals.push(`${sourcePath}: ${key} collides with a registered work-shape key.`); continue; }
      if (sandboxStages && [...sandboxStages].some((key) => !result.document.stages.some((stage) => stage.key === key))) {
        refusals.push(`${sourcePath}: SANDBOX_STAGES contains an unknown stage key.`); continue;
      }
      const moduleName = `${key}${FLOW_MODULE_SUFFIX}`;
      outputs.set(`${GENERATED_SHAPES_REL}/${moduleName}`, result.module);
      entries.push({ constant: shapeConstantName(key, version), specifier: `./${moduleName.slice(0, -3)}`, prior: false });
    } catch (error) {
      refusals.push(`${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  outputs.set(GENERATED_FLOWS_INDEX_REL, flowIndexModule(entries));
}

function indexModule(entries: readonly IndexEntry[]): string {
  const list = (prior: boolean) => {
    const constants = entries.filter((entry) => entry.prior === prior).map((entry) => entry.constant);
    return constants.length === 0 ? "[]" : `[\n${constants.map((constant) => `  ${constant},`).join("\n")}\n]`;
  };
  return [
    `// @generated by ${GPP_SHAPE_COMPILER_ID} from`,
    `//   ${SHAPE_DOCUMENTS_REL}/*${DOCUMENT_SUFFIX} and ${PRIOR_SHAPE_DOCUMENTS_REL}/*${DOCUMENT_SUFFIX}`,
    "// Do not edit. `pnpm --filter web check:gpp-shapes` fails if this file differs from a fresh compile.",
    `import type { WorkShapeDefinition } from "${GENERATED_SHAPE_TYPE_IMPORT}";`,
    ...entries.map((entry) => `import { ${entry.constant} } from "${entry.specifier}";`),
    "",
    `export const GENERATED_WORK_SHAPES: readonly WorkShapeDefinition[] = ${list(false)};`,
    "",
    `export const GENERATED_PRIOR_WORK_SHAPES: readonly WorkShapeDefinition[] = ${list(true)};`,
    "",
  ].join("\n");
}

export type GppShapeOutputs = {
  /** Repo-relative path → exact file text, in a fixed order. */
  outputs: Map<string, string>;
  /** One line per document the compiler refused, or whose name does not match its key. */
  refusals: string[];
};

/** Every generated file's text, computed in memory. Reads documents under `root`; writes nothing. */
export async function buildGppShapeOutputs(root: string, context: GppShapesContext): Promise<GppShapeOutputs> {
  const outputs = new Map<string, string>();
  const refusals: string[] = [];
  outputs.set(GPP_SHAPE_SCHEMA_REL, serializeStableJson(gppShapeJsonSchema()));

  const entries: IndexEntry[] = [];
  const seen = new Set<string>();
  for (const file of listShapeDocuments(root)) {
    const sidecarPath = join(root, file.relativePath.slice(0, -DOCUMENT_SUFFIX.length) + ".known-findings.ts");
    if (existsSync(sidecarPath)) { refusals.push(`${file.relativePath}: finding sidecar is allowed only under declared-flows.`); continue; }
    const layoutPath = join(root, file.relativePath.slice(0, -DOCUMENT_SUFFIX.length) + ".layout.json");
    const layout = existsSync(layoutPath) ? gppLayoutSchema.safeParse(JSON.parse(readFileSync(layoutPath, "utf8"))) : undefined;
    if (layout && !layout.success) {
      refusals.push(`${file.relativePath}: its layout sidecar is not a valid gpp-layout/0.1 document.`);
      continue;
    }
    const result = await compileShapeDocument(readFileSync(join(root, file.relativePath), "utf8"), context.sources, {
      sourcePath: file.relativePath,
      ratification: context.ratification,
      directSites: context.directSites,
      ...(layout?.success ? { layout: layout.data } : {}),
    });
    if (!result.accepted) {
      const blocking = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "not-evaluated");
      for (const finding of blocking) {
        refusals.push(`${file.relativePath}: ${finding.rule} at ${finding.elementId}${finding.path ? ` (${finding.path})` : ""}: ${finding.message}`);
      }
      // accepted:false is itself a refusal, including any future diagnostic form.
      if (blocking.length === 0) refusals.push(`${file.relativePath}: compilation was held; no generated artifacts may change.`);
      continue;
    }
    const { key, version } = result.definition;
    const expectedStem = file.prior ? `${key}@${version}` : key;
    if (file.stem !== expectedStem) {
      refusals.push(`${file.relativePath}: a ${file.prior ? "prior" : "current"} document for ${key}@${version} must be named ${expectedStem}${DOCUMENT_SUFFIX}.`);
      continue;
    }
    if (seen.has(`${key}@${version}`)) {
      refusals.push(`${file.relativePath}: ${key}@${version} is declared by more than one document.`);
      continue;
    }
    seen.add(`${key}@${version}`);
    const moduleName = `${expectedStem}${MODULE_SUFFIX}`;
    outputs.set(`${GENERATED_SHAPES_REL}/${moduleName}`, result.module);
    entries.push({ constant: shapeConstantName(key, version), specifier: `./${moduleName.slice(0, -".ts".length)}`, prior: file.prior });
  }

  await compileDeclaredFlows(root, context, outputs, refusals);
  outputs.set(GENERATED_INDEX_REL, indexModule(entries));
  outputs.set(RATIFICATION_REPORT_REL, serializeStableJson(buildRatificationReport(context.definitions, context.ratification)));
  return { outputs, refusals };
}

export type GppShapesRun = { files: string[]; removed: string[] };

/**
 * Write (or, with `check`, verify) every generated GPP shape artifact under
 * `root`. Throws, naming every refusal or every stale file. Writing also
 * removes generated shape modules that no document produces any more.
 */
export async function runGppShapesGenerator(options: {
  root: string;
  check: boolean;
  context?: GppShapesContext;
}): Promise<GppShapesRun> {
  const context = options.context ?? defaultGppShapesContext();
  const { outputs, refusals } = await buildGppShapeOutputs(options.root, context);
  if (refusals.length > 0) {
    throw new Error(`[${LABEL}] REFUSED - the compiler refused ${refusals.length} finding(s); nothing was written:\n  ${refusals.join("\n  ")}`);
  }

  const orphans = [...listGeneratedShapeModules(options.root), ...listGeneratedFlowModules(options.root)].filter((path) => !outputs.has(path));
  if (options.check) {
    const stale: string[] = [];
    for (const [relativePath, text] of outputs) {
      try {
        writeOrCheckGeneratedText({ root: options.root, relativePath, text, check: true, label: LABEL, buildCommand: BUILD_COMMAND });
      } catch (error) {
        stale.push(error instanceof Error ? error.message : String(error));
      }
    }
    for (const orphan of orphans) {
      stale.push(`[${LABEL}] STALE - ${orphan} has no source document. Run: ${BUILD_COMMAND}`);
    }
    if (stale.length > 0) throw new Error(stale.join("\n"));
    return { files: [...outputs.keys()], removed: [] };
  }

  for (const [relativePath, text] of outputs) {
    writeOrCheckGeneratedText({ root: options.root, relativePath, text, check: false, label: LABEL, buildCommand: BUILD_COMMAND });
  }
  for (const orphan of orphans) rmSync(join(options.root, orphan));
  return { files: [...outputs.keys()], removed: orphans };
}

/**
 * `--report`: the design-rule errors and warnings for every registry
 * definition, decompiled with the context's ratification table, and whether
 * each is migratable (no error, every governed scope ratified). Text only.
 */
export async function gppShapesReport(context: GppShapesContext): Promise<string> {
  const lines: string[] = [];
  let migratable = 0;
  const definitions = [...context.definitions].sort((left, right) =>
    byCodeUnit(`${left.key}@${left.version}`, `${right.key}@${right.version}`),
  );
  for (const definition of definitions) {
    const id = `${definition.key}@${definition.version}`;
    const { document, awaitingRatification } = decompile(definition, { ratification: context.ratification });
    const findings = runDesignRules(document, await resolveShapeDocument(document, context.sources), {
      ratification: context.ratification,
      directSites: context.directSites,
    }).filter((finding) => finding.severity === "error" || finding.severity === "warning");
    const blocked = findings.some((finding) => finding.severity === "error");
    const ready = !blocked && awaitingRatification.length === 0;
    if (ready) migratable += 1;
    const status = ready ? "migratable" : blocked ? "refused" : `awaiting ratification (${awaitingRatification.join(", ")})`;
    lines.push(`${id}: ${status}`);
    for (const finding of findings) lines.push(`  ${finding.severity} ${finding.rule} ${finding.elementId}: ${finding.message}`);
  }
  lines.push(`${migratable} of ${definitions.length} registry definitions are migratable.`);
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const report = process.argv.includes("--report");
  try {
    if (report) {
      process.stdout.write(await gppShapesReport(defaultGppShapesContext()));
      return;
    }
    const run = await runGppShapesGenerator({ root: findRepoRoot(), check });
    for (const path of run.removed) console.error(`[${LABEL}] removed: ${path}`);
    console.error(`[${LABEL}] ${check ? "up to date" : "wrote"}: ${run.files.length} file(s)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && /build-gpp-shapes\.[cm]?ts$/.test(process.argv[1])) void main();
