import { describe, expect, it } from "vitest";
import { readRoutingScope, routingHref, DEFAULT_ROUTING_SCOPE } from "./routing-management-scope";
import { projectRoutingManagement, routingHold } from "./routing-management-projection";
import { routingCohorts, filterRoutingReceipts, routingEvidenceAnchor } from "./routing-management-view-model";

const now = new Date("2026-10-12T12:00:00Z");
const decision = { id: "d1", traceId: "trace", agentId: "worker", agentMessageId: null, actorId: "worker", actorKind: "agent", selectedEndpointId: "endpoint", taskType: "review", sensitivity: "internal", reason: "prompt secret", fitnessScore: null, candidateTrace: [], excludedTrace: [], policyRulesApplied: [], fallbackChain: [], fallbacksUsed: null, shadowMode: false, selectedModelId: "model", createdAt: now };
const model = { endpointId: "endpoint", providerId: "provider", modelId: "model", label: "Model", status: "active" };
const attempt = { id: "a1", traceId: "trace", providerId: "provider", modelId: "model", adapterKind: "api", status: "success", durationMs: 10, inputTokens: 10, outputTokens: 5, estimatedCostUsd: .2, startedAt: now, userAccepted: true };
const usage = { id: "u1", traceId: "trace", providerId: "provider", inputTokens: 10, outputTokens: 5, costUsd: .1, createdAt: now };
const project = (decisions: Parameters<typeof projectRoutingManagement>[0]["decisions"] = [decision]) => projectRoutingManagement({ decisions, attempts: [attempt], outcomes: [], usage: [usage], models: [model] });

describe("routing investigation evidence", () => {
  it("does not expose source JSON, prompt-like reasons or adapter payloads", () => {
    const receipt = project()["receipts"][0];
    expect(JSON.stringify(receipt)).not.toContain("prompt secret");
    expect(receipt.costUsd).toBe(.1);
    expect(receipt.attempts[0].estimatedCostUsd).toBe(.2);
    expect(receipt.quality).toBeNull();
    expect(receipt.attempts[0].feedback).toBe(true);
  });
  it("does not assign the same trace usage to two routing decisions", () => {
    const rows = project([decision, { ...decision, id: "d2" }]).receipts;
    expect(rows.every(r => r.correlation === "ambiguous" && r.costUsd === null && r.attempts.length === 0)).toBe(true);
  });
  it("keeps missing correlation and prices unknown, rather than zero or a fuzzy match", () => {
    const row = project([{ ...decision, traceId: null }]).receipts[0];
    expect(row.execution).toBe("unknown");
    expect(row.costUsd).toBeNull();
    expect(row.sourceIds).toEqual([]);
  });
  it("keeps automated vetoes and operator pause separate", () => {
    expect(["policy clearance", "context-length", "quota cooldown", "billing payment", "disabled", "operator pause", "capacity unknown"].map(routingHold)).toEqual(["policy", "tokens", "quota", "payment", "disabled", "operator", "capacity"]);
  });
  it("uses recipe cohorts and separate execution, evaluation, feedback and cost denominators", () => {
    const r = project().receipts[0];
    const groups = routingCohorts([r, { ...r, id: "d2", recipeKey: "other", execution: "unknown", selectedExecution: "unknown", costUsd: null }]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ count: 1, successes: 1, knownExecution: 1, evaluated: 0, costCovered: 1 });
    expect(groups[1]).toMatchObject({ knownExecution: 0, evaluated: 0, costCovered: 0 });
  });
  it("does not charge a model's feedback score for a different fallback model", () => {
    const r = project().receipts[0];
    const groups = routingCohorts([{ ...r, attempts: [...r.attempts, { ...r.attempts[0], id: "fallback", providerId: "other", feedback: false }] }]);
    expect(groups[0].feedback).toHaveLength(1);
    expect(groups[0].feedback[0].feedback).toBe(true);
  });
  it("does not credit the selected model when a fallback model rescued the request", () => {
    const projected = projectRoutingManagement({ decisions: [decision], models: [model], usage: [], outcomes: [], attempts: [{ ...attempt, status: "error" }, { ...attempt, id: "a2", providerId: "fallback", startedAt: new Date(now.getTime() + 1000) }] });
    const r = projected.receipts[0];
    expect(r.execution).toBe("success");
    expect(r.selectedExecution).toBe("error");
    expect(routingCohorts([r])[0]).toMatchObject({ successes: 0, knownExecution: 1 });
  });
});

describe("routing navigation scope", () => {
  it("validates incoming enum/time values and preserves encoded identity across providers", () => {
    const scope = { ...DEFAULT_ROUTING_SCOPE, task: "review & tune", provider: "cloud/a", minutes: 15 };
    const href = routingHref("/platform/ai/providers/cloud?tab=models", scope);
    expect(readRoutingScope(new URLSearchParams(href.split("?")[1]))).toEqual(scope);
    expect(href).toContain("tab=models");
    expect(readRoutingScope(new URLSearchParams("routingData=secret&routingWindow=-1&routingView=bad"))).toEqual(DEFAULT_ROUTING_SCOPE);
  });
  it("scopes recorded rows to task, sensitivity, provider and time", () => {
    const r = project().receipts[0];
    expect(filterRoutingReceipts([r], { ...DEFAULT_ROUTING_SCOPE, task: "write" }, now.getTime())).toEqual([]);
    expect(filterRoutingReceipts([r], { ...DEFAULT_ROUTING_SCOPE, task: "review", provider: "provider", data: "internal" }, now.getTime())).toEqual([r]);
    expect(filterRoutingReceipts([r], DEFAULT_ROUTING_SCOPE, now.getTime() + 61 * 60_000)).toEqual([]);
  });
  it("keeps recent traffic visible after the live replay window is padded into the future", () => {
    const r = { ...project().receipts[0], occurredAt: new Date(now.getTime() - 10 * 60_000).toISOString() };
    const futureEnd = new Date(now.getTime() + 60 * 60_000).toISOString();
    expect(filterRoutingReceipts([r], DEFAULT_ROUTING_SCOPE, Date.parse(futureEnd))).toEqual([]);
    const anchor = routingEvidenceAnchor(futureEnd, now.toISOString());
    expect(filterRoutingReceipts([r], DEFAULT_ROUTING_SCOPE, anchor)).toEqual([r]);
    expect(routingEvidenceAnchor(new Date(now.getTime() - 60 * 60_000).toISOString(), now.toISOString())).toBe(now.getTime() - 60 * 60_000);
  });
});
