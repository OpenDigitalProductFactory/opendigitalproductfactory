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

  it("resolves the dpf-native runner from the registry (no longer null)", () => {
    expect(getBuildAgentRunner("dpf-native").id).toBe("dpf-native");
  });

  it("accepts dpf-native on local Docker (honors LLM_BASE_URL, no callback port)", () => {
    const dpfNative = getBuildAgentRunner("dpf-native").capabilities();
    expect(dpfNative.honorsLlmBaseUrl).toBe(true);
    expect(dpfNative.requiresCallbackPort).toBeUndefined();
    expect(() => assertAgentProviderCompatibility(dpfNative, localDocker)).not.toThrow();
  });

  it("allows dpf-native on untrusted-ok providers (CLI agents are rejected there)", () => {
    const dpfNative = getBuildAgentRunner("dpf-native").capabilities();
    const untrustedOk: BuildExecutionProviderCapabilities = {
      ...localDocker,
      isolation: "managed-job",
      trustLevel: "untrusted-ok",
    };
    expect(() => assertAgentProviderCompatibility(dpfNative, untrustedOk)).not.toThrow();
    // Contrast: a mode-4 CLI runner (honorsLlmBaseUrl=false) is rejected there.
    expect(() => assertAgentProviderCompatibility(codexCli, untrustedOk)).toThrow(/untrusted-ok/i);
  });
});
