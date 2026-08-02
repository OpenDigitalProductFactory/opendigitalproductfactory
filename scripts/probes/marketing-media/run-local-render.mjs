import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const probeDir = dirname(fileURLToPath(import.meta.url));
const compositionDir = resolve(process.env.DPF_MEDIA_COMPOSITION_DIR ?? resolve(probeDir, "composition"));
const outputDir = resolve(probeDir, "outputs");
const receiptPath = resolve(probeDir, "local-render-receipt.json");
const hyperframesBin = process.env.DPF_MEDIA_HYPERFRAMES_BIN ?? "hyperframes";
const ffmpegBin = process.env.DPF_MEDIA_FFMPEG_BIN ?? "ffmpeg";
const ffprobeBin = process.env.DPF_MEDIA_FFPROBE_BIN ?? "ffprobe";
const browserBin = process.env.DPF_MEDIA_BROWSER_BIN ?? "chrome-headless-shell";

function run(command, args, options = {}) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? probeDir,
    encoding: "utf8",
    timeout: options.timeout ?? 15 * 60_000,
    windowsHide: true,
  });
  return {
    command,
    args,
    status: result.status,
    signal: result.signal,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    error: result.error?.message ?? null,
  };
}

function requireSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status ?? result.signal ?? result.error}): ${result.stderr || result.stdout}`);
  }
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function executableFingerprint(command) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const located = run(locator, [command]);
  requireSuccess(located, `${command} executable lookup`);
  const path = located.stdout.split(/\r?\n/).find(Boolean);
  if (!path) throw new Error(`${command} executable lookup returned no path`);
  return { path, sha256: await sha256(path) };
}

function compactVersion(result) {
  return (result.stdout || result.stderr).split(/\r?\n/, 1)[0] ?? "unknown";
}

await mkdir(outputDir, { recursive: true });
const runAPath = resolve(outputDir, "run-a.mp4");
const runBPath = resolve(outputDir, "run-b.mp4");

const versions = {
  hyperframes: run(hyperframesBin, ["--version"]),
  ffmpeg: run(ffmpegBin, ["-version"]),
  ffprobe: run(ffprobeBin, ["-version"]),
  browser: run(browserBin, ["--version"]),
};
for (const [name, result] of Object.entries(versions)) requireSuccess(result, `${name} version probe`);

const ffmpegBuildConfiguration = run(ffmpegBin, ["-hide_banner", "-buildconf"]);
const ffmpegLicense = run(ffmpegBin, ["-hide_banner", "-L"]);
requireSuccess(ffmpegBuildConfiguration, "FFmpeg build-configuration probe");
requireSuccess(ffmpegLicense, "FFmpeg license probe");

const validation = {
  lint: run(hyperframesBin, ["lint"], { cwd: compositionDir }),
  validate: run(hyperframesBin, ["validate"], { cwd: compositionDir, timeout: 5 * 60_000 }),
  inspect: run(hyperframesBin, ["inspect", "--json"], { cwd: compositionDir, timeout: 5 * 60_000 }),
};
for (const [name, result] of Object.entries(validation)) requireSuccess(result, `HyperFrames ${name}`);

const renderA = run(hyperframesBin, ["render", "--workers", "1", "--output", runAPath], { cwd: compositionDir });
requireSuccess(renderA, "first render");
const renderB = run(hyperframesBin, ["render", "--workers", "1", "--output", runBPath], { cwd: compositionDir });
requireSuccess(renderB, "second render");

const probeA = run(ffprobeBin, ["-v", "error", "-show_format", "-show_streams", "-of", "json", runAPath]);
const probeB = run(ffprobeBin, ["-v", "error", "-show_format", "-show_streams", "-of", "json", runBPath]);
requireSuccess(probeA, "first ffprobe");
requireSuccess(probeB, "second ffprobe");

const frameHashA = run(ffmpegBin, ["-v", "error", "-i", runAPath, "-map", "0:v:0", "-f", "framehash", "-hash", "sha256", "-"]);
const frameHashB = run(ffmpegBin, ["-v", "error", "-i", runBPath, "-map", "0:v:0", "-f", "framehash", "-hash", "sha256", "-"]);
requireSuccess(frameHashA, "first frame hash");
requireSuccess(frameHashB, "second frame hash");

const compositionHash = await sha256(resolve(compositionDir, "index.html"));
const outputHashA = await sha256(runAPath);
const outputHashB = await sha256(runBPath);
const normalizedFrameHashA = createHash("sha256").update(frameHashA.stdout).digest("hex");
const normalizedFrameHashB = createHash("sha256").update(frameHashB.stdout).digest("hex");

const receipt = {
  schemaVersion: 1,
  kind: "marketing-media-local-render",
  backlogItemId: "BI-0C891AC7",
  toolEvaluationId: "cmsb7dhyr06z601tcngsqzwyg",
  candidate: { tool: "HyperFrames", version: "0.7.87" },
  composition: { durationSeconds: 50, width: 1920, height: 1080, sha256: compositionHash },
  toolchain: {
    hyperframes: {
      version: compactVersion(versions.hyperframes),
      executable: await executableFingerprint(hyperframesBin),
    },
    ffmpeg: {
      version: compactVersion(versions.ffmpeg),
      executable: await executableFingerprint(ffmpegBin),
      buildConfiguration: (ffmpegBuildConfiguration.stdout || ffmpegBuildConfiguration.stderr).trim(),
      licenseTextSha256: createHash("sha256").update(ffmpegLicense.stdout || ffmpegLicense.stderr).digest("hex"),
    },
    ffprobe: {
      version: compactVersion(versions.ffprobe),
      executable: await executableFingerprint(ffprobeBin),
    },
    browser: {
      version: compactVersion(versions.browser),
      executable: await executableFingerprint(browserBin),
    },
  },
  validation: Object.fromEntries(Object.entries(validation).map(([name, result]) => [name, {
    durationMs: result.durationMs,
    outputSha256: createHash("sha256").update(result.stdout || result.stderr).digest("hex"),
  }])),
  runs: [
    { label: "a", durationMs: renderA.durationMs, outputSha256: outputHashA, normalizedFrameSha256: normalizedFrameHashA, media: JSON.parse(probeA.stdout) },
    { label: "b", durationMs: renderB.durationMs, outputSha256: outputHashB, normalizedFrameSha256: normalizedFrameHashB, media: JSON.parse(probeB.stdout) },
  ],
  determinism: {
    byteIdentical: outputHashA === outputHashB,
    frameIdentical: normalizedFrameHashA === normalizedFrameHashB,
  },
};

await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receiptPath, determinism: receipt.determinism, durationsMs: receipt.runs.map((item) => item.durationMs) }));
