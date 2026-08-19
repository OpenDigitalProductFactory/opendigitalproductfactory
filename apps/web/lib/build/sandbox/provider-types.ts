export type BuildExecutionProviderId =
  | "local-docker"
  | "tappaas-vm"
  | "kubernetes-job"
  | "ecs-task"
  | "ecs-service"
  | "cloud-run-job"
  | "cloud-run-service"
  | "azure-containerapp-job"
  | "edge-node-local-docker"
  | "disabled";

export type SandboxSpec = {
  buildId: string;
  title?: string;
  env?: Record<string, string>;
  hostPort?: number;
  networkName?: string;
};

export type SandboxHandle = {
  id: string;
  buildId: string;
  providerId: BuildExecutionProviderId;
  containerId?: string;
  hostPort?: number;
  previewUrl?: string | null;
};

export type ExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type ExecOpts = {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
};

export type BuildExecutionProviderCapabilities = {
  isolation: "none" | "container" | "pod" | "vm" | "managed-job";
  trustLevel: "trusted-code-only" | "customer-trusted" | "untrusted-ok";
  workspacePersistence: "ephemeral" | "ttl" | "durable";
  logSink: "authority-core" | "external-required" | "provider-native";
  networkPolicy: "host" | "namespaced" | "isolated";
  cleanupModel: "explicit" | "ttl" | "label-sweep";
  supportsPreviewUrl: boolean;
  supportsPortCallbacks: boolean;
  supportsFileCopy: boolean;
  supportsSnapshot: boolean;
  dockerInsideSandbox: boolean;
  maxConcurrentSandboxes?: number;
};

export interface BuildExecutionProvider {
  readonly id: BuildExecutionProviderId;
  createSandbox(spec: SandboxSpec): Promise<SandboxHandle>;
  startSandbox(handle: SandboxHandle): Promise<void>;
  destroySandbox(handle: SandboxHandle): Promise<void>;
  exec(handle: SandboxHandle, command: string[], opts?: ExecOpts): Promise<ExecResult>;
  readFile(handle: SandboxHandle, path: string): Promise<string>;
  writeFile(handle: SandboxHandle, path: string, content: string): Promise<void>;
  copyAppsWebInto(handle: SandboxHandle, source: string): Promise<void>;
  getPreviewUrl(handle: SandboxHandle): Promise<string | null>;
  launchNextDev(handle: SandboxHandle): Promise<void>;
  capabilities(): BuildExecutionProviderCapabilities;
}

export function assertProviderCapabilities(capabilities: BuildExecutionProviderCapabilities): void {
  if (
    capabilities.trustLevel === "untrusted-ok"
    && capabilities.isolation !== "vm"
    && capabilities.isolation !== "managed-job"
  ) {
    throw new Error("untrusted-ok providers must use vm or managed-job isolation");
  }

  if (capabilities.workspacePersistence === "ephemeral" && capabilities.supportsSnapshot) {
    throw new Error("ephemeral providers cannot advertise snapshot support");
  }

  if (!capabilities.supportsFileCopy && capabilities.supportsSnapshot) {
    throw new Error("snapshot support requires file copy support");
  }
}
