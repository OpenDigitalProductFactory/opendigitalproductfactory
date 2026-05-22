export type DockerComposeContainerInfo = {
  containerId: string;
  containerName: string;
  status: string;
  running: boolean;
  composeProjectName: string | null;
  composeServiceName: string | null;
  composeWorkingDir: string | null;
  composeConfigFiles: string[];
  hostPorts: number[];
};

type RawInspect = {
  Id?: string;
  Name?: string;
  State?: { Status?: string; Running?: boolean };
  Config?: { Labels?: Record<string, string> };
  NetworkSettings?: { Ports?: RawPortBindings };
};

type RawPortBindings = Record<string, Array<{ HostPort?: string }> | null>;

function splitConfigFiles(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function extractHostPorts(ports: RawPortBindings | undefined): number[] {
  if (!ports) return [];
  return Object.values(ports)
    .flatMap((bindings) => bindings ?? [])
    .map((binding) => Number(binding.HostPort))
    .filter((port) => Number.isInteger(port) && port > 0);
}

export function parseDockerInspectJson(stdout: string): DockerComposeContainerInfo | null {
  const parsed = JSON.parse(stdout) as RawInspect[];
  const first = parsed[0];
  if (!first) return null;

  const labels = first.Config?.Labels ?? {};

  return {
    containerId: first.Id ?? "",
    containerName: (first.Name ?? "").replace(/^\//, ""),
    status: first.State?.Status ?? "unknown",
    running: first.State?.Running === true,
    composeProjectName: labels["com.docker.compose.project"] ?? null,
    composeServiceName: labels["com.docker.compose.service"] ?? null,
    composeWorkingDir: labels["com.docker.compose.project.working_dir"] ?? null,
    composeConfigFiles: splitConfigFiles(labels["com.docker.compose.project.config_files"]),
    hostPorts: extractHostPorts(first.NetworkSettings?.Ports),
  };
}
