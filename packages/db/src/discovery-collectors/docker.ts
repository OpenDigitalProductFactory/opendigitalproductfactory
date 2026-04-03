import { spawnSync } from "node:child_process";
import fs from "node:fs";

import type { CollectorContext, CollectorOutput } from "../discovery-types";

const DOCKER_SOCKET_PATHS = [
  "/var/run/docker.sock",
  "\\\\.\\pipe\\docker_engine",
];

// ─── Monitoring Service Classification ──────────────────────────────────────
// Containers whose image matches these patterns are classified as monitoring
// infrastructure and attributed to the Observability Platform taxonomy node.

const MONITORING_IMAGE_PATTERNS: Array<{ pattern: RegExp; role: string; monitors?: string[] }> = [
  { pattern: /prom\/prometheus/i, role: "metrics_collector", monitors: ["all"] },
  { pattern: /grafana\/grafana/i, role: "dashboard", monitors: ["prometheus"] },
  { pattern: /cadvisor/i, role: "container_metrics", monitors: ["docker_runtime"] },
  { pattern: /node-exporter/i, role: "host_metrics" },
  { pattern: /postgres-exporter/i, role: "database_metrics", monitors: ["postgres"] },
  { pattern: /grafana\/loki/i, role: "log_aggregator" },
  { pattern: /grafana\/alloy/i, role: "log_shipper" },
  { pattern: /grafana\/tempo/i, role: "trace_storage" },
  { pattern: /otel.*collector/i, role: "trace_collector" },
  { pattern: /alertmanager/i, role: "alert_router" },
  { pattern: /netdata/i, role: "monitoring_suite" },
];

function classifyContainer(image: string): { itemType: string; serviceRole: string | null; monitors: string[] } {
  for (const entry of MONITORING_IMAGE_PATTERNS) {
    if (entry.pattern.test(image)) {
      return {
        itemType: "monitoring_service",
        serviceRole: entry.role,
        monitors: entry.monitors ?? [],
      };
    }
  }
  return { itemType: "container", serviceRole: null, monitors: [] };
}

export type DockerHostInfo = {
  operatingSystem?: string;
  osType?: string;
  architecture?: string;
  kernelVersion?: string;
  cpus?: number;
  memTotal?: number;
  serverVersion?: string;
  name?: string;
};

export type DockerDeps = {
  socketPaths: string[];
  existsSync: (path: string) => boolean;
  listContainers: () => Promise<Array<{ id: string; name: string; image: string }>>;
  getDockerInfo: () => DockerHostInfo | null;
};

async function defaultListContainers(): Promise<Array<{ id: string; name: string; image: string }>> {
  const result = spawnSync(
    "docker",
    ["ps", "--format", "{{json .}}"],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { ID?: string; Names?: string; Image?: string })
    .filter((entry) => entry.ID && entry.Image)
    .map((entry) => ({
      id: entry.ID!,
      name: entry.Names ?? entry.ID!,
      image: entry.Image!,
    }));
}

function defaultGetDockerInfo(): DockerHostInfo | null {
  const result = spawnSync(
    "docker",
    ["info", "--format", "{{json .}}"],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout.trim()) return null;
  try {
    const info = JSON.parse(result.stdout) as Record<string, unknown>;
    return {
      operatingSystem: info.OperatingSystem as string | undefined,
      osType: info.OSType as string | undefined,
      architecture: info.Architecture as string | undefined,
      kernelVersion: info.KernelVersion as string | undefined,
      cpus: info.NCPU as number | undefined,
      memTotal: info.MemTotal as number | undefined,
      serverVersion: info.ServerVersion as string | undefined,
      name: info.Name as string | undefined,
    };
  } catch {
    return null;
  }
}

const defaultDockerDeps: DockerDeps = {
  socketPaths: DOCKER_SOCKET_PATHS,
  existsSync: fs.existsSync,
  listContainers: defaultListContainers,
  getDockerInfo: defaultGetDockerInfo,
};

