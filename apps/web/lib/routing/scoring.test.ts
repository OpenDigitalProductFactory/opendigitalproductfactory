/**
 * EP-INF-001 Phase 3: Scoring function tests (TDD red phase).
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

import { describe, expect, it } from "vitest";
import type { EndpointManifest, TaskRequirementContract } from "./types";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import { computeFitness, normalizeWeights } from "./scoring";

// ── Fixtures ────────────────────────────────────────────────────────────────

const BASE_ENDPOINT: EndpointManifest = {
  id: "base",
  providerId: "test",
  modelId: "test-model",
  name: "Base",
  endpointType: "chat",
  status: "active",
  providerTier: "user_configured",
  sensitivityClearance: ["public", "internal"],
  supportsToolUse: true,
  supportsStructuredOutput: true,
  supportsStreaming: true,
  maxContextTokens: 200000,
  maxOutputTokens: 8192,
  modelRestrictions: [],
  reasoning: 50,
  codegen: 50,
  toolFidelity: 50,
  instructionFollowing: 50,
  structuredOutput: 50,
  conversational: 50,
  contextRetention: 50,
  customScores: {},
  avgLatencyMs: 1000,
  recentFailureRate: 0,
  costPerOutputMToken: 10.0,
  profileSource: "seed",
  profileConfidence: "medium",
  retiredAt: null,
  modelClass: "chat",
  modelFamily: null,
  inputModalities: ["text"],
  outputModalities: ["text"],
  capabilities: EMPTY_CAPABILITIES,
  pricing: EMPTY_PRICING,
  supportedParameters: [],
  deprecationDate: null,
  metadataSource: "curated",
  metadataConfidence: "medium",
  perRequestLimits: null,
};

const sonnet: EndpointManifest = {
  ...BASE_ENDPOINT,
  id: "sonnet",
  modelId: "claude-sonnet-4-5",
  name: "Claude Sonnet",
  reasoning: 88,
  codegen: 91,
  toolFidelity: 85,
  instructionFollowing: 88,
  conversational: 85,
  costPerOutputMToken: 15.0,
};

const llama: EndpointManifest = {
  ...BASE_ENDPOINT,
  id: "llama",
  modelId: "llama3.1",
  name: "Llama 3.1",
  reasoning: 65,
  codegen: 65,
  toolFidelity: 40,
  instructionFollowing: 70,
  conversational: 70,
  costPerOutputMToken: null,
  recentFailureRate: 0,
};

const haiku: EndpointManifest = {
  ...BASE_ENDPOINT,
  id: "haiku",
  modelId: "claude-haiku-3-5",
  name: "Claude Haiku",
  status: "degraded",
  reasoning: 42,
  codegen: 42,
  conversational: 60,
  costPerOutputMToken: 4.0,
};

const codeGenReq: TaskRequirementContract = {
  taskType: "codegen",
  description: "Code generation task",
  selectionRationale: "Needs strong codegen and instruction following",
  requiredCapabilities: {
    supportsToolUse: true,
  },
  preferredMinScores: {
    codegen: 75,
    instructionFollowing: 60,
  },
  preferCheap: false,
};

const greetingReq: TaskRequirementContract = {
  taskType: "greeting",
  description: "Simple greeting task",
  selectionRationale: "Conversational, prefer cheap",
  requiredCapabilities: {},
  preferredMinScores: {
    conversational: 40,
  },
  preferCheap: true,
};

// ── normalizeWeights ─────────────────────────────────────────────────────────

describe("normalizeWeights", () => {
  it("normalizes {codegen:75, instructionFollowing:60} to weights summing to 1", () => {
    const result = normalizeWeights({ codegen: 75, instructionFollowing: 60 });
    const sum = Object.values(result).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(result.codegen).toBeCloseTo(75 / 135, 5);
    expect(result.instructionFollowing).toBeCloseTo(60 / 135, 5);
  });

  it("single dimension {reasoning:80} normalizes to {reasoning:1}", () => {
    const result = normalizeWeights({ reasoning: 80 });
    expect(result.reasoning).toBeCloseTo(1, 5);
  });

  it("empty {} returns empty {}", () => {
    const result = normalizeWeights({});
    expect(result).toEqual({});
  });
});

// ── computeFitness ───────────────────────────────────────────────────────────

describe("computeFitness", () => {
  const pool = [sonnet, llama, haiku];

  it("sonnet scores higher than llama for code-gen (quality-first)", () => {
    const sonnetResult = computeFitness(sonnet, codeGenReq, pool);
    const llamaResult = computeFitness(llama, codeGenReq, pool);
    expect(sonnetResult.fitness).toBeGreaterThan(llamaResult.fitness);
  });

  it("degraded haiku gets 0.7x penalty vs an active version of the same endpoint", () => {
    const activeHaiku: EndpointManifest = { ...haiku, status: "active" };
    const poolWithActive = [activeHaiku, sonnet, llama];
    const degradedResult = computeFitness(haiku, greetingReq, [haiku, sonnet, llama]);
    const activeResult = computeFitness(activeHaiku, greetingReq, poolWithActive);
    expect(degradedResult.fitness).toBeCloseTo(activeResult.fitness * 0.7, 5);
  });

  it("with preferCheap:true, llama (free/local) beats sonnet despite lower quality", () => {
    const llamaResult = computeFitness(llama, greetingReq, pool);
    const sonnetResult = computeFitness(sonnet, greetingReq, pool);
    expect(llamaResult.fitness).toBeGreaterThan(sonnetResult.fitness);
  });

  it("dimension scores in trace match raw endpoint values", () => {
    const result = computeFitness(sonnet, codeGenReq, pool);
    expect(result.dimensionScores.codegen).toBe(91);
    expect(result.dimensionScores.instructionFollowing).toBe(88);
  });

  it("only dimensions from the task requirement appear in trace", () => {
    const result = computeFitness(sonnet, codeGenReq, pool);
    const keys = Object.keys(result.dimensionScores);
    expect(keys).toEqual(expect.arrayContaining(["codegen", "instructionFollowing"]));
    expect(keys).not.toContain("reasoning");
    expect(keys).not.toContain("conversational");
    expect(keys.length).toBe(2);
  });
});
