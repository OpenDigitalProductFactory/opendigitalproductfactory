import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const probeDir = dirname(fileURLToPath(import.meta.url));
const packageManifest = JSON.parse(await readFile(resolve(probeDir, "package.json"), "utf8"));
const imageTag = `dpf-marketing-media-probe:hyperframes-${packageManifest.dependencies.hyperframes}`;
// ffprobe-static ships Linux x64 binaries, but no Linux ARM64 binary.
const platform = "linux/amd64";
const receiptPath = resolve(probeDir, "local-render-receipt.json");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: probeDir,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout: options.timeout ?? 30 * 60_000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? result.signal ?? result.error?.message ?? "unknown"})`);
  }
  return result.stdout?.trim() ?? "";
}

run("docker", [
  "build",
  "--platform", platform,
  "--file", "Dockerfile.probe",
  "--label", "org.opendpf.evaluation=BI-0C891AC7",
  "--tag", imageTag,
  ".",
]);

const imageIdentity = run("docker", ["image", "inspect", imageTag, "--format", "{{.Id}}"], { capture: true });

run("docker", [
  "run",
  "--platform", platform,
  "--rm",
  "--cpus", "4",
  "--memory", "8g",
  "--network", "none",
  "--volume", `${probeDir}:/probe`,
  imageTag,
], { timeout: 40 * 60_000 });

const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
receipt.container = {
  imageTag,
  platform,
  imageIdentity,
  baseImage: "node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7",
  network: "none",
  limits: { cpus: 4, memory: "8g" },
};
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath, imageIdentity, determinism: receipt.determinism }));
