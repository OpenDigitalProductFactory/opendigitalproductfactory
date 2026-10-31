import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { getProcessPolicy } from "@/lib/explore/build-process-matrix";
import { PHASE_ORDER, canTransitionPhase } from "@/lib/explore/feature-build-types";
import { findDirectPhaseWrites } from "@/lib/gpp/direct-phase-writes";
import { elementsOfValue } from "@dpf/validators/gpp/element-ids";
import { emitBindingRecords } from "@dpf/validators/gpp/bindings-emit";
import { compileShapeDocument } from "@/lib/gpp/shape-language/dpf-toolkit";
import { defaultResolveSources, liveDirectExecuteSites } from "@/lib/gpp/shape-language/resolve-sources";
import { gppShapeDocumentSchema } from "@dpf/validators/gpp/gpp-shape-schema";
import { GATE_RATIFICATION } from "@/lib/gpp/shape-language/gate-ratification";
import { GPP_BINDINGS } from "@/lib/gpp/bindings";
import { GPP_BINDING_ENFORCEMENT } from "@/lib/gpp/binding-enforcement";
import { listWorkShapes } from "@/lib/work-management/work-shapes";
import document from "./build-studio.gpp.json";
import transitions from "./build-studio.transitions.json";
import { BUILD_STUDIO_EVIDENCE_MAP, BUILD_STUDIO_SANDBOX_STAGES, SANDBOX_TOOL_CLASS, planToBuildDivergences } from "./build-studio.realization";
import { BUILD_STUDIO_ELEMENT_MAP } from "./build-studio.element-map";
import { KNOWN_FINDINGS } from "./build-studio.known-findings";

const web = resolve(__dirname, "../../..");
function sourceFiles(dir: string): {path:string;content:string}[] {
  return readdirSync(resolve(web, dir), {withFileTypes:true}).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path)
      : /\.[cm]?tsx?$/.test(entry.name) && !/\.(test|spec)\.[cm]?tsx?$/.test(entry.name)
        ? [{path, content:readFileSync(resolve(web,path),"utf8")}] : [];
  });
}
const sources = [...sourceFiles("app"), ...sourceFiles("lib")];
// Schema compatibility is its own check: independent topology/reach checks
// still run and report their real results when the compiler refuses a name.
const shape = document;

