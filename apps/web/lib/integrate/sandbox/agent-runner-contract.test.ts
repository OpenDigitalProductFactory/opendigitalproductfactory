import { describe, expect, it } from "vitest";
import {
  assertAgentProviderCompatibility,
  type BuildAgentRunnerCapabilities,
} from "./agent-runner-types";
import { getBuildAgentRunner } from "./agents";
import type { BuildExecutionProviderCapabilities } from "./provider-types";

const localDocker: BuildExecutionProviderCapabilities = {
  isolation: "container",
  trustLevel: "trusted-code-only",
  workspacePersistence: "durable",
  logSink: "authority-core",
  networkPolicy: "namespaced",
  cleanupModel: "explicit",
  supportsPreviewUrl: true,
  supportsPortCallbacks: true,
  supportsFileCopy: true,
  supportsSnapshot: false,
  dockerInsideSandbox: false,
};

const codexCli: BuildAgentRunnerCapabilities = {
  tier: "full-spec-implement",
  requiresPersistentSession: true,
  requiresCallbackPort: 1455,
  requiresCredential: true,
  honorsLlmBaseUrl: false,
};

describe("BuildAgentRunner compatibility", () => {
  it("rejects a callback-port runner on providers without port callbacks", () => {
    expect(() => assertAgentProviderCompatibility(
      codexCli,
      { ...localDocker, supportsPortCallbacks: false },
    )).toThrow(/callback port/i);
  });

  it("rejects persistent-session runners on ephemeral providers", () => {
    expect(() => assertAgentProviderCompatibility(
      codexCli,
      { ...localDocker, workspacePersistence: "ephemeral" },
    )).toThrow(/persistent session/i);
  });

  it("accepts Codex CLI on local Docker", () => {
    expect(() => assertAgentProviderCompatibility(codexCli, localDocker)).not.toThrow();
  });

  it("resolves Codex and Claude runners from the registry", () => {
    expect(getBuildAgentRunner("codex").id).toBe("codex");
    expect(getBuildAgentRunner("claude").id).toBe("claude");
  });

  it("does not expose dpf-native in slice 1", () => {
    expect(() => getBuildAgentRunner("dpf-native")).toThrow(/not implemented/i);
  });
});
