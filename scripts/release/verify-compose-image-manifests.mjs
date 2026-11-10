#!/usr/bin/env node
import { parseArgs as utilParseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { runGit } from "../lib/git.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VALID_MODES = new Set(["dev", "release"]);
const VALID_PLATFORMS = new Set(["linux", "macos"]);
const VALID_ONLY = new Set(["all", "digest-pinned", "third-party"]);

/**
 * Third-party images known NOT to resolve today, each naming the backlog item that
 * re-pins it. Shrink-only: an entry that resolves again, or that compose no longer
 * renders, fails the guard until it is removed, so an exception cannot outlive its pin.
 */
export const KNOWN_UNRESOLVABLE = new Map([
  // Empty. BI-E2763038 re-pinned dpf-tts (travisvn/chatterbox-tts-api:v0.1.0 was
  // deleted upstream) to a published tag, which retired the only entry.
]);

/**
 * An image some other publisher controls, so it can disappear under us: anything
 * that is not built by this repository. Images this repo builds are either local-only
 * names (no registry, no tag, e.g. dpf-dev-portal) or the release's own
 * ghcr.io/<owner>/dpf-* images, which publish-image.yml verifies itself.
 */
export function isThirdPartyImage(image) {
  if (/^ghcr\.io\/[^/]+\/dpf-[^/]+$/.test(image.replace(/[:@].*$/, ""))) return false;
  return image.includes(":") || image.includes("@");
}

export function selectImages(renderedImages, only) {
  if (only === "digest-pinned") return renderedImages.filter((image) => image.includes("@sha256:"));
  if (only === "third-party") return renderedImages.filter(isThirdPartyImage);
  return renderedImages;
}

/** Split manifest results into hard failures, tolerated known exceptions and stale exceptions. */
export function evaluateManifestResults(results, known = KNOWN_UNRESOLVABLE) {
  const failures = [];
  const knownMissing = [];
  const staleExceptions = [];
  const checked = new Set();
  for (const { image, ok } of results) {
    checked.add(image);
    if (known.has(image)) {
      if (ok) staleExceptions.push(image);
      else knownMissing.push({ image, item: known.get(image) });
    } else if (!ok) {
      failures.push(image);
    }
  }
  for (const image of known.keys()) {
    if (!checked.has(image)) staleExceptions.push(image);
  }
  return { failures, knownMissing, staleExceptions };
}

function parseArgs(argv) {
  const { values } = utilParseArgs({
    args: argv,
    options: { mode: { type: "string" }, platform: { type: "string" }, only: { type: "string" } },
  });
  const empty = Object.keys(values).find((name) => !values[name]);
  if (empty) throw new Error(`Unknown or incomplete argument: --${empty}`);
  const options = {
    mode: values.mode ?? "release",
    platform: values.platform ?? "linux",
    only: values.only ?? "digest-pinned",
  };

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
  const result = runGit(["rev-parse", "--show-toplevel"], { cwd: process.cwd() });
  if (!result.ok) {
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
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY ?? "1".repeat(64),
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY ?? "2".repeat(64),
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "ci-placeholder",
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "ci-placeholder",
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
  const images = selectImages(renderedImages, options.only);

  // An empty RENDERED set means compose rendering broke — still a failure.
  if (renderedImages.length === 0) {
    throw new Error(`No compose images rendered for ${options.mode}/${options.platform}.`);
  }

  // An empty selection is legitimate for digest-pinned: DPF ships no digest-pinned
  // third-party image any more (BI-F7E9A541). That is exactly why CI now runs
  // third-party, which also covers tag pins (BI-DB87D925).
  if (images.length === 0) {
    console.log(
      `[compose-image-manifests] No ${options.only} images for ${options.mode}/${options.platform} — nothing to verify. `
        + `${renderedImages.length} image(s) rendered.`,
    );
    return;
  }

  console.log(
    `[compose-image-manifests] Checking ${images.length} ${options.only} image(s) for ${options.mode}/${options.platform}`,
  );

  const results = images.map((image) => {
    const result = verifyManifest(image);
    if (result.ok) console.log(`[ok] ${image}`);
    else {
      console.error(`[missing] ${image}`);
      if (result.stderr) console.error(result.stderr);
    }
    return { image, ok: result.ok };
  });

  // Exceptions only apply when the whole third-party set was checked; a narrower
  // selection simply does not render them.
  const known = options.only === "digest-pinned" ? new Map() : KNOWN_UNRESOLVABLE;
  const { failures, knownMissing, staleExceptions } = evaluateManifestResults(results, known);
  for (const { image, item } of knownMissing) {
    console.warn(`[known-missing] ${image} — tolerated until ${item} re-pins it`);
  }

  const problems = [];
  if (failures.length > 0) {
    problems.push(`Missing or unreachable image manifests:\n${failures.join("\n")}`);
  }
  if (staleExceptions.length > 0) {
    problems.push(
      `KNOWN_UNRESOLVABLE entries that now resolve or are no longer rendered — remove them:\n${staleExceptions.join("\n")}`,
    );
  }
  if (problems.length > 0) throw new Error(problems.join("\n\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
