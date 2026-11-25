import { hostname } from "node:os";
import { spawn } from "node:child_process";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { readActuatorPortalImage, usesPrivateActuator } from "@/lib/platform-runtime/actuator-client";

const CONFIG_DIGEST = /^sha256:[a-f0-9]{64}$/;

export type ImageIdentityDockerRunner = (args: string[]) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export function parseContainerConfigDigest(value: string): string | null {
  const digest = value.trim().toLowerCase();
  return CONFIG_DIGEST.test(digest) ? digest : null;
}

async function defaultDockerRunner(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve) => {
    try {
      const child = spawn("docker", args, {
        env: { ...process.env },
        shell: false,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (result: { exitCode: number; stdout: string; stderr: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
      child.on("error", (error) => {
        finish({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` });
      });
      child.on("close", (code) => {
        finish({ exitCode: code ?? 1, stdout, stderr });
      });
    } catch (error) {
      resolve({ exitCode: 1, stdout: "", stderr: getErrorMessage(error) });
    }
  });
}

export async function readCurrentContainerConfigDigest(
  runDocker?: ImageIdentityDockerRunner,
  containerId = hostname(),
): Promise<string | null> {
  if (!containerId.trim()) return null;
  if (!runDocker && await usesPrivateActuator()) {
    try {
      const actual = await readActuatorPortalImage();
      if (!/^(?:[a-f0-9]{12}|[a-f0-9]{64})$/.test(containerId) || typeof actual.containerId !== "string"
        || !actual.containerId.startsWith(containerId) || typeof actual.image !== "string") return null;
      return parseContainerConfigDigest(actual.image);
    } catch { return null; }
  }
  const result = await (runDocker ?? defaultDockerRunner)(["inspect", "--format", "{{.Image}}", containerId]);
  return result.exitCode === 0 ? parseContainerConfigDigest(result.stdout) : null;
}
