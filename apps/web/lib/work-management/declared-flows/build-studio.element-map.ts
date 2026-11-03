/** Offline traceability: one runtime artifact per declared element. No runtime imports this map. */
import document from "./build-studio.gpp.json";

export const BUILD_STUDIO_ELEMENT_MAP = [
  { elementId:"shape:build-studio@1.0.0",file:"lib/explore/feature-build-types.ts",symbol:"PHASE_ORDER" },
  { elementId:"trigger:claim",file:"lib/build/ideate-on-approval.ts",symbol:"dispatchApprovedIdeateBuilds" },
  ...document.stages.map((stage) => ({elementId:`stage:${stage.key}`,file:"lib/explore/feature-build-types.ts",symbol:"PHASE_ORDER"})),
  { elementId:"gate:plan",file:"lib/decision-perspective/build-studio-gate.ts",symbol:"evaluateBuildStudioPlanAdvancementGate" },
  ...document.stages.flatMap((stage) => stage.tools.map((tool) => ({elementId:`tool:${stage.key}:${tool}`,file:"lib/mcp-tools.ts",symbol:"PLATFORM_TOOLS"}))),
  { elementId:"binding:build-studio-sandbox@1",file:"lib/build/sandbox/build-branch.ts",symbol:"resolveBuildWorkdir" },
  ...["success","failure","budget"].map((kind) => ({elementId:`stop:${kind}:1`,file:"lib/explore/feature-build-types.ts",symbol:"PHASE_ORDER"})),
] as const;
