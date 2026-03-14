import fs from "node:fs";

import type { CollectorContext, CollectorOutput } from "../discovery-types";

const DOCKER_SOCKET_PATHS = [
  "/var/run/docker.sock",
  "\\\\.\\pipe\\docker_engine",
];

type DockerDeps = {
  socketPaths: string[];
  existsSync: (path: string) => boolean;
};

const defaultDockerDeps: DockerDeps = {
  socketPaths: DOCKER_SOCKET_PATHS,
  existsSync: fs.existsSync,
};

export async function collectDockerDiscovery(
  ctx?: CollectorContext,
  deps: DockerDeps = defaultDockerDeps,
): Promise<CollectorOutput> {
  const socketPath = deps.socketPaths.find((candidate) => deps.existsSync(candidate));

  if (!socketPath) {
    return { items: [], relationships: [], warnings: ["docker_unavailable"] };
  }

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
    ],
    relationships: [],
  };
}
