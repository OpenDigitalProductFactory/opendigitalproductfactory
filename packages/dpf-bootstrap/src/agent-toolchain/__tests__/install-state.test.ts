import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { materializeAgentToolchainState } from "../install-state";

const SCHEMA_PATH = join(__dirname, "..", "..", "..", "..", "..", "scripts", "installer", "install-state.schema.json");
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

describe("materializeAgentToolchainState", () => {
  it("builds a ready state object when everything passes", () => {
    const state = materializeAgentToolchainState({
      appliedAt: "2026-05-27T02:00:00.000Z",
      dpfPlatformVersion: "0.1.0",
      superpowersVersion: "1.2.0",
      claudeCodeWired: true,
      codexWired: true,
      memorySeededAt: "2026-05-27T02:00:00.000Z",
      mcpReadiness: { ok: true, toolCount: 5, observedAt: "2026-05-27T02:00:00.000Z" },
      smokeTest: { result: "passed", kernelPrincipleObserved: "destructive-actions-require-explicit-go", transcript: "..." },
    });

    expect(state.readinessState).toBe("ready");
    expect(state.dpfPlatformVersion).toBe("0.1.0");
    expect(state.superpowersVersion).toBe("1.2.0");
  });

  it("computes failed_smoke when smoke fails", () => {
    const state = materializeAgentToolchainState({
      appliedAt: "2026-05-27T02:00:00.000Z",
      dpfPlatformVersion: "0.1.0",
      superpowersVersion: null,
      claudeCodeWired: true,
      codexWired: true,
      memorySeededAt: "2026-05-27T02:00:00.000Z",
      mcpReadiness: { ok: true, toolCount: 5, observedAt: "2026-05-27T02:00:00.000Z" },
      smokeTest: { result: "failed", transcript: "Sure, here is...", reason: "complied" },
    });

    expect(state.readinessState).toBe("failed_smoke");
  });

  it("computes missing_cli when nothing is wired", () => {
    const state = materializeAgentToolchainState({
      appliedAt: "2026-05-27T02:00:00.000Z",
      dpfPlatformVersion: "0.1.0",
      superpowersVersion: null,
      claudeCodeWired: false,
      codexWired: false,
      memorySeededAt: null,
      mcpReadiness: { ok: false, reason: "no_token", httpStatus: null },
      smokeTest: { result: "skipped", reason: "claude_not_on_path" },
    });

    expect(state.readinessState).toBe("missing_cli");
  });
});

describe("install-state.schema.json agentToolchain block", () => {
  it("declares agentToolchain as a top-level optional object", () => {
    expect(schema.properties.agentToolchain).toBeDefined();
    expect(schema.properties.agentToolchain.type).toBe("object");
    expect(schema.required).not.toContain("agentToolchain");
  });

  it("schema requires every field on the materialized state object", () => {
    const state = materializeAgentToolchainState({
      appliedAt: "2026-05-27T02:00:00.000Z",
      dpfPlatformVersion: "0.1.0",
      superpowersVersion: null,
      claudeCodeWired: true,
      codexWired: true,
      memorySeededAt: null,
      mcpReadiness: { ok: true, toolCount: 1, observedAt: "2026-05-27T02:00:00.000Z" },
      smokeTest: { result: "skipped", reason: "no_token" },
    });

    for (const required of schema.properties.agentToolchain.required) {
      expect(state).toHaveProperty(required);
    }
  });

  it("schema readinessState enum covers every value the materializer can emit", () => {
    const declared: string[] = schema.properties.agentToolchain.properties.readinessState.enum;
    const expected = ["ready", "partial", "missing_cli", "missing_token", "needs_refresh", "failed_smoke"];
    expect(declared.sort()).toEqual(expected.sort());
  });

  it("schema smokeTest oneOf covers passed/failed/skipped result types", () => {
    const oneOf = schema.properties.agentToolchain.properties.smokeTest.oneOf;
    const constants = oneOf.map((entry: { properties: { result: { const: string } } }) => entry.properties.result.const).sort();
    expect(constants).toEqual(["failed", "passed", "skipped"]);
  });
});
