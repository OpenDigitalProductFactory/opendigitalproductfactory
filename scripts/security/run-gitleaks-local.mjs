#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, chmodSync } from "node:fs";
import https from "node:https";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const GITLEAKS_VERSION = "8.30.1";

const REPO = "gitleaks/gitleaks";
const GITLEAKS_RELEASE_URL = `https://github.com/${REPO}/releases/download/v${GITLEAKS_VERSION}`;
const GITLEAKS_ASSET_PATTERN = new RegExp(
  `^gitleaks_${GITLEAKS_VERSION}_(darwin|linux|windows)_(arm64|x32|x64)\\.(zip|tar\\.gz)$`,
);

const ASSET_PLATFORM = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};

const ASSET_ARCH = {
  arm64: "arm64",
  ia32: "x32",
  x64: "x64",
};

export function resolveGitleaksAsset({ platform = process.platform, arch = process.arch } = {}) {
  const releasePlatform = ASSET_PLATFORM[platform];
  const releaseArch = ASSET_ARCH[arch];

  if (!releasePlatform || !releaseArch) {
    throw new Error(`Unsupported platform for local gitleaks: ${platform}/${arch}`);
  }

  const extension = platform === "win32" ? "zip" : "tar.gz";
  return `gitleaks_${GITLEAKS_VERSION}_${releasePlatform}_${releaseArch}.${extension}`;
}

export function buildGitleaksDownloadUrl(asset) {
  if (!GITLEAKS_ASSET_PATTERN.test(asset)) {
    throw new Error(`Refusing to download unexpected gitleaks release asset: ${asset}`);
  }

  return `${GITLEAKS_RELEASE_URL}/${asset}`;
}

export function normalizeMode(argv) {
  const hasStaged = argv.includes("--staged") || argv.includes("staged");
  const hasTree = argv.includes("--tree") || argv.includes("tree");

  if (hasStaged && hasTree) {
    throw new Error("Choose only one gitleaks mode: --staged or --tree.");
  }

  return hasTree ? "tree" : "staged";
}

export function buildGitleaksArgs({ mode, configPath }) {
  const baseArgs = ["--redact", "--config", configPath, "--no-banner", "--no-color"];

  if (mode === "staged") {
    return ["protect", "--staged", ...baseArgs];
  }

  if (mode === "tree") {
    return ["dir", ".", ...baseArgs];
  }

  throw new Error(`Unsupported gitleaks scan mode: ${mode}`);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
}

function runVisible(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
}

function repoRoot() {
  const result = run("git", ["rev-parse", "--show-toplevel"]);
  if (result.status !== 0) {
    throw new Error("Local gitleaks scan must run inside a git repository.");
  }
  return result.stdout.trim();
}

function gitPath(root, relativePath) {
  const result = run("git", ["rev-parse", "--git-path", relativePath], { cwd: root });
  if (result.status !== 0) {
    throw new Error(`Unable to resolve git-local cache path for ${relativePath}.`);
  }
  return resolve(root, result.stdout.trim());
}

function executableName() {
  return process.platform === "win32" ? "gitleaks.exe" : "gitleaks";
}

function versionLooksPinned(command) {
  const result = run(command, ["version"]);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return result.status === 0 && output.includes(GITLEAKS_VERSION);
}

function findPowerShell() {
  for (const command of ["pwsh", "powershell.exe", "powershell"]) {
    const result = run(command, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"]);
    if (result.status === 0) {
      return command;
    }
  }
  return null;
}

function psLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function download(url, destination, redirectLimit = 5) {
  return new Promise((resolveDownload, rejectDownload) => {
    const request = https.get(url, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location && redirectLimit > 0) {
        response.resume();
        const redirectedUrl = new URL(location, url).toString();
        download(redirectedUrl, destination, redirectLimit - 1)
          .then(resolveDownload)
          .catch(rejectDownload);
        return;
      }

      if (status !== 200) {
        response.resume();
        rejectDownload(new Error(`Download failed with HTTP ${status}: ${url}`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolveDownload);
      });
      file.on("error", rejectDownload);
    });

    request.on("error", rejectDownload);
  });
}

async function ensureCachedGitleaks(root) {
  const cachedExecutable = gitPath(root, join("dpf-tools", "gitleaks", GITLEAKS_VERSION, executableName()));
  if (existsSync(cachedExecutable)) {
    return cachedExecutable;
  }

  const cacheDir = dirname(cachedExecutable);
  mkdirSync(cacheDir, { recursive: true });

  const asset = resolveGitleaksAsset();
  const archivePath = join(cacheDir, asset);
  const url = buildGitleaksDownloadUrl(asset);

  console.log(`[gitleaks-local] Downloading gitleaks ${GITLEAKS_VERSION}...`);
  await download(url, archivePath);

  if (asset.endsWith(".zip")) {
    const powershell = findPowerShell();
    if (!powershell) {
      throw new Error("PowerShell is required to extract the local gitleaks zip.");
    }

    const command = `Expand-Archive -LiteralPath ${psLiteral(archivePath)} -DestinationPath ${psLiteral(cacheDir)} -Force`;
    const result = runVisible(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
    if (result.status !== 0) {
      throw new Error("Failed to extract the local gitleaks zip.");
    }
  } else {
    const result = runVisible("tar", ["-xzf", archivePath, "-C", cacheDir, executableName()]);
    if (result.status !== 0) {
      throw new Error("Failed to extract the local gitleaks archive.");
    }
    chmodSync(cachedExecutable, 0o755);
  }

  if (!existsSync(cachedExecutable)) {
    throw new Error(`Extracted gitleaks binary was not found at ${cachedExecutable}.`);
  }

  return cachedExecutable;
}

async function resolveGitleaksExecutable(root) {
  if (process.env.GITLEAKS_BIN) {
    return process.env.GITLEAKS_BIN;
  }

  if (versionLooksPinned("gitleaks")) {
    return "gitleaks";
  }

  return ensureCachedGitleaks(root);
}

function printHelp() {
  console.log(`Usage: node scripts/security/run-gitleaks-local.mjs [--staged|--tree]

Modes:
  --staged  Scan the staged git snapshot. This is the pre-commit default.
  --tree    Scan the current working tree.

Environment:
  GITLEAKS_BIN            Use an explicit gitleaks binary.
  DPF_SKIP_SECRET_SCAN=1  Skip the pre-commit secret scan only.
`);
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  const root = repoRoot();
  const mode = normalizeMode(argv);
  const configPath = ".gitleaks.toml";
  const executable = await resolveGitleaksExecutable(root);
  const args = buildGitleaksArgs({ mode, configPath });

  const result = runVisible(executable, args, {
    cwd: root,
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

const isDirectRun = resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[gitleaks-local] ${error.message}`);
      process.exitCode = 1;
    });
}