export async function collectDockerDiscovery(
  ctx?: CollectorContext,
  deps: DockerDeps = defaultDockerDeps,
): Promise<CollectorOutput> {
  const socketPath = deps.socketPaths.find((candidate) => deps.existsSync(candidate));

  if (!socketPath) {
    return { items: [], relationships: [], warnings: ["docker_unavailable"] };
  }

  const containers = await deps.listContainers();

  const source = ctx?.sourceKind ?? "docker";
  const runtimeRef = `docker_runtime:${socketPath}`;

  const items: CollectorOutput["items"] = [
    {
      sourceKind: source,
      itemType: "docker_runtime",
      name: "Docker",
      externalRef: runtimeRef,
      naturalKey: `socket:${socketPath}`,
      confidence: 0.9,
      sourcePath: socketPath,
      attributes: { socketPath },
    },
  ];

  const relationships: CollectorOutput["relationships"] = [];

  // ── Docker Host System (the machine running Docker) ─────────────
  const hostInfo = deps.getDockerInfo();
  if (hostInfo) {
    const hostRef = `docker-host:${hostInfo.name ?? "localhost"}`;
    items.push({
      sourceKind: source,
      itemType: "docker_host",
      name: hostInfo.operatingSystem
        ? `${hostInfo.name ?? "Docker Host"} (${hostInfo.operatingSystem})`
        : (hostInfo.name ?? "Docker Host"),
      externalRef: hostRef,
      naturalKey: `docker-host:${hostInfo.name ?? "localhost"}`,
      confidence: 0.95,
      attributes: {
        operatingSystem: hostInfo.operatingSystem,
        osType: hostInfo.osType,
        architecture: hostInfo.architecture,
        kernelVersion: hostInfo.kernelVersion,
        cpus: hostInfo.cpus,
        memTotalBytes: hostInfo.memTotal,
        dockerVersion: hostInfo.serverVersion,
        osiLayer: 3,
        osiLayerName: "network",
      },
    });

    // Docker host HOSTS the Docker runtime
    relationships.push({
      sourceKind: source,
      relationshipType: "HOSTS",
      fromExternalRef: hostRef,
      toExternalRef: runtimeRef,
      confidence: 0.95,
      attributes: { mechanism: "docker_desktop" },
    });
  }
  const software: CollectorOutput["software"] = [];

  for (const container of containers) {
    const classification = classifyContainer(container.image);
    const containerRef = `container:${container.id}`;

    items.push({
      sourceKind: source,
      itemType: classification.itemType,
      name: container.name,
      externalRef: containerRef,
      naturalKey: `container:${container.id}`,
      confidence: 0.9,
      attributes: {
        containerId: container.id,
        image: container.image,
        ...(classification.serviceRole && { serviceRole: classification.serviceRole }),
      },
    });

    // Docker runtime hosts this container
    relationships.push({
      sourceKind: source,
      relationshipType: "hosts",
      fromExternalRef: runtimeRef,
      toExternalRef: containerRef,
      confidence: 0.9,
      attributes: { runtime: "docker" },
    });

    // Monitoring services monitor other containers
    if (classification.monitors.length > 0) {
      for (const targetContainer of containers) {
        if (targetContainer.id === container.id) continue;
        // "all" means this monitoring service monitors every other container
        if (classification.monitors.includes("all") || classification.monitors.some((m) => targetContainer.image.includes(m))) {
          relationships.push({
            sourceKind: source,
            relationshipType: "monitors",
            fromExternalRef: containerRef,
            toExternalRef: `container:${targetContainer.id}`,
            confidence: 0.85,
            attributes: { serviceRole: classification.serviceRole },
          });
        }
      }
    }

    software.push({
      sourceKind: source,
      entityExternalRef: containerRef,
      evidenceSource: "container_image",
      rawProductName: container.image,
      rawPackageName: container.image,
    });
  }

  return { items, relationships, software };
}
