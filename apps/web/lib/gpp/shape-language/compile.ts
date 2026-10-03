// apps/web/lib/gpp/shape-language/compile.ts
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
// A document is emitted ONLY when no finding has severity `error`
// (hasBlockingDiagnostic). A refusal returns every finding and no module, so
// nothing downstream can write a half-checked shape. The result is
// discriminated on `accepted`, as parseShapeDocument's is: a refusal carries
// a list of diagnostics, not the single `error` of the server-action
// ActionResult (lib/shared/action-result.ts), so it is a different contract. Warnings, info and
// not-evaluated findings travel with a successful compile.
//
// Deterministic: the digest is sha256 over canonicalJson(document), so input
// key order and whitespace never reach the output; the module text is
// emitShapeModule's, which has no timestamp. Pure over its inputs: the only
// side effects are those of the injected resolve sources.
//
// OFFLINE TOOLING in Phase 3b: nothing in the running app imports this module.

import { createHash } from "node:crypto";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import { hasBlockingDiagnostic, sortDiagnostics, type GppDiagnostic } from "./diagnostics";
import { runDesignRules, type DesignRuleOptions } from "./drc";
import { emitShapeModule, lowerToDefinition, type LoweredWorkShapeDefinition } from "./emit";
import type { GppShapeDocument } from "./gpp-shape-schema";
import { parseShapeDocument } from "./parse";
import { resolveShapeDocument, type GppResolution, type GppResolveSources } from "./resolve";

export type CompileShapeOptions = DesignRuleOptions & {
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

/** Text → module, refusing on any error finding. */
export async function compileShapeDocument(
  text: string,
  sources: GppResolveSources,
  options: CompileShapeOptions,
): Promise<CompileShapeResult> {
  const parsed = parseShapeDocument(text);
  if (!parsed.accepted) return { accepted: false, diagnostics: parsed.diagnostics };

  const { document } = parsed;
  const resolution = await resolveShapeDocument(document, sources);
  const { sourcePath, ...ruleOptions } = options;
  const diagnostics = sortDiagnostics(runDesignRules(document, resolution, ruleOptions));
  if (hasBlockingDiagnostic(diagnostics)) return { accepted: false, diagnostics };

  const definition = lowerToDefinition(document);
  const digest = shapeDocumentDigest(document);
  const module = emitShapeModule(definition, { sourcePath, digest });
  return { accepted: true, document, resolution, definition, module, digest, diagnostics };
}
