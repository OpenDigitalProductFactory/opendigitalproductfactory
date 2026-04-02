import { describe, it, expect } from "vitest";
import {
  buildSandboxCreateArgs,
  buildSandboxNetworkName,
  parseSandboxPort,
  SANDBOX_IMAGE,
  SANDBOX_RESOURCE_LIMITS,
  SANDBOX_TIMEOUT_MS,
} from "./sandbox";

describe("SANDBOX_IMAGE", () => {
  it("is dpf-sandbox", () => {
    expect(SANDBOX_IMAGE).toBe("dpf-sandbox");
  });
});

describe("SANDBOX_RESOURCE_LIMITS", () => {
  it("has 2 CPUs", () => {
    expect(SANDBOX_RESOURCE_LIMITS.cpus).toBe(2);
  });

  it("has 4GB memory", () => {
    expect(SANDBOX_RESOURCE_LIMITS.memoryMb).toBe(4096);
  });

  it("has 10GB disk", () => {
    expect(SANDBOX_RESOURCE_LIMITS.diskGb).toBe(10);
  });
});

describe("SANDBOX_TIMEOUT_MS", () => {
  it("is 30 minutes", () => {
    expect(SANDBOX_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });
});

describe("buildSandboxCreateArgs", () => {
  it("builds docker create args with resource limits", () => {
    const args = buildSandboxCreateArgs("FB-ABC12345", 3001);
    expect(args).toContain("--name");
    expect(args).toContain("dpf-sandbox-FB-ABC12345");
    expect(args).toContain("--cpus=2");
    expect(args).toContain("--memory=4096m");
    expect(args).toContain("-p");
    expect(args).toContain("3001:3000");
    expect(args).toContain("dpf-sandbox");
  });

  it("does not use --network=none (sandbox needs npm access)", () => {
    const args = buildSandboxCreateArgs("FB-X", 3002);
    expect(args).not.toContain("--network=none");
  });

  it("includes --network flag when networkName provided", () => {
    const args = buildSandboxCreateArgs("FB-ABC12345", 3001, {
      networkName: "dpf-sandbox-net-FB-ABC12345",
    });
    expect(args).toContain("--network=dpf-sandbox-net-FB-ABC12345");
  });

  it("includes -e flags for env vars when provided", () => {
    const args = buildSandboxCreateArgs("FB-X", 3002, {
      envVars: {
        DATABASE_URL: "postgresql://dpf:dpf_sandbox@db:5432/dpf",
        NEO4J_URI: "bolt://neo4j:7687",
      },
    });
    expect(args).toContain("-e");
    expect(args).toContain("DATABASE_URL=postgresql://dpf:dpf_sandbox@db:5432/dpf");
    expect(args).toContain("NEO4J_URI=bolt://neo4j:7687");
  });
});

describe("buildSandboxNetworkName", () => {
  it("builds network name from buildId", () => {
    expect(buildSandboxNetworkName("FB-ABC12345")).toBe("dpf-sandbox-net-FB-ABC12345");
  });
});

describe("parseSandboxPort", () => {
  it("extracts port from docker port output", () => {
    expect(parseSandboxPort("0.0.0.0:3001")).toBe(3001);
  });

  it("returns null for empty output", () => {
    expect(parseSandboxPort("")).toBeNull();
  });

  it("returns null for malformed output", () => {
    expect(parseSandboxPort("no-port-here")).toBeNull();
  });
});
