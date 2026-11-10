// scripts/lib/mermaid-renderer.mjs
//
// One Mermaid renderer for every build-time diagram consumer (doc SVGs, docx
// generators). The renderer is a TOOL, not a workspace dependency: it resolves,
// in order,
//
//   1. MMDC=<path>                  an explicit mermaid-cli JS entry or binary;
//   2. a locally installed          `node_modules/@mermaid-js/mermaid-cli`
//      mermaid-cli                  (a contributor who chose to install it);
//   3. the pinned OCI tool image    `minlag/mermaid-cli` at MERMAID_CLI_IMAGE,
//      through Docker              digest-pinned below.
//
// Dropping mermaid-cli + puppeteer from the workspace removed ~370 lockfile
// resolutions, eight exact override pins and ~200 MB from the portal image
// (BI-DBDB8C6D, plan 2026-09-08 M2). The pin discipline the overrides carried
// ("last policy-vetted diagram stack") now lives in the image digest.
//
// Every consumer stays pure Node in `--check` mode; rendering is the only path
// that needs one of the three strategies, and `availableMermaidRenderer()` lets
// a caller skip loudly instead of crashing when none is present.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Same major.minor as the mermaid line the overrides used to pin (11.16.1).
// Move deliberately: bump the tag AND the digest together, re-render every
// committed SVG, and review the diff — that is the same lockstep the
// Diagram Dependency Pin Guard used to enforce on npm versions.
export const MERMAID_CLI_IMAGE =
  process.env.MERMAID_CLI_IMAGE ||
  "minlag/mermaid-cli:11.16.1@sha256:d98fe54c22e78e65335589fc17d5419f698f915cebca48ea21fee633aff8b258";

function localMermaidCliEntry(dependencyRoot) {
  const direct = path.join(dependencyRoot, "node_modules", "@mermaid-js", "mermaid-cli", "src", "cli.js");
  if (fs.existsSync(direct)) return direct;
  const store = path.join(dependencyRoot, "node_modules", ".pnpm");
  if (fs.existsSync(store)) {
    const dir = fs.readdirSync(store).find((e) => e.startsWith("@mermaid-js+mermaid-cli@"));
    if (dir) {
      const entry = path.join(store, dir, "node_modules", "@mermaid-js", "mermaid-cli", "src", "cli.js");
      if (fs.existsSync(entry)) return entry;
    }
  }
  return null;
}

function dockerAvailable(exec = execFileSync) {
  try {
    exec("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "pipe", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the renderer without side effects.
 * @returns {{kind:"mmdc",entry:string}|{kind:"docker",image:string}|null}
 */
export function availableMermaidRenderer({ dependencyRoot = REPO_ROOT, env = process.env, exec } = {}) {
  if (env.MMDC) return fs.existsSync(env.MMDC) ? { kind: "mmdc", entry: env.MMDC } : null;
  const local = localMermaidCliEntry(dependencyRoot);
  if (local) return { kind: "mmdc", entry: local };
  if (dockerAvailable(exec)) return { kind: "docker", image: MERMAID_CLI_IMAGE };
  return null;
}

export const MERMAID_RENDERER_HINT =
  "\n  Rendering a Mermaid diagram needs one of:" +
  "\n    - Docker (the pinned minlag/mermaid-cli tool image is pulled on first use), or" +
  "\n    - MMDC=/path/to/mermaid-cli/src/cli.js pointing at a local mermaid-cli install." +
  "\n  `--check` modes stay pure Node; only rendering needs a renderer.";

/**
 * Render one Mermaid source file to SVG or PNG.
 *
 * @param {object} opts
 * @param {string} opts.input        absolute path to the .mmd file
 * @param {string} opts.output       absolute path to the .svg/.png to write
 * @param {string} [opts.background] mmdc -b (default "transparent")
 * @param {string} [opts.configFile] mermaid config JSON (mmdc -c)
 * @param {number} [opts.scale]      mmdc -s (PNG only)
 * @param {object} [opts.puppeteerConfig] extra puppeteer launch config
 * @param {object} [opts.renderer]   result of availableMermaidRenderer()
 * @param {Record<string,string>} [opts.env]
 */
export function renderMermaid(opts) {
  const renderer = opts.renderer ?? availableMermaidRenderer({ env: opts.env });
  if (!renderer) throw new Error(`No Mermaid renderer available.${MERMAID_RENDERER_HINT}`);
  const background = opts.background ?? "transparent";
  const timeout = opts.timeout ?? 180_000;
  fs.mkdirSync(path.dirname(opts.output), { recursive: true });

  if (renderer.kind === "mmdc") {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dpf-mmdc-"));
    try {
      const cfgPath = path.join(tmpDir, "puppeteer.json");
      const cfg = { args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"], ...(opts.puppeteerConfig ?? {}) };
      const env = { ...(opts.env ?? process.env) };
      if (env.PUPPETEER_EXECUTABLE_PATH) cfg.executablePath = env.PUPPETEER_EXECUTABLE_PATH;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg));
      const args = ["-i", opts.input, "-o", opts.output, "-b", background, "--puppeteerConfigFile", cfgPath];
      if (opts.configFile) args.push("-c", opts.configFile);
      if (opts.scale) args.push("-s", String(opts.scale));
      // A JS entry runs through the current Node (portable, no shell); anything
      // else is treated as an executable.
      const [cmd, argv] = /\.[cm]?js$/i.test(renderer.entry)
        ? [process.execPath, [renderer.entry, ...args]]
        : [renderer.entry, args];
      execFileSync(cmd, argv, { stdio: ["ignore", "ignore", "inherit"], timeout, env });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    return renderer;
  }

  // Docker: stage input + config in one private temp dir mounted at /data, so
  // the container never sees the repository and host paths never leak into
  // arguments (the image runs mmdc as its entrypoint).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dpf-mermaid-"));
  try {
    const inName = `in${path.extname(opts.input) || ".mmd"}`;
    const outName = `out${path.extname(opts.output) || ".svg"}`;
    fs.copyFileSync(opts.input, path.join(tmpDir, inName));
    const args = ["-i", `/data/${inName}`, "-o", `/data/${outName}`, "-b", background];
    if (opts.configFile) {
      fs.copyFileSync(opts.configFile, path.join(tmpDir, "config.json"));
      args.push("-c", "/data/config.json");
    }
    if (opts.scale) args.push("-s", String(opts.scale));
    const dockerArgs = ["run", "--rm", "--network", "none", "-v", `${tmpDir}:/data`];
    // Keep output files owned by the invoking user on Linux hosts.
    if (typeof process.getuid === "function") dockerArgs.push("-u", `${process.getuid()}:${process.getgid()}`);
    dockerArgs.push(renderer.image, ...args);
    execFileSync("docker", dockerArgs, { stdio: ["ignore", "ignore", "inherit"], timeout });
    const produced = path.join(tmpDir, outName);
    if (!fs.existsSync(produced)) throw new Error(`mermaid tool image produced no ${outName}`);
    fs.copyFileSync(produced, opts.output);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return renderer;
}
