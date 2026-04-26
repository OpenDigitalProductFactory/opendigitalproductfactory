// apps/web/lib/sandbox-db.test.ts
// Pure-function tests only — do NOT test Docker commands (those are integration tests)

import { describe, it, expect } from "vitest";
import {
  buildDockerHealthInspectCommand,
  buildDbContainerName,
  buildNeo4jContainerName,
  buildQdrantContainerName,
  buildSandboxDbEnvVars,
  DB_RESOURCE_LIMITS,
  NEO4J_RESOURCE_LIMITS,
  QDRANT_RESOURCE_LIMITS,
} from "./sandbox-db";

// ─── Resource Limit Constants ─────────────────────────────────────────────────

describe("DB_RESOURCE_LIMITS", () => {
  it("has 512 MB memory", () => {
    expect(DB_RESOURCE_LIMITS.memoryMb).toBe(512);
  });

  it("has 1 CPU", () => {
    expect(DB_RESOURCE_LIMITS.cpus).toBe(1);
  });
});

describe("NEO4J_RESOURCE_LIMITS", () => {
  it("has 512 MB memory", () => {
    expect(NEO4J_RESOURCE_LIMITS.memoryMb).toBe(512);
  });

  it("has 1 CPU", () => {
    expect(NEO4J_RESOURCE_LIMITS.cpus).toBe(1);
  });
});

describe("QDRANT_RESOURCE_LIMITS", () => {
  it("has 256 MB memory", () => {
    expect(QDRANT_RESOURCE_LIMITS.memoryMb).toBe(256);
  });

  it("has 0.5 CPUs", () => {
    expect(QDRANT_RESOURCE_LIMITS.cpus).toBe(0.5);
  });
});

// ─── Container Naming Helpers ─────────────────────────────────────────────────

describe("buildDbContainerName", () => {
  it("prefixes with dpf-sandbox-db-", () => {
    expect(buildDbContainerName("FB-ABC12345")).toBe("dpf-sandbox-db-FB-ABC12345");
  });

  it("includes the full buildId", () => {
    expect(buildDbContainerName("build-xyz-99")).toBe("dpf-sandbox-db-build-xyz-99");
  });
});

describe("buildNeo4jContainerName", () => {
  it("prefixes with dpf-sandbox-neo4j-", () => {
    expect(buildNeo4jContainerName("FB-ABC12345")).toBe("dpf-sandbox-neo4j-FB-ABC12345");
  });

  it("includes the full buildId", () => {
    expect(buildNeo4jContainerName("build-xyz-99")).toBe("dpf-sandbox-neo4j-build-xyz-99");
  });
});

describe("buildQdrantContainerName", () => {
  it("prefixes with dpf-sandbox-qdrant-", () => {
    expect(buildQdrantContainerName("FB-ABC12345")).toBe("dpf-sandbox-qdrant-FB-ABC12345");
  });

  it("includes the full buildId", () => {
    expect(buildQdrantContainerName("build-xyz-99")).toBe("dpf-sandbox-qdrant-build-xyz-99");
  });
});

describe("buildDockerHealthInspectCommand", () => {
  it("checks container health through docker inspect instead of in-container wget", () => {
    const command = buildDockerHealthInspectCommand("dpf-qdrant-1");

    expect(command).toContain("docker inspect -f");
    expect(command).toContain("dpf-qdrant-1");
    expect(command).toContain("healthy");
    expect(command).not.toContain("wget");
  });
});

// ─── Environment Variable Builder ─────────────────────────────────────────────

describe("buildSandboxDbEnvVars", () => {
  const buildId = "FB-TEST001";
  let envVars: ReturnType<typeof buildSandboxDbEnvVars>;

  // Compute once for all assertions in this suite
  it("returns an object", () => {
    envVars = buildSandboxDbEnvVars(buildId);
    expect(typeof envVars).toBe("object");
    expect(envVars).not.toBeNull();
  });

  it("sets DATABASE_URL with correct postgres container hostname", () => {
    const vars = buildSandboxDbEnvVars(buildId);
    const expectedHost = buildDbContainerName(buildId);
    expect(vars.DATABASE_URL).toBe(
      `postgresql://dpf:dpf_sandbox@${expectedHost}:5432/dpf`,
    );
  });

  it("sets NEO4J_URI with bolt scheme and correct hostname", () => {
    const vars = buildSandboxDbEnvVars(buildId);
    const expectedHost = buildNeo4jContainerName(buildId);
    expect(vars.NEO4J_URI).toBe(`bolt://${expectedHost}:7687`);
  });

  it("sets NEO4J_USER to neo4j", () => {
    const vars = buildSandboxDbEnvVars(buildId);
    expect(vars.NEO4J_USER).toBe("neo4j");
  });

  it("sets NEO4J_PASSWORD to dpf_sandbox", () => {
    const vars = buildSandboxDbEnvVars(buildId);
    expect(vars.NEO4J_PASSWORD).toBe("dpf_sandbox");
  });

  it("sets QDRANT_INTERNAL_URL with http scheme and correct hostname", () => {
    const vars = buildSandboxDbEnvVars(buildId);
    const expectedHost = buildQdrantContainerName(buildId);
    expect(vars.QDRANT_INTERNAL_URL).toBe(`http://${expectedHost}:6333`);
  });

  it("contains exactly the expected keys", () => {
    const vars = buildSandboxDbEnvVars(buildId);
    expect(Object.keys(vars).sort()).toEqual(
      ["DATABASE_URL", "NEO4J_PASSWORD", "NEO4J_URI", "NEO4J_USER", "QDRANT_INTERNAL_URL"].sort(),
    );
  });

  it("embeds buildId in all URL values", () => {
    const vars = buildSandboxDbEnvVars(buildId);
    expect(vars.DATABASE_URL).toContain(buildId);
    expect(vars.NEO4J_URI).toContain(buildId);
    expect(vars.QDRANT_INTERNAL_URL).toContain(buildId);
  });

  it("produces distinct hostnames for different buildIds", () => {
    const vars1 = buildSandboxDbEnvVars("build-001");
    const vars2 = buildSandboxDbEnvVars("build-002");
    expect(vars1.DATABASE_URL).not.toBe(vars2.DATABASE_URL);
    expect(vars1.NEO4J_URI).not.toBe(vars2.NEO4J_URI);
    expect(vars1.QDRANT_INTERNAL_URL).not.toBe(vars2.QDRANT_INTERNAL_URL);
  });
});
