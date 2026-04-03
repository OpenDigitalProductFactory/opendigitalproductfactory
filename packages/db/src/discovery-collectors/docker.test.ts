import { describe, it, expect } from "vitest";

import { collectDockerDiscovery } from "./docker";
import type { DockerDeps, DockerHostInfo } from "./docker";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const MOCK_HOST_INFO: DockerHostInfo = {
  operatingSystem: "Windows 11 Pro 10.0.26200",
  osType: "linux",
  architecture: "x86_64",
  kernelVersion: "5.15.167.4-microsoft-standard-WSL2",
  cpus: 16,
  memTotal: 34359738368,
  serverVersion: "27.5.1",
  name: "docker-desktop",
};

const MOCK_CONTAINERS = [
  { id: "abc123", name: "dpf-portal", image: "dpf-portal:latest" },
  { id: "def456", name: "dpf-prometheus", image: "prom/prometheus:latest" },
  { id: "ghi789", name: "dpf-postgres", image: "postgres:16-alpine" },
];

function makeDeps(overrides: Partial<DockerDeps> = {}): DockerDeps {
  return {
    socketPaths: ["/var/run/docker.sock"],
    existsSync: (path: string) => path === "/var/run/docker.sock",
    listContainers: async () => MOCK_CONTAINERS,
    getDockerInfo: () => MOCK_HOST_INFO,
    ...overrides,
  };
}

// ─── Docker Host Discovery ─────────────────────────────────────────────────

describe("collectDockerDiscovery — host system", () => {
  it("discovers Docker host as docker_host item with OS details", async () => {
    const result = await collectDockerDiscovery(undefined, makeDeps());

    const host = result.items.find((i) => i.itemType === "docker_host");
    expect(host).toBeDefined();
    expect(host!.name).toContain("docker-desktop");
    expect(host!.name).toContain("Windows 11 Pro");
    expect(host!.attributes?.operatingSystem).toBe(
      "Windows 11 Pro 10.0.26200",
    );
    expect(host!.attributes?.cpus).toBe(16);
    expect(host!.attributes?.architecture).toBe("x86_64");
    expect(host!.attributes?.osiLayer).toBe(3);
    expect(host!.confidence).toBe(0.95);
  });

  it("creates HOSTS relationship from docker_host to docker_runtime", async () => {
    const result = await collectDockerDiscovery(undefined, makeDeps());

    const hostsRel = result.relationships.find(
      (r) =>
        r.relationshipType === "HOSTS" &&
        r.fromExternalRef?.startsWith("docker-host:"),
    );
    expect(hostsRel).toBeDefined();
    expect(hostsRel!.fromExternalRef).toBe("docker-host:docker-desktop");
    expect(hostsRel!.toExternalRef).toBe(
      "docker_runtime:/var/run/docker.sock",
    );
  });

  it("gracefully handles unavailable docker info", async () => {
    const deps = makeDeps({ getDockerInfo: () => null });
    const result = await collectDockerDiscovery(undefined, deps);

    const host = result.items.find((i) => i.itemType === "docker_host");
    expect(host).toBeUndefined();

    // Should still discover containers
    const containers = result.items.filter(
      (i) =>
        i.itemType === "container" || i.itemType === "monitoring_service",
    );
    expect(containers.length).toBeGreaterThan(0);
  });
});

// ─── Existing Docker Discovery ─────────────────────────────────────────────

describe("collectDockerDiscovery — containers", () => {
  it("discovers docker runtime item", async () => {
    const result = await collectDockerDiscovery(undefined, makeDeps());

    const runtime = result.items.find((i) => i.itemType === "docker_runtime");
    expect(runtime).toBeDefined();
    expect(runtime!.name).toBe("Docker");
  });

  it("discovers containers and classifies monitoring services", async () => {
    const result = await collectDockerDiscovery(undefined, makeDeps());

    const prometheus = result.items.find(
      (i) => i.name === "dpf-prometheus",
    );
    expect(prometheus).toBeDefined();
    expect(prometheus!.itemType).toBe("monitoring_service");

    const portal = result.items.find((i) => i.name === "dpf-portal");
    expect(portal).toBeDefined();
    expect(portal!.itemType).toBe("container");
  });

  it("creates hosts relationships from runtime to containers", async () => {
    const result = await collectDockerDiscovery(undefined, makeDeps());

    const hostsRels = result.relationships.filter(
      (r) =>
        r.relationshipType === "hosts" &&
        r.fromExternalRef === "docker_runtime:/var/run/docker.sock",
    );
    expect(hostsRels).toHaveLength(MOCK_CONTAINERS.length);
  });

  it("returns empty when docker socket not found", async () => {
    const deps = makeDeps({ existsSync: () => false });
    const result = await collectDockerDiscovery(undefined, deps);

    expect(result.items).toHaveLength(0);
    expect(result.warnings).toContain("docker_unavailable");
  });
});
