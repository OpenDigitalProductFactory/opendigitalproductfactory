// apps/web/lib/sandbox-db.test.ts
// Pure-function tests only — do NOT test Docker commands (those are integration tests)

import { beforeEach, describe, it, expect, vi } from "vitest";

const { mockSandboxCreate, mockSandboxUpdate } = vi.hoisted(() => ({
  mockSandboxCreate: vi.fn(),
  mockSandboxUpdate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    sandbox: {
      create: mockSandboxCreate,
      update: mockSandboxUpdate,
    },
  },
}));

import {
  buildDockerHealthInspectCommand,
  buildDbContainerName,
  buildSandboxDbEnvVars,
  DB_RESOURCE_LIMITS,
  recordSandboxDestroyed,
  recordSandboxStarted,
} from "./sandbox-db";

beforeEach(() => {
  mockSandboxCreate.mockReset();
  mockSandboxUpdate.mockReset();
});

// ─── Resource Limit Constants ─────────────────────────────────────────────────

describe("DB_RESOURCE_LIMITS", () => {
  it("has 512 MB memory", () => {
    expect(DB_RESOURCE_LIMITS.memoryMb).toBe(512);
  });

  it("has 1 CPU", () => {
    expect(DB_RESOURCE_LIMITS.cpus).toBe(1);
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

describe("buildDockerHealthInspectCommand", () => {
  it("checks container health through docker inspect instead of in-container wget", () => {
    const command = buildDockerHealthInspectCommand("dpf-sandbox-db-1");

    expect(command).toContain("docker inspect -f");
    expect(command).toContain("dpf-sandbox-db-1");
    expect(command).toContain("healthy");
    expect(command).not.toContain("wget");
  });
});

// ─── Environment Variable Builder ─────────────────────────────────────────────

describe("buildSandboxDbEnvVars (BI-28D31FB7 Postgres-only)", () => {
  const buildId = "FB-TEST001";

  it("sets DATABASE_URL with correct postgres container hostname", () => {
    const vars = buildSandboxDbEnvVars(buildId);
    const expectedHost = buildDbContainerName(buildId);
    expect(vars.DATABASE_URL).toBe(
      `postgresql://dpf:dpf_sandbox@${expectedHost}:5432/dpf`,
    );
  });

  it("does not inject retired Neo4j/Qdrant env keys", () => {
    const vars = buildSandboxDbEnvVars(buildId);
    expect(Object.keys(vars).sort()).toEqual(["DATABASE_URL"]);
    expect(vars).not.toHaveProperty("NEO4J_URI");
    expect(vars).not.toHaveProperty("QDRANT_INTERNAL_URL");
  });

  it("embeds buildId in DATABASE_URL", () => {
    const vars = buildSandboxDbEnvVars(buildId);
    expect(vars.DATABASE_URL).toContain(buildId);
  });

  it("produces distinct hostnames for different buildIds", () => {
    const vars1 = buildSandboxDbEnvVars("build-001");
    const vars2 = buildSandboxDbEnvVars("build-002");
    expect(vars1.DATABASE_URL).not.toBe(vars2.DATABASE_URL);
  });
});

describe("sandbox execution records", () => {
  it("records a running sandbox with provider capabilities", async () => {
    mockSandboxCreate.mockResolvedValue({ id: "sbx-1" });

    await recordSandboxStarted({
      buildId: "FB-TEST001",
      providerId: "local-docker",
      agentId: "codex",
      portalInstanceId: "portal-local",
      previewUrl: "http://localhost:3035",
      capabilitiesSnapshot: { workspacePersistence: "durable" },
    });

    expect(mockSandboxCreate).toHaveBeenCalledWith({
      data: {
        buildId: "FB-TEST001",
        providerId: "local-docker",
        agentId: "codex",
        portalInstanceId: "portal-local",
        state: "running",
        previewUrl: "http://localhost:3035",
        capabilitiesSnapshot: { workspacePersistence: "durable" },
      },
    });
  });

  it("marks a sandbox destroyed", async () => {
    mockSandboxUpdate.mockResolvedValue({ id: "sbx-1" });
    await recordSandboxDestroyed("sbx-1");
    expect(mockSandboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sbx-1" },
        data: expect.objectContaining({ state: "destroyed" }),
      }),
    );
  });
});
