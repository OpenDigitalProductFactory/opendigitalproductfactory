import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock neo4j module before import
vi.mock("./neo4j", () => ({
  runCypher: vi.fn().mockResolvedValue([]),
}));

import { runCypher } from "./neo4j";
import { syncDocumentReference, syncInfraCI, syncInventoryRelationship } from "./neo4j-sync";

const mockRunCypher = vi.mocked(runCypher);

describe("syncInfraCI", () => {
  beforeEach(() => {
    mockRunCypher.mockClear();
  });

  it("merges basic InfraCI node without extended props", async () => {
    await syncInfraCI({
      ciId: "CI-test-01",
      name: "Test Node",
      ciType: "service",
      status: "operational",
    });

    expect(mockRunCypher).toHaveBeenCalledTimes(1);
    const cypher = mockRunCypher.mock.calls[0]![0] as string;
    expect(cypher).toContain("MERGE (ci:InfraCI {ciId: $ciId})");
    expect(cypher).toContain("ci.name = $name");
    expect(cypher).toContain("ci.status = $status");
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

    expect(mockRunCypher).toHaveBeenCalledTimes(1);
    const params = mockRunCypher.mock.calls[0]![1] as Record<string, unknown>;
    expect(params).toMatchObject({
      ciId: "CI-ollama-01",
      baseUrl: "http://ollama:11434",
      gpu: "NVIDIA RTX 4090",
      vramGb: 24,
      modelCount: 3,
    });
    const cypher = mockRunCypher.mock.calls[0]![0] as string;
    expect(cypher).toContain("ci.baseUrl = $baseUrl");
    expect(cypher).toContain("ci.gpu = $gpu");
    expect(cypher).toContain("ci.vramGb = $vramGb");
    expect(cypher).toContain("ci.modelCount = $modelCount");
  });

  it("omits all extended properties when not provided", async () => {
    await syncInfraCI({
      ciId: "CI-test-02",
      name: "Test",
      ciType: "database",
      status: "operational",
    });

    const cypher = mockRunCypher.mock.calls[0]![0] as string;
    expect(cypher).not.toContain("ci.baseUrl");
    expect(cypher).not.toContain("ci.gpu");
    expect(cypher).not.toContain("ci.vramGb");
    expect(cypher).not.toContain("ci.modelCount");
  });

  it("creates BELONGS_TO edge when portfolioSlug provided", async () => {
    await syncInfraCI({
      ciId: "CI-test-03",
      name: "Test",
      ciType: "service",
      status: "operational",
      portfolioSlug: "foundational",
    });

    expect(mockRunCypher).toHaveBeenCalledTimes(2);
    const edgeCypher = mockRunCypher.mock.calls[1]![0] as string;
    expect(edgeCypher).toContain("BELONGS_TO");
  });
});

describe("syncInventoryRelationship", () => {
  beforeEach(() => {
    mockRunCypher.mockClear();
  });

  it("creates typed HOSTS edge for network relationship types", async () => {
    await syncInventoryRelationship({
      fromEntityKey: "docker-host:myhost",
      toEntityKey: "docker_runtime:/var/run/docker.sock",
      relationshipType: "HOSTS",
    });

    expect(mockRunCypher).toHaveBeenCalledTimes(1);
    const cypher = mockRunCypher.mock.calls[0]![0] as string;
    expect(cypher).toContain(":HOSTS");
    expect(cypher).not.toContain("DEPENDS_ON");
  });

  it("creates typed MONITORS edge", async () => {
    await syncInventoryRelationship({
      fromEntityKey: "prom-target:prometheus:localhost:9090",
      toEntityKey: "prom-target:portal:portal:3000",
      relationshipType: "monitors",
    });

    expect(mockRunCypher).toHaveBeenCalledTimes(1);
    const cypher = mockRunCypher.mock.calls[0]![0] as string;
    expect(cypher).toContain(":MONITORS");
    expect(cypher).not.toContain("DEPENDS_ON");
  });

  it("creates typed MEMBER_OF edge for subnet relationships", async () => {
    await syncInventoryRelationship({
      fromEntityKey: "net-iface:eth0:10.0.0.5",
      toEntityKey: "subnet:10.0.0.0/24",
      relationshipType: "MEMBER_OF",
    });

    expect(mockRunCypher).toHaveBeenCalledTimes(1);
    const cypher = mockRunCypher.mock.calls[0]![0] as string;
    expect(cypher).toContain(":MEMBER_OF");
  });

  it("creates typed RUNS_ON edge", async () => {
    await syncInventoryRelationship({
      fromEntityKey: "container:abc123",
      toEntityKey: "host:myhost",
      relationshipType: "RUNS_ON",
    });

    expect(mockRunCypher).toHaveBeenCalledTimes(1);
    const cypher = mockRunCypher.mock.calls[0]![0] as string;
    expect(cypher).toContain(":RUNS_ON");
  });

  it("falls back to DEPENDS_ON for unknown relationship types", async () => {
    await syncInventoryRelationship({
      fromEntityKey: "app:portal",
      toEntityKey: "db:postgres",
      relationshipType: "uses",
    });

    expect(mockRunCypher).toHaveBeenCalledTimes(1);
    const cypher = mockRunCypher.mock.calls[0]![0] as string;
    expect(cypher).toContain("DEPENDS_ON");
  });

  it("handles case-insensitive relationship type matching", async () => {
    await syncInventoryRelationship({
      fromEntityKey: "docker-host:myhost",
      toEntityKey: "docker_runtime:sock",
      relationshipType: "hosts",
    });

    expect(mockRunCypher).toHaveBeenCalledTimes(1);
    const cypher = mockRunCypher.mock.calls[0]![0] as string;
    expect(cypher).toContain(":HOSTS");
  });
});

describe("syncDocumentReference", () => {
  beforeEach(() => {
    mockRunCypher.mockClear();
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

    expect(mockRunCypher).toHaveBeenCalledTimes(1);
    const cypher = mockRunCypher.mock.calls[0]![0] as string;
    const params = mockRunCypher.mock.calls[0]![1] as Record<string, unknown>;
    expect(cypher).toContain("MERGE (source:Document {documentId: $sourceDocumentId})");
    expect(cypher).toContain(":DOC_REFERENCES");
    expect(params).toMatchObject({
      sourceDocumentId: "DOC-AAA11111",
      targetDocumentId: "DOC-BBB22222",
      refType: "cites",
      sourceVersionId: "version-a",
      targetVersionId: "version-b",
    });
  });
});
