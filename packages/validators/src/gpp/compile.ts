// Portable GPP compile pipeline (BI-721C467A).
//
// The compile pipeline: shape-document text → generated TypeScript module.
// Design: docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §7.1 (pipeline), §7.2 ("errors stop emission"), §7.4 (determinism, L2);
// plan: docs/superpowers/plans/2026-10-02-gpp-shape-notation-compiler-phase-3.md
// (PR-3b-4, BI-6DA17863).
//
// Steps, each an existing module:
//   1–2 parse + schema   parseShapeDocument (parse.ts)
//   3   resolve          resolveShapeDocument with injected sources (resolve.ts)
//   4   design rules     runDesignRules (drc.ts), which also runs soundness S-1…S-6
//   5   lower + emit     lowerToDefinition, emitShapeModule (emit.ts)
//
// By default any error finding stops emission (hasBlockingDiagnostic). A trusted
// host can explicitly supply an assessment/emission disposition for ordinary
// offline findings. Missing required facts always hold before that port. A refusal
// returns every finding and no module, so
// nothing downstream can write a half-checked shape. The result is
// discriminated on `accepted`, as parseShapeDocument's is: a refusal carries
// a list of diagnostics, not the single `error` of the server-action
// ActionResult (../action-result.ts), so it is a different contract. Warnings, info and
// standing not-evaluated findings travel with a successful model compile.
// Missing required tool/child/policy facts instead hold compilation. Neither
// result qualifies a host, grants permission, nor admits execution.
//
// Deterministic: the digest is sha256 over canonicalJson(document), so input
// key order and whitespace never reach the output; the module text is
// emitShapeModule's, which has no timestamp. Pure over its inputs: the only
// side effects are those of the injected resolve sources.
//
// OFFLINE TOOLING in Phase 3b: nothing in the running app imports this module.

import { createHash } from "node:crypto";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import { hasBlockingDiagnostic, sortDiagnostics, type GppDiagnostic } from "./diagnostics.js";
import { runDesignRules, type DesignRuleOptions } from "./drc.js";
import { emitShapeModule, lowerToDefinition, type LoweredWorkShapeDefinition } from "./emit.js";
import type { GppShapeDocument } from "./gpp-shape-schema.js";
import { parseShapeDocument } from "./parse.js";
import { resolveShapeDocument, type GppResolution, type GppResolveSources } from "./resolve.js";
import { hasDesignRulePolicy } from "./design-rule-policy.js";
import { CONSEQUENCE_CLASSES } from "./tool-facts.js";

/** Missing safety facts are compilation holds, even where a design preview can continue. */
function unavailableFacts(resolution: GppResolution): GppDiagnostic[] {
  const diagnostics: GppDiagnostic[] = [];
  for (const [index, stage] of resolution.stages.entries()) {
    for (const [toolIndex, tool] of (stage.tools ?? []).entries()) {
      if (tool.registered && (tool.consequenceClass === null || !CONSEQUENCE_CLASSES.includes(tool.consequenceClass)
        || typeof tool.consequential !== "boolean" || typeof tool.alignmentRequired !== "boolean")) {
        diagnostics.push({ rule: "C-5", code: "C-5", severity: "not-evaluated", elementId: tool.elementId,
          path: `/stages/${index}/tools/${toolIndex}`, message: "The registered tool's consequence classification is unavailable; compilation is held." });
      }
    }
    if (stage.subShape?.exists && (stage.subShape.grants === undefined || stage.subShape.tools === undefined)) {
      diagnostics.push({ rule: "D-9", code: "D-9", severity: "not-evaluated", elementId: stage.elementId,
        path: `/stages/${index}/subShape`, message: "The registered child shape's grants and stage tools are unavailable; compilation is held." });
    }
    if (stage.subShape?.unavailableRefs?.length) {
      diagnostics.push({ rule: "D-10", code: "D-10", severity: "not-evaluated", elementId: stage.elementId,
        path: `/stages/${index}/subShape`, message: "The child shape graph could not be read completely within the 1024-reference bound; compilation is held." });
    }
  }
  return diagnostics;
}

/** Trusted host assessment/emission policy, never permission to execute the model.
 * It may annotate or retain offline findings. Missing policy, tool and child facts
 * hold before this port is called, and the ordinary compiler has no disposition. */
export type CompileDiagnosticDisposition = (diagnostics: readonly GppDiagnostic[]) => {
  diagnostics: readonly GppDiagnostic[];
  blocking: boolean;
};

export type CompileShapeOptions = DesignRuleOptions & {
  diagnosticDisposition?: CompileDiagnosticDisposition;
  typeImport: string;
  checkInstruction?: string;
  /** The source document, repo-relative with forward slashes; written into the module header. */
  sourcePath: string;
};

export type CompileShapeResult =
  | {
      accepted: true;
      document: GppShapeDocument;
      resolution: GppResolution;
      definition: LoweredWorkShapeDefinition;
      module: string;
      digest: string;
      diagnostics: GppDiagnostic[];
    }
  | { accepted: false; diagnostics: GppDiagnostic[] };

/** `sha256:<hex>` over the document's canonical JSON. Key order and whitespace do not change it. */
export function shapeDocumentDigest(document: GppShapeDocument): string {
  return `sha256:${createHash("sha256").update(canonicalJson(document), "utf8").digest("hex")}`;
}

/** Text → module; strict errors by default, with mandatory host-fact holds. */
export async function compileShapeDocument(
  text: string,
  sources: GppResolveSources,
  options: CompileShapeOptions,
): Promise<CompileShapeResult> {
  const parsed = parseShapeDocument(text);
  if (!parsed.accepted) return { accepted: false, diagnostics: parsed.diagnostics };

  const { document } = parsed;
  let resolution: GppResolution;
  let diagnostics: GppDiagnostic[];
  try {
    resolution = await resolveShapeDocument(document, sources);
    const { sourcePath: _sourcePath, diagnosticDisposition, ...ruleOptions } = options;
    const missing = unavailableFacts(resolution);
    diagnostics = sortDiagnostics([...runDesignRules(document, resolution, ruleOptions), ...missing]);
    const unresolvedRequiredFacts = resolution.stages.some(stage =>
      stage.tools?.some(tool => !tool.registered || tool.grantRequirement === null)
      || (stage.subShape !== undefined && !stage.subShape.exists));
    if (!hasDesignRulePolicy(options.policy) || missing.length || unresolvedRequiredFacts) return { accepted: false, diagnostics };
    if (diagnosticDisposition) {
      const disposition = diagnosticDisposition(diagnostics);
      if (!disposition || !Array.isArray(disposition.diagnostics) || typeof disposition.blocking !== "boolean") throw new Error("Invalid diagnostic disposition");
      diagnostics = sortDiagnostics(disposition.diagnostics);
      if (disposition.blocking) return { accepted: false, diagnostics };
    } else if (hasBlockingDiagnostic(diagnostics)) return { accepted: false, diagnostics };
  } catch {
    // Host registry and enforcement-policy ports may be temporarily unavailable.
    // Exception text can contain private context and is deliberately not emitted.
    return { accepted: false, diagnostics: [{ rule: "C-5", code: "C-5", severity: "not-evaluated",
      elementId: "document", path: "", message: "A required host fact or policy port is unavailable; compilation is held." }] };
  }

  const definition = lowerToDefinition(document);
  const digest = shapeDocumentDigest(document);
  const module = emitShapeModule(definition, { sourcePath: options.sourcePath, digest, typeImport: options.typeImport, checkInstruction: options.checkInstruction });
  return { accepted: true, document, resolution, definition, module, digest, diagnostics };
}
