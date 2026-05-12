import { describe, expect, it } from "vitest";

import { loadConfig } from "../config";

const baseEnv = {
  DPF_AUTHORITY_URL: "http://host.docker.internal:3000",
  DPF_EDGE_NODE_NAME: "test-edge-1",
  DPF_EDGE_STATE_DIR: "/tmp/dpf-edge-test",
  DPF_PLATFORM_OVERRIDE: "linux",
  DPF_INSTALL_MODE: "container-host",
  DPF_EDGE_NODE_VERSION: "0.1.0",
} as const;

describe("loadConfig", () => {
  it("loads happy path", () => {
    const cfg = loadConfig({ ...baseEnv });
    expect(cfg.authorityUrl).toBe("http://host.docker.internal:3000");
    expect(cfg.edgeNodeName).toBe("test-edge-1");
    expect(cfg.platform).toBe("linux");
    expect(cfg.installMode).toBe("container-host");
    expect(cfg.bootstrapToken).toBeUndefined();
  });

  it("includes bootstrapToken when provided", () => {
    const cfg = loadConfig({
      ...baseEnv,
      DPF_BOOTSTRAP_TOKEN: "dpfboot_TESTTOKEN",
    });
    expect(cfg.bootstrapToken).toBe("dpfboot_TESTTOKEN");
  });

  it("rejects missing DPF_AUTHORITY_URL", () => {
    expect(() => {
      const env: Record<string, string> = { ...baseEnv };
      delete (env as Record<string, string | undefined>)["DPF_AUTHORITY_URL"];
      loadConfig(env);
    }).toThrow(/authorityUrl/);
  });

  it("rejects malformed URL", () => {
    expect(() =>
      loadConfig({ ...baseEnv, DPF_AUTHORITY_URL: "not a url" }),
    ).toThrow(/authorityUrl/);
  });

  it("rejects unsupported platform override", () => {
    expect(() =>
      loadConfig({ ...baseEnv, DPF_PLATFORM_OVERRIDE: "freebsd" }),
    ).toThrow(/platform/);
  });

  it("rejects unsupported installMode", () => {
    expect(() =>
      loadConfig({ ...baseEnv, DPF_INSTALL_MODE: "wasm" }),
    ).toThrow(/installMode/);
  });

  it("defaults installMode to container-host when unset", () => {
    const env: Record<string, string> = { ...baseEnv };
    delete (env as Record<string, string | undefined>)["DPF_INSTALL_MODE"];
    const cfg = loadConfig(env);
    expect(cfg.installMode).toBe("container-host");
  });
});
