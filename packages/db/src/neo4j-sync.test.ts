import { describe, it, expect, vi, beforeEach } from "vitest";

// BET-5: the sync writers now UPSERT into the Postgres graph mirror via
// prisma.$executeRawUnsafe (see neo4j-sync.ts) instead of running Cypher.
// Mock the prisma client seam and assert against the SQL + positional params.
vi.mock("./client", () => ({
  prisma: {
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    taxonomyNode: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

import { prisma } from "./client";
import { syncDocumentReference, syncInfraCI, syncInventoryRelationship } from "./neo4j-sync";

const exec = vi.mocked(prisma.$executeRawUnsafe);

/** Node writes call $executeRawUnsafe(sql, key, labels, propsJson). */
function nodeCall(call: unknown[]) {
  return {
    sql: call[0] as string,
    key: call[1] as string,
    labels: call[2] as string[],
    props: JSON.parse(call[3] as string) as Record<string, unknown>,
  };
}

/** Edge writes call $executeRawUnsafe(sql, srcKey, dstKey, relType, propsJson). */
function edgeCall(call: unknown[]) {
  return {
    sql: call[0] as string,
    src: call[1] as string,
    dst: call[2] as string,
    relType: call[3] as string,
    props: JSON.parse((call[4] ?? "{}") as string) as Record<string, unknown>,
  };
}

describe("syncInfraCI", () => {
  beforeEach(() => {
    exec.mockClear();
  });

  it("upserts a basic InfraCI node without extended props", async () => {
    await syncInfraCI({
      ciId: "CI-test-01",
      name: "Test Node",
      ciType: "service",
      status: "operational",
    });

    expect(exec).toHaveBeenCalledTimes(1);
    const call = nodeCall(exec.mock.calls[0]!);
    expect(call.sql).toContain("INSERT INTO graph_node");
    expect(call.key).toBe("CI-test-01");
    expect(call.labels).toContain("InfraCI");
    expect(call.props).toMatchObject({
      ciId: "CI-test-01",
      name: "Test Node",
      status: "operational",
    });
  });

  it("sets extended properties when provided", async () => {
    await syncInfraCI(
      {
        ciId: "CI-ollama-01",
        name: "Ollama",
        ciType: "ai-inference",
        status: "operational",
      },
      {
        baseUrl: "http://ollama:11434",
        gpu: "NVIDIA RTX 4090",
        vramGb: 24,
        modelCount: 3,
      },
    );

    expect(exec).toHaveBeenCalledTimes(1);
    const call = nodeCall(exec.mock.calls[0]!);
    expect(call.props).toMatchObject({
      ciId: "CI-ollama-01",
      baseUrl: "http://ollama:11434",
      gpu: "NVIDIA RTX 4090",
      vramGb: 24,
      modelCount: 3,
    });
  });

  it("omits all extended properties when not provided", async () => {
    await syncInfraCI({
      ciId: "CI-test-02",
      name: "Test",
      ciType: "database",
      status: "operational",
    });

    const call = nodeCall(exec.mock.calls[0]!);
    expect(call.props).not.toHaveProperty("baseUrl");
    expect(call.props).not.toHaveProperty("gpu");
    expect(call.props).not.toHaveProperty("vramGb");
    expect(call.props).not.toHaveProperty("modelCount");
  });

  it("creates BELONGS_TO edge when portfolioSlug provided", async () => {
    await syncInfraCI({
      ciId: "CI-test-03",
      name: "Test",
      ciType: "service",
      status: "operational",
      portfolioSlug: "foundational",
    });

    expect(exec).toHaveBeenCalledTimes(2);
    const edge = edgeCall(exec.mock.calls[1]!);
    expect(edge.sql).toContain("INSERT INTO graph_edge");
    expect(edge.src).toBe("CI-test-03");
    expect(edge.dst).toBe("foundational");
    expect(edge.relType).toBe("BELONGS_TO");
  });
});

describe("syncInventoryRelationship", () => {
  beforeEach(() => {
    exec.mockClear();
  });

  it("creates typed HOSTS edge for network relationship types", async () => {
    await syncInventoryRelationship({
      fromEntityKey: "docker-host:myhost",
      toEntityKey: "docker_runtime:/var/run/docker.sock",
      relationshipType: "HOSTS",
    });

    expect(exec).toHaveBeenCalledTimes(1);
    const edge = edgeCall(exec.mock.calls[0]!);
    expect(edge.relType).toBe("HOSTS");
    expect(edge.relType).not.toBe("DEPENDS_ON");
  });

  it("creates typed MONITORS edge", async () => {
    await syncInventoryRelationship({
      fromEntityKey: "prom-target:prometheus:localhost:9090",
      toEntityKey: "prom-target:portal:portal:3000",
      relationshipType: "monitors",
    });

    expect(exec).toHaveBeenCalledTimes(1);
    const edge = edgeCall(exec.mock.calls[0]!);
    expect(edge.relType).toBe("MONITORS");
    expect(edge.relType).not.toBe("DEPENDS_ON");
  });

  it("creates typed MEMBER_OF edge for subnet relationships", async () => {
    await syncInventoryRelationship({
      fromEntityKey: "net-iface:eth0:10.0.0.5",
      toEntityKey: "subnet:10.0.0.0/24",
      relationshipType: "MEMBER_OF",
    });

    expect(exec).toHaveBeenCalledTimes(1);
    const edge = edgeCall(exec.mock.calls[0]!);
    expect(edge.relType).toBe("MEMBER_OF");
  });

  it("creates typed RUNS_ON edge", async () => {
    await syncInventoryRelationship({
      fromEntityKey: "container:abc123",
      toEntityKey: "host:myhost",
      relationshipType: "RUNS_ON",
    });

    expect(exec).toHaveBeenCalledTimes(1);
    const edge = edgeCall(exec.mock.calls[0]!);
    expect(edge.relType).toBe("RUNS_ON");
  });

  it("falls back to DEPENDS_ON for unknown relationship types", async () => {
    await syncInventoryRelationship({
      fromEntityKey: "app:portal",
      toEntityKey: "db:postgres",
      relationshipType: "uses",
    });

    expect(exec).toHaveBeenCalledTimes(1);
    const edge = edgeCall(exec.mock.calls[0]!);
    expect(edge.relType).toBe("DEPENDS_ON");
  });

  it("handles case-insensitive relationship type matching", async () => {
    await syncInventoryRelationship({
      fromEntityKey: "docker-host:myhost",
      toEntityKey: "docker_runtime:sock",
      relationshipType: "hosts",
    });

    expect(exec).toHaveBeenCalledTimes(1);
    const edge = edgeCall(exec.mock.calls[0]!);
    expect(edge.relType).toBe("HOSTS");
  });
});

describe("syncDocumentReference", () => {
  beforeEach(() => {
    exec.mockClear();
  });

  it("projects stable document nodes and a DOC_REFERENCES edge", async () => {
    await syncDocumentReference({
      sourceDocumentId: "DOC-AAA11111",
      sourceTitle: "Workspace pattern",
      sourceState: "draft",
      sourceKind: "spec",
      sourceVersionId: "version-a",
      targetDocumentId: "DOC-BBB22222",
      targetTitle: "Document management",
      targetState: "published",
      targetKind: "spec",
      targetVersionId: "version-b",
      refType: "cites",
      anchor: "section 7",
    });

    // Two Document node upserts + one DOC_REFERENCES edge upsert.
    expect(exec).toHaveBeenCalledTimes(3);

    const sourceNode = nodeCall(exec.mock.calls[0]!);
    expect(sourceNode.key).toBe("DOC-AAA11111");
    expect(sourceNode.labels).toContain("Document");
    expect(sourceNode.props).toMatchObject({ documentId: "DOC-AAA11111" });

    const targetNode = nodeCall(exec.mock.calls[1]!);
    expect(targetNode.key).toBe("DOC-BBB22222");

    const edge = edgeCall(exec.mock.calls[2]!);
    expect(edge.src).toBe("DOC-AAA11111");
    expect(edge.dst).toBe("DOC-BBB22222");
    expect(edge.relType).toBe("DOC_REFERENCES");
    expect(edge.props).toMatchObject({
      refType: "cites",
      sourceVersionId: "version-a",
      targetVersionId: "version-b",
    });
  });
});
