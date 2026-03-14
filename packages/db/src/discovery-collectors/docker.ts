import { spawnSync } from "node:child_process";
import fs from "node:fs";

import type { CollectorContext, CollectorOutput } from "../discovery-types";

const DOCKER_SOCKET_PATHS = [
  "/var/run/docker.sock",
  "\\\\.\\pipe\\docker_engine",
];

type DockerDeps = {
  socketPaths: string[];
  existsSync: (path: string) => boolean;
  listContainers: () => Promise<Array<{ id: string; name: string; image: string }>>;
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

const defaultDockerDeps: DockerDeps = {
  socketPaths: DOCKER_SOCKET_PATHS,
  existsSync: fs.existsSync,
  listContainers: defaultListContainers,
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

  return {
    items: [
      {
        sourceKind: ctx?.sourceKind ?? "docker",
        itemType: "docker_runtime",
        name: "Docker",
        externalRef: `docker_runtime:${socketPath}`,
        naturalKey: `socket:${socketPath}`,
        confidence: 0.9,
        sourcePath: socketPath,
        attributes: { socketPath },
      },
      ...containers.map((container) => ({
        sourceKind: ctx?.sourceKind ?? "docker",
        itemType: "container",
        name: container.name,
        externalRef: `container:${container.id}`,
        naturalKey: `container:${container.id}`,
        confidence: 0.9,
        attributes: {
          containerId: container.id,
          image: container.image,
        },
      })),
    ],
    relationships: containers.map((container) => ({
      sourceKind: ctx?.sourceKind ?? "docker",
      relationshipType: "hosts",
      fromExternalRef: `docker_runtime:${socketPath}`,
      toExternalRef: `container:${container.id}`,
      confidence: 0.9,
      attributes: {
        runtime: "docker",
      },
    })),
    software: containers.map((container) => ({
      sourceKind: ctx?.sourceKind ?? "docker",
      entityExternalRef: `container:${container.id}`,
      evidenceSource: "container_image",
      rawProductName: container.image,
      rawPackageName: container.image,
    })),
  };
}
