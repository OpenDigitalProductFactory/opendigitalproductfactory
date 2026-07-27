import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_ROUTING_ARCHITECTURE_VERSION,
  AI_ROUTING_STAGES,
  buildAiRoutingArchitectureModels,
} from "./ai-routing-architecture-extract";

const REQUIRED_STAGES = [
  "request",
  "assemble-payload",
  "sensitive-screen",
  "resolve-governed-context",
  "data-policy-decision",
  "data-policy-gateway",
  "protect-payload",
  "local-review-or-stop",
  "compile-request-contract",
  "route-eligibility",
  "eligible-route-gateway",
  "availability-and-limits",
  "availability-gateway",
  "eligible-fallback",
  "rank-quality-time-cost",
  "dispatch",
  "record-safe-receipt",
  "rehydration-gateway",
  "return-masked-response",
  "return-authorized-response",
] as const;

function repositoryRoot(): string {
  let current = process.cwd();
  const root = parse(current).root;
  while (current !== root) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    current = dirname(current);
  }
  throw new Error("Could not locate DPF repository root");
}

describe("buildAiRoutingArchitectureModels", () => {
  const models = buildAiRoutingArchitectureModels();
  const bpmnByKey = new Map(models.bpmn.elements.map((element) => [element.sysmlKey, element]));
  const flow = (from: string, to: string, relSlug?: string) =>
    models.bpmn.relationships.find(
      (relationship) =>
        relationship.fromKey === `ai-routing:bpmn:${from}` &&
        relationship.toKey === `ai-routing:bpmn:${to}` &&
        (relSlug === undefined || relationship.relSlug === relSlug),
    );

  it("keeps a versioned registry for every designed routing station", () => {
    expect(AI_ROUTING_ARCHITECTURE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(AI_ROUTING_STAGES.map((stage) => stage.id)).toEqual(
      expect.arrayContaining([...REQUIRED_STAGES]),
    );
    expect(new Set(AI_ROUTING_STAGES.map((stage) => stage.id)).size).toBe(AI_ROUTING_STAGES.length);

    for (const stage of AI_ROUTING_STAGES) {
      expect(stage.source.path).toMatch(/\.(ts|md)$/);
      expect(stage.source.version).toBe(AI_ROUTING_ARCHITECTURE_VERSION);
      expect(["implemented", "partial", "proposed"]).toContain(stage.source.status);
      expect(stage.ownerLabel.length).toBeGreaterThan(5);
    }
  });

  it("keeps every stage source anchored to a repository artifact", () => {
    const root = repositoryRoot();
    for (const stage of AI_ROUTING_STAGES) {
      expect(
        existsSync(join(root, stage.source.path)),
        `${stage.id}: ${stage.source.path}`,
      ).toBe(true);
    }
  });

  it("does not overstate the parallel sensitive-routing implementation", () => {
    const status = new Map(
      AI_ROUTING_STAGES.map((stage) => [stage.id, stage.source.status]),
    );
    expect(status.get("sensitive-screen")).toBe("partial");
    expect(status.get("data-policy-decision")).toBe("partial");
    expect(status.get("data-policy-gateway")).toBe("partial");
    expect(status.get("compile-request-contract")).toBe("partial");
    expect(status.get("eligible-fallback")).toBe("partial");
    expect(status.get("record-safe-receipt")).toBe("partial");
    expect(status.get("rehydration-gateway")).toBe("implemented");
    expect(status.get("return-masked-response")).toBe("implemented");
    expect(status.get("return-authorized-response")).toBe("implemented");

    const sensitiveScreen = AI_ROUTING_STAGES.find(
      (stage) => stage.id === "sensitive-screen",
    );
    expect(sensitiveScreen?.source.path).toBe(
      "apps/web/lib/inference/data-screening/classify-payload.ts",
    );
    expect(status.get("dispatch")).toBe("implemented");
  });

  it("projects the complete route to BPMN tasks, gateways, events, conditional/default flows, and lanes", () => {
    expect(bpmnByKey.get("ai-routing:bpmn:process")?.typeSlug).toBe("bpmn_process");
    expect(bpmnByKey.get("ai-routing:bpmn:request")?.typeSlug).toBe("bpmn_start_event");
    expect(bpmnByKey.get("ai-routing:bpmn:data-policy-gateway")?.typeSlug).toBe("bpmn_exclusive_gateway");
    expect(bpmnByKey.get("ai-routing:bpmn:return-authorized-response")?.typeSlug).toBe("bpmn_end_event");

    const lanes = models.bpmn.elements.filter((element) => element.typeSlug === "bpmn_lane");
    expect(lanes.map((lane) => lane.sysmlKey)).toEqual([
      "ai-routing:bpmn:lane:request",
      "ai-routing:bpmn:lane:data-governance",
      "ai-routing:bpmn:lane:routing",
      "ai-routing:bpmn:lane:provider-adapter",
      "ai-routing:bpmn:lane:response-authorization",
    ]);
    for (const stage of AI_ROUTING_STAGES) {
      expect(bpmnByKey.get(`ai-routing:bpmn:${stage.id}`)?.properties?.laneKey).toBe(
        `ai-routing:bpmn:lane:${stage.lane}`,
      );
    }

    expect(flow("request", "assemble-payload", "sequence_flow")).toBeTruthy();
    expect(flow("sensitive-screen", "resolve-governed-context", "sequence_flow")).toBeTruthy();
    expect(flow("data-policy-gateway", "protect-payload", "conditional_flow")?.properties?.conditionCode).toBe(
      "allow-with-obligations",
    );
    expect(flow("data-policy-gateway", "local-review-or-stop", "conditional_flow")?.properties?.conditionCode).toBe(
      "deny-or-review",
    );
    expect(flow("data-policy-gateway", "compile-request-contract", "default_flow")?.properties?.conditionCode).toBe(
      "allow",
    );
    expect(flow("eligible-route-gateway", "local-review-or-stop", "conditional_flow")?.properties?.conditionCode).toBe(
      "no-eligible-route",
    );
    expect(flow("availability-gateway", "eligible-fallback", "conditional_flow")?.properties?.conditionCode).toBe(
      "temporarily-unavailable-or-limited",
    );
    expect(flow("eligible-fallback", "fallback-gateway", "sequence_flow")).toBeTruthy();
    expect(flow("fallback-gateway", "rank-quality-time-cost", "default_flow")?.properties?.conditionCode).toBe(
      "eligible-fallback-available",
    );
    expect(flow("fallback-gateway", "local-review-or-stop", "conditional_flow")?.properties?.conditionCode).toBe(
      "no-eligible-fallback",
    );
    expect(flow("rehydration-gateway", "return-masked-response", "conditional_flow")?.properties?.conditionCode).toBe(
      "rehydration-not-authorized",
    );
    expect(flow("rehydration-gateway", "return-authorized-response", "default_flow")?.properties?.conditionCode).toBe(
      "rehydration-authorized",
    );

    const keys = new Set(models.bpmn.elements.map((element) => element.sysmlKey));
    for (const relationship of models.bpmn.relationships) {
      expect(keys.has(relationship.fromKey), relationship.fromKey).toBe(true);
      expect(keys.has(relationship.toKey), relationship.toKey).toBe(true);
    }
  });

  it("projects routing obligations and proof to SysML requirements, constraints, parts, and verification cases", () => {
    const byKey = new Map(models.sysml.elements.map((element) => [element.sysmlKey, element]));
    expect(byKey.get("sysml:aic:req:REQ-AIC-10")?.typeSlug).toBe("requirement");
    expect(byKey.get("sysml:aic:constraint:CON-AIC-2")?.typeSlug).toBe("constraint");
    expect(byKey.get("sysml:aic:part:router")?.typeSlug).toBe("part_definition");
    expect(byKey.get("sysml:aic:vc:VC-AIC-SCREEN")?.typeSlug).toBe("verification_case");
    expect(byKey.get("sysml:aic:vc:VC-AIC-ELIGIBILITY")?.properties?.status).toBe(
      "partial",
    );
    expect(byKey.get("sysml:aic:vc:VC-AIC-FALLBACK")?.properties?.status).toBe(
      "planned",
    );

    expect(models.sysml.relationships).toContainEqual(
      expect.objectContaining({
        fromKey: "sysml:aic:vc:VC-AIC-SCREEN",
        toKey: "sysml:aic:req:REQ-AIC-10",
        relSlug: "verifies",
      }),
    );
    expect(models.sysml.relationships).toContainEqual(
      expect.objectContaining({
        fromKey: "sysml:aic:part:router",
        toKey: "sysml:aic:req:REQ-AIC-1",
        relSlug: "satisfies",
      }),
    );
  });

  it("materializes BPMN, SysML, and ArchiMate realization links through the dedicated cross-notation types", () => {
    const allCross = [
      ...(models.bpmn.crossLayerRelationships ?? []),
      ...(models.sysml.crossLayerRelationships ?? []),
      ...(models.archimate.crossLayerRelationships ?? []),
    ];
    const allElementKeys = new Set([
      ...models.bpmn.elements.map((element) => element.sysmlKey),
      ...models.sysml.elements.map((element) => element.sysmlKey),
      ...models.archimate.elements.map((element) => element.sysmlKey),
    ]);
    for (const relationship of allCross) {
      expect(allElementKeys.has(relationship.fromKey), relationship.fromKey).toBe(true);
      expect(allElementKeys.has(relationship.toKey), relationship.toKey).toBe(true);
    }
    const cross = (
      fromKey: string,
      toKey: string,
      relSlug: string,
    ) =>
      allCross.find(
        (relationship) =>
          relationship.fromKey === fromKey &&
          relationship.toKey === toKey &&
          relationship.relSlug === relSlug,
      );

    expect(
      cross("ai-routing:bpmn:process", "ai-routing:arch:process", "details")?.relationshipNotationSlug,
    ).toBe("dpf-cross-notation");
    expect(
      cross(
        "ai-routing:arch:component:route-selector",
        "ai-routing:bpmn:rank-quality-time-cost",
        "realizes_process",
      )?.relationshipNotationSlug,
    ).toBe("dpf-cross-notation");
    expect(
      cross(
        "sysml:aic:req:REQ-AIC-10",
        "ai-routing:arch:capability:governed-ai-routing",
        "sysml_traces",
      )?.relationshipNotationSlug,
    ).toBe("dpf-cross-notation");
    expect(
      cross(
        "sysml:aic:vc:VC-AIC-RECEIPT",
        "ai-routing:arch:evidence:safe-routing-receipt",
        "sysml_verifies",
      )?.relationshipNotationSlug,
    ).toBe("dpf-cross-notation");
  });

  it("turns missing source versions into conformance evidence instead of omitting the station", () => {
    const invalidStages = AI_ROUTING_STAGES.map((stage) =>
      stage.id === "dispatch"
        ? { ...stage, source: { ...stage.source, version: "" } }
        : stage,
    );
    const invalid = buildAiRoutingArchitectureModels({ stages: invalidStages });

    expect(invalid.bpmn.elements.some((element) => element.sysmlKey === "ai-routing:bpmn:dispatch")).toBe(true);
    expect(invalid.sysml.conformanceIssues).toContainEqual(
      expect.objectContaining({
        onKey: "sysml:aic:pkg",
        issueType: "ai-routing-source-version-missing",
      }),
    );
  });
});
