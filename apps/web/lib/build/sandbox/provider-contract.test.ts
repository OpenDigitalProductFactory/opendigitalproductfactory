import { describe, expect, it } from "vitest";
import {
  assertProviderCapabilities,
  type BuildExecutionProviderCapabilities,
} from "./provider-types";
import { getBuildExecutionProvider } from "./providers";

const localDockerCapabilities: BuildExecutionProviderCapabilities = {
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
  maxConcurrentSandboxes: 1,
};

describe("BuildExecutionProvider capabilities", () => {
  it("rejects untrusted-ok without vm or managed-job isolation", () => {
    expect(() => assertProviderCapabilities({
      ...localDockerCapabilities,
      trustLevel: "untrusted-ok",
    })).toThrow(/untrusted-ok/i);
  });

  it("rejects ephemeral providers that claim snapshot support", () => {
    expect(() => assertProviderCapabilities({
      ...localDockerCapabilities,
      isolation: "managed-job",
      trustLevel: "untrusted-ok",
      workspacePersistence: "ephemeral",
      supportsSnapshot: true,
    })).toThrow(/snapshot/i);
  });

  it("accepts local Docker's trusted-code-only capability shape", () => {
    expect(() => assertProviderCapabilities(localDockerCapabilities)).not.toThrow();
  });

  it("resolves local-docker provider from the registry", () => {
    const provider = getBuildExecutionProvider("local-docker");
    expect(provider.id).toBe("local-docker");
    expect(provider.capabilities().workspacePersistence).toBe("durable");
  });
});
