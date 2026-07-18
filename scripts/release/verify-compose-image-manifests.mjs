#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const VALID_MODES = new Set(["dev", "release"]);
const VALID_PLATFORMS = new Set(["linux", "macos"]);
const VALID_ONLY = new Set(["all", "digest-pinned"]);

function parseArgs(argv) {
  const options = {
    mode: "release",
    platform: "linux",
    only: "digest-pinned",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--mode" && next) {
      options.mode = next;
      i += 1;
    } else if (arg === "--platform" && next) {
      options.platform = next;
      i += 1;
    } else if (arg === "--only" && next) {
      options.only = next;
      i += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (!VALID_MODES.has(options.mode)) {
    throw new Error(`--mode must be one of: ${Array.from(VALID_MODES).join(", ")}`);
  }
  if (!VALID_PLATFORMS.has(options.platform)) {
    throw new Error(`--platform must be one of: ${Array.from(VALID_PLATFORMS).join(", ")}`);
  }
  if (!VALID_ONLY.has(options.only)) {
    throw new Error(`--only must be one of: ${Array.from(VALID_ONLY).join(", ")}`);
  }

  return options;
}

function repoRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git rev-parse failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function composeFiles(root, { mode, platform }) {
  const files = [join(root, "docker-compose.yml")];
  if (mode === "release") {
    files.push(join(root, "docker-compose.release.yml"));
  }
  files.push(join(root, `docker-compose.${platform}.yml`));

  for (const file of files) {
    if (!existsSync(file)) {
      throw new Error(`Missing compose file: ${file}`);
    }
  }
  return files;
}

function composeEnv() {
  return {
    ...process.env,
    DPF_HOST_INSTALL_PATH: process.env.DPF_HOST_INSTALL_PATH ?? "/tmp/dpf",
    AUTH_SECRET: process.env.AUTH_SECRET ?? "ci-placeholder",
    CREDENTIAL_ENCRYPTION_KEY:
      process.env.CREDENTIAL_ENCRYPTION_KEY ??
      "0000000000000000000000000000000000000000000000000000000000000000",
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "ci-placeholder",
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "ci-placeholder",
    NEO4J_AUTH: process.env.NEO4J_AUTH ?? "neo4j/ci-placeholder",
    DATABASE_URL:
      process.env.DATABASE_URL ??
      "postgresql://dpf:ci-placeholder@postgres:5432/dpf",
  };
}

function listImages(root, files) {
  const args = ["compose"];
  for (const file of files) {
    args.push("-f", file);
  }
  // Manifest verification must include images behind optional profiles. Runtime
  // activation governs what starts; it must not hide a pinned image from the
  // release supply-chain check.
  args.push("--profile", "*", "config", "--images");

  const result = spawnSync("docker", args, {
    cwd: root,
    env: composeEnv(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`docker compose config --images failed:\n${result.stderr.trim()}`);
  }

  return Array.from(
    new Set(
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ).sort();
}

function verifyManifest(image) {
  const result = spawnSync("docker", ["manifest", "inspect", image], {
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    stderr: result.stderr.trim(),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const files = composeFiles(root, options);
  const renderedImages = listImages(root, files);
  const images =
    options.only === "digest-pinned"
      ? renderedImages.filter((image) => image.includes("@sha256:"))
      : renderedImages;

  if (images.length === 0) {
    throw new Error(`No ${options.only} compose images found for ${options.mode}/${options.platform}.`);
  }

  console.log(
    `[compose-image-manifests] Checking ${images.length} ${options.only} image(s) for ${options.mode}/${options.platform}`,
  );

  const failures = [];
  for (const image of images) {
    const result = verifyManifest(image);
    if (result.ok) {
      console.log(`[ok] ${image}`);
    } else {
      console.error(`[missing] ${image}`);
      if (result.stderr) {
        console.error(result.stderr);
      }
      failures.push(image);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Missing or unreachable image manifests:\n${failures.join("\n")}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
