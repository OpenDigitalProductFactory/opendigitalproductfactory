import { lazyExec } from "@/lib/shared/lazy-node";
import {
  createSandbox,
  destroySandbox,
  execInSandbox,
  initializeSandboxWorkspace,
  startSandbox,
  startSandboxDevServer,
} from "../sandbox";
import type {
  BuildExecutionProvider,
  BuildExecutionProviderCapabilities,
  ExecOpts,
  ExecResult,
  SandboxHandle,
  SandboxSpec,
} from "../provider-types";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const exec = lazyExec();

const capabilities: BuildExecutionProviderCapabilities = {
  isolation: "container",
  trustLevel: "trusted-code-only",
  workspacePersistence: "durable",
  logSink: "authority-core",
  networkPolicy: "namespaced",
  cleanupModel: "explicit",
  supportsPreviewUrl: true,
  supportsPortCallbacks: true,
  supportsFileCopy: true,
  supportsSnapshot: false,
  dockerInsideSandbox: false,
  maxConcurrentSandboxes: 1,
};

function containerIdFor(handle: SandboxHandle): string {
  const containerId = handle.containerId ?? handle.id;
  if (!containerId) throw new Error("Sandbox handle has no container ID");
  return containerId;
}

export const localDockerProvider: BuildExecutionProvider = {
  id: "local-docker",

  async createSandbox(spec: SandboxSpec): Promise<SandboxHandle> {
    const hostPort = spec.hostPort ?? 3035;
    const containerId = await createSandbox(spec.buildId, hostPort, {
      networkName: spec.networkName,
      envVars: spec.env,
    });

    return {
      id: containerId,
      buildId: spec.buildId,
      providerId: "local-docker",
      containerId,
      hostPort,
      previewUrl: `http://localhost:${hostPort}`,
    };
  },

  async startSandbox(handle: SandboxHandle): Promise<void> {
    await startSandbox(containerIdFor(handle));
    await initializeSandboxWorkspace(containerIdFor(handle));
  },

  async destroySandbox(handle: SandboxHandle): Promise<void> {
    await destroySandbox(containerIdFor(handle));
  },

  async exec(handle: SandboxHandle, command: string[], opts?: ExecOpts): Promise<ExecResult> {
    const startMs = Date.now();
    const shellCommand = command.join(" ");
    try {
      const stdout = await execInSandbox(containerIdFor(handle), opts?.cwd ? `cd ${opts.cwd} && ${shellCommand}` : shellCommand);
      return {
        exitCode: 0,
        stdout,
        stderr: "",
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: getErrorMessage(err),
        durationMs: Date.now() - startMs,
      };
    }
  },

  async readFile(handle: SandboxHandle, path: string): Promise<string> {
    return execInSandbox(containerIdFor(handle), `cat ${JSON.stringify(path)}`);
  },

  async writeFile(handle: SandboxHandle, path: string, content: string): Promise<void> {
    const encoded = Buffer.from(content).toString("base64");
    await execInSandbox(containerIdFor(handle), `mkdir -p "$(dirname ${JSON.stringify(path)})" && echo ${encoded} | base64 -d > ${JSON.stringify(path)}`);
  },

  async copyAppsWebInto(handle: SandboxHandle): Promise<void> {
    await initializeSandboxWorkspace(containerIdFor(handle));
  },

  async getPreviewUrl(handle: SandboxHandle): Promise<string | null> {
    return handle.previewUrl ?? (handle.hostPort ? `http://localhost:${handle.hostPort}` : null);
  },

  async launchNextDev(handle: SandboxHandle): Promise<void> {
    await startSandboxDevServer(containerIdFor(handle));
  },

  capabilities(): BuildExecutionProviderCapabilities {
    return capabilities;
  },
};
