import { spawn } from "node:child_process";

import type { TeardownEnvelope } from "./contract";

export interface TeardownDispatchParams {
  envelope: TeardownEnvelope;
  signature: string;
  promoterImage: string;
  stateDirHostPath: string;
}

export function buildTeardownDockerCommand(params: TeardownDispatchParams): {
  command: "docker";
  args: string[];
} {
  const stateDir = params.stateDirHostPath.trim().replace(/[\\/]$/, "");
  if (!stateDir) throw new Error("teardown_state_dir_missing");
  if (!/^[a-f0-9]{64}$/.test(params.signature)) throw new Error("teardown_signature_invalid");
  if (!params.promoterImage.trim()) throw new Error("teardown_runner_image_missing");

  const encoded = Buffer.from(JSON.stringify(params.envelope)).toString("base64url");
  const containerName = `dpf-teardown-${params.envelope.runId.toLowerCase()}`;
  return {
    command: "docker",
    args: [
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "-v",
      "/var/run/docker.sock:/var/run/docker.sock",
      "-v",
      `${params.envelope.installPath}:/install`,
      "-v",
      `${params.envelope.backupsPath}:/evidence`,
      "-v",
      `${stateDir}/runtime-transition.secret:/run/secrets/dpf-runtime-transition:ro`,
      "-e",
      `DPF_TEARDOWN_ENVELOPE=${encoded}`,
      "-e",
      `DPF_TEARDOWN_SIGNATURE=${params.signature}`,
      "--entrypoint",
      "node",
      params.promoterImage,
      "/promoter/governed-teardown.mjs",
    ],
  };
}

export async function dispatchTeardown(params: TeardownDispatchParams): Promise<{
  containerId: string;
  containerName: string;
}> {
  const { command, args } = buildTeardownDockerCommand(params);
  const containerName = `dpf-teardown-${params.envelope.runId.toLowerCase()}`;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env }, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`teardown_dispatch_failed:${code ?? "unknown"}:${stderr.trim().slice(-1000)}`));
        return;
      }
      const containerId = stdout.trim();
      if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
        reject(new Error("teardown_dispatch_receipt_invalid"));
        return;
      }
      resolve({ containerId, containerName });
    });
  });
}