describe("Build Studio declared flow conformance (offline; no runtime activation)", () => {
  it("accepts the real runtime tool names under the published schema", () => {
    expect(gppShapeDocumentSchema.safeParse(document).success).toBe(true);
  });
  it("compiles deterministically, preserves unknown checks, and only drafts the existing binding", async () => {
    const sources = defaultResolveSources();
    const options = {sourcePath:"apps/web/lib/work-management/declared-flows/build-studio.gpp.json",directSites:liveDirectExecuteSites(),knownFindings:KNOWN_FINDINGS,sandboxStages:BUILD_STUDIO_SANDBOX_STAGES};
    const result = await compileShapeDocument(JSON.stringify(document),sources,options);
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.staleKnownFindings).toEqual([]);
    expect(result.diagnostics.filter((finding) => finding.severity === "error").every((finding) => finding.knownFinding)).toBe(true);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({rule:"C-5",severity:"not-evaluated"}));
    expect(emitBindingRecords([{document:result.document,resolution:result.resolution}])).toEqual([
      expect.objectContaining({bindingId:"build-studio-sandbox",version:1,authority:"wwmd",gateKey:"build-studio",attach:{shapeRef:"build-studio@1.0.0",stageKey:"build"},tools:["recover_sandbox","release_nonprod_environment_lease"]}),
    ]);
    const shuffle = (value: unknown): unknown => Array.isArray(value) ? value.map(shuffle)
      : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key,child]) => [key,shuffle(child)])) : value;
    const shuffled = await compileShapeDocument(JSON.stringify(shuffle(document)),sources,options);
    expect(shuffled.accepted).toBe(true);
    if (shuffled.accepted) expect(shuffled.module).toBe(result.module);
    const invalid = structuredClone(document);
    invalid.stages[0]!.tools.push("missing_gpp_test_tool");
    expect((await compileShapeDocument(JSON.stringify(invalid),sources,options)).accepted).toBe(false);
  });
  it("P1: describes lifecycle order, permitted edges and every direct phase writer", () => {
    expect(shape.stages.map((stage) => stage.key)).toEqual(PHASE_ORDER.filter((phase) => !["complete","failed","abandoned"].includes(phase)));
    const writes = findDirectPhaseWrites(sources);
    const grouped = new Map<string,number>();
    for (const write of writes) {
      const key = `${write.path} -> ${write.target}`;
      grouped.set(key,(grouped.get(key) ?? 0)+1);
    }
    expect(Object.fromEntries(grouped)).toEqual(Object.fromEntries(transitions.writers.map((row) => [`${row.file} -> ${row.target}`,row.count])));
    const edges = PHASE_ORDER.flatMap((from) => PHASE_ORDER.filter((to) => canTransitionPhase(from,to)).map((to) => `${from}->${to}`));
    expect(edges).toEqual(transitions.allowedEdges);
    expect(transitions.writers.every((row) => existsSync(resolve(web,row.file)) && row.gates.length > 0)).toBe(true);
  });

  it("P2: phase capabilities equal current runtime coworker tags", () => {
    for (const stage of shape.stages) {
      const tools = PLATFORM_TOOLS.filter((tool) => tool.buildPhases?.some((phase) => phase === stage.key)).map((tool) => tool.name).sort();
      expect(stage.tools, stage.key).toEqual(tools);
    }
  });

  it("P3: preserves the founder-ratified doctrine gate and records alternate path divergences", () => {
    const plan = shape.stages.find((stage) => stage.key === "plan")!;
    expect(plan.advance.kind).toBe("governed-decision");
    if (plan.advance.kind !== "governed-decision") throw new Error("missing plan gate");
    const scope = plan.advance.decisionScope;
    if (!scope) throw new Error("missing plan decision scope");
    expect(plan.advance.gate).toEqual(GATE_RATIFICATION[scope]!.proposed);
    expect(GATE_RATIFICATION[scope]).toMatchObject({status:"ratified",decisionId:"DI-119FB3749D46"});
    expect(plan.advance.gate?.resolver).toEqual({module:"lib/decision-perspective/build-studio-gate",exportName:"evaluateBuildStudioPlanAdvancementGate"});
    expect(planToBuildDivergences()).toMatchSnapshot();
  });

  it("P4: evidence follows the default cell; prior-stage evidence is rechecked rather than duplicated", () => {
    const policy = getProcessPolicy("feature","medium");
    const next = {ideate:"plan",plan:"build",build:"review",review:"ship"} as const;
    for (const stage of shape.stages) {
      if (!(stage.key in next)) continue;
      const key = stage.key as keyof typeof next;
      const transition = `${key}->${next[key]}` as keyof typeof policy.gates;
      const evidence = [...new Set((policy.gates[transition] ?? []).map((gate) => BUILD_STUDIO_EVIDENCE_MAP[gate]).filter((kind) => kind !== null))];
      const expected = key === "review" ? evidence.filter((kind) => kind !== "design-doc" && kind !== "plan-doc") : evidence;
      if (key === "plan") expected.push("decision-record");
      expect([...stage.evidence].sort(),key).toEqual([...expected].sort());
    }
    expect(shape.stages.find((stage) => stage.key === "ship")?.evidence).toEqual(["pr-gate","merged-sha","deployment-record"]);
  });

  it("P5: all sandbox tools are classified, acting phases are contained or explicitly disclosed", () => {
    const sandboxNames = [...readFileSync(resolve(web,"lib/mcp/packs/sandbox-pack.ts"),"utf8").matchAll(/\bname:\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(Object.keys(SANDBOX_TOOL_CLASS).sort()).toEqual(sandboxNames.sort());
    const acting = PLATFORM_TOOLS.filter((tool) => SANDBOX_TOOL_CLASS[tool.name as keyof typeof SANDBOX_TOOL_CLASS] === "act").flatMap((tool) => tool.buildPhases ?? []);
    expect([...new Set(acting)].sort()).toEqual(["build","review"]);
    expect([...BUILD_STUDIO_SANDBOX_STAGES].sort()).toEqual(["build","ideate","review"]);
    expect(shape.stages.filter((stage) => stage.binding?.enforcement === "environment").map((stage) => stage.key)).toEqual(["build"]);
    const disclosed = KNOWN_FINDINGS.filter((finding) => finding.rule === "C-7").map((finding) => finding.elementId.replace("stage:",""));
    expect([...disclosed,"build"].sort()).toEqual([...BUILD_STUDIO_SANDBOX_STAGES].sort());
  });

  it("P7/P8: the declaration has no runtime imports, registration or active binding", () => {
    const runtimeImports = sources.filter((file) => !file.path.startsWith("lib/work-management/declared-flows/") && file.path !== "lib/work-management/generated/declared-flows.generated.ts")
      .filter((file) => /(?:from\s*|import\s*\()\s*["'][^"']*(?:declared-flows|build-studio\.flow\.generated)/.test(file.content));
    expect(runtimeImports.map((file) => file.path)).toEqual([]);
    // Baseline key/hash equality is publication evidence for this change,
    // not a permanent freeze on unrelated registry and binding evolution.
    expect(listWorkShapes().map((definition) => definition.key)).not.toContain(shape.key);
    expect(GPP_BINDINGS.map((binding) => binding.bindingId)).not.toContain("build-studio-sandbox");
    expect(GPP_BINDING_ENFORCEMENT).not.toHaveProperty("build-studio-sandbox");
  });

  it("maps each derived element to one existing runtime artifact", () => {
    expect(BUILD_STUDIO_ELEMENT_MAP.map((row) => row.elementId).sort()).toEqual(elementsOfValue(shape).map((element) => element.id).sort());
    expect(new Set(BUILD_STUDIO_ELEMENT_MAP.map((row) => row.elementId)).size).toBe(BUILD_STUDIO_ELEMENT_MAP.length);
    for (const row of BUILD_STUDIO_ELEMENT_MAP) {
      expect(existsSync(resolve(web,row.file)),row.elementId).toBe(true);
      expect(readFileSync(resolve(web,row.file),"utf8"),row.elementId).toContain(row.symbol);
    }
  });
});
