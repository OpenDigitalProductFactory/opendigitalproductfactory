import { parseShapeDocument } from "@dpf/validators/gpp/parse";
import { stageElementId } from "@dpf/validators/gpp/element-ids";
import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/profession-registry";
/** DPF policy adapter for the portable offline toolkit (BI-721C467A).
 * The build generator and registry tests consume this adapter. It owns DPF's
 * current policy tables and generated destination; no compiler is duplicated. */
import { compileShapeDocument as compilePortable, type CompileShapeOptions as PortableCompileOptions, type CompileShapeResult as PortableCompileResult } from "@dpf/validators/gpp/compile";
import { hasBlockingDiagnostic, type GppDiagnostic } from "@dpf/validators/gpp/diagnostics";
import { decompile as decompilePortable, type DecompileOptions } from "@dpf/validators/gpp/decompile";
import { runDesignRules as runPortableRules, type DesignRuleOptions as PortableRuleOptions } from "@dpf/validators/gpp/drc";
import { emitShapeModule as emitPortable, type EmitShapeModuleOptions as PortableEmitOptions, type LoweredWorkShapeDefinition } from "@dpf/validators/gpp/emit";
import type { GppShapeDocument } from "@dpf/validators/gpp/gpp-shape-schema";
import type { GppResolution, GppResolveSources } from "@dpf/validators/gpp/resolve";
import type { WorkShapeDefinition } from "@dpf/validators/gpp/work-shape-contracts";
import type { GppDesignRulePolicy } from "@dpf/validators/gpp/design-rule-policy";
import { COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS } from "@/lib/coworker/authorized-surface-coworker-contract";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { roomGrantsFromWorkShape } from "@/lib/work-management/room-turn-authority";
import { KNOWN_STAGE_TOOL_GAPS, stageToolGapKey } from "@/lib/work-management/stage-tool-gaps";
import { governedDecisionStage } from "@/lib/work-management/workroom-stage-decision";
import { bindingEnforcementEntry } from "../binding-enforcement";
import { GATE_RATIFICATION } from "./gate-ratification";
import { applyKnownFindings, type KnownFinding } from "./known-findings";

const gapKeys = new Set(KNOWN_STAGE_TOOL_GAPS.map(gap => stageToolGapKey(gap.shapeKey, gap.stageKey)));
export const DPF_DESIGN_RULE_POLICY: GppDesignRulePolicy = {
  singleTransitionPath: "the Workroom drive",
  baselineGrants: COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS,
  knownStageToolGap: (shape, stage) => gapKeys.has(stageToolGapKey(shape, stage)),
  isToolAllowedByGrants: (tool, grants) => isToolAllowedByGrants(tool, [...grants]),
  roomGrantsFromWorkShape,
  bindingEnforced: id => Boolean(bindingEnforcementEntry(id)),
  governedDecisionStage: (definition, stage) => Boolean(governedDecisionStage(definition, stage)),
};

export const GENERATED_SHAPE_TYPE_IMPORT = "../work-shapes";
const CHECK_INSTRUCTION = "// Do not edit. `pnpm --filter web check:gpp-shapes` fails if this file differs from a fresh compile.";
export type DesignRuleOptions = Omit<PortableRuleOptions, "policy">;
export type CompileShapeOptions = Omit<PortableCompileOptions, "policy" | "typeImport" | "checkInstruction" | "diagnosticDisposition"> & {
  /** Trusted source-controlled sidecars, restricted to inert declared flows. */
  knownFindings?: readonly KnownFinding[];
};
export type CompileShapeResult = (Extract<PortableCompileResult, { accepted: true }> & { staleKnownFindings: KnownFinding[] })
  | Extract<PortableCompileResult, { accepted: false }>;
export type EmitShapeModuleOptions = Omit<PortableEmitOptions, "typeImport" | "checkInstruction">;

export function runDesignRules(document: GppShapeDocument, resolved: GppResolution, options: DesignRuleOptions = {}) {
  return runPortableRules(document, resolved, { ...options, policy: DPF_DESIGN_RULE_POLICY, ratification: options.ratification ?? GATE_RATIFICATION });
}
export async function compileShapeDocument(text: string, sources: GppResolveSources, options: CompileShapeOptions): Promise<CompileShapeResult> {
  if ((options.knownFindings !== undefined || options.sandboxStages !== undefined)
    && !/^apps\/web\/lib\/work-management\/declared-flows\/[a-z0-9-]+\.gpp\.json$/.test(options.sourcePath)) {
    throw new Error("Known findings and sandbox stages are restricted to declared-flows source documents.");
  }
  const { knownFindings, ...portableOptions } = options;
  // Validate the trusted sidecar even when parsing or required host facts later hold.
  if (knownFindings !== undefined) applyKnownFindings([], knownFindings);
  // Profession membership belongs to DPF, while the portable schema owns
  // structural validation. Never emit a shape naming an unknown host craft.
  const parsed = parseShapeDocument(text);
  if (!parsed.accepted) return parsed;
  const professionKeys = new Set(PROFESSION_REGISTRY.families.map(family => family.professionKey));
  const professionDiagnostics: GppDiagnostic[] = parsed.document.stages.flatMap((stage, index) =>
    stage.requiredProfessions?.some(key => !professionKeys.has(key))
      ? [{ rule: "SCHEMA", code: "SCHEMA/custom", severity: "error", elementId: stageElementId(stage.key),
          path: `/stages/${index}/requiredProfessions`, message: "Use registered specialist professions." }]
      : []);
  if (professionDiagnostics.length > 0) return { accepted: false, diagnostics: professionDiagnostics };
  let staleKnownFindings: KnownFinding[] = [];
  const result = await compilePortable(text, sources, { ...portableOptions, policy: DPF_DESIGN_RULE_POLICY,
    ratification: options.ratification ?? GATE_RATIFICATION, typeImport: GENERATED_SHAPE_TYPE_IMPORT, checkInstruction: CHECK_INSTRUCTION,
    // Always overwrite a runtime caller's extra property: this policy belongs to DPF.
    diagnosticDisposition: knownFindings === undefined ? undefined : (diagnostics: readonly GppDiagnostic[]) => {
      const reviewed = applyKnownFindings(diagnostics, knownFindings);
      staleKnownFindings = reviewed.staleKnownFindings;
      return { diagnostics: reviewed.diagnostics, blocking: hasBlockingDiagnostic(reviewed.diagnostics.filter(finding => !finding.knownFinding)) };
    },
  });
  return result.accepted ? { ...result, staleKnownFindings } : result;
}
export function decompile(definition: WorkShapeDefinition, options: DecompileOptions = {}) {
  return decompilePortable(definition, { ...options, ratification: options.ratification ?? GATE_RATIFICATION });
}
export function emitShapeModule(definition: LoweredWorkShapeDefinition, options: EmitShapeModuleOptions) {
  return emitPortable(definition, { ...options, typeImport: GENERATED_SHAPE_TYPE_IMPORT, checkInstruction: CHECK_INSTRUCTION });
}
export { shapeDocumentDigest } from "@dpf/validators/gpp/compile";
export type { DecompileOptions, DecompileResult } from "@dpf/validators/gpp/decompile";
export { copyBinding, copyGate, lowerToDefinition, GPP_SHAPE_COMPILER_ID, shapeConstantName } from "@dpf/validators/gpp/emit";
export type { LoweredWorkShapeDefinition } from "@dpf/validators/gpp/emit";
