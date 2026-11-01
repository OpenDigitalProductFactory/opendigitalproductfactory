import assert from "node:assert/strict";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { readRegularFile } from "./read-regular-file.mjs";

const PACKAGE = "@opendigitalproductfactory/dpf-workroom";

/** Install the pinned first-party artifact without inheriting the fixture's fake host packages. */
export async function installWorkroomArtifact({ root, destination, artifact, node = process.execPath }) {
  assert.equal(artifact?.name, PACKAGE, "Only the reviewed Workroom dependency is admitted");
  assert(typeof artifact.path === "string" && !isAbsolute(artifact.path)
    && artifact.path.startsWith("packages/validators/vendor/") && artifact.path.endsWith(".tgz")
    && !artifact.path.split(/[\\/]/).includes(".."), "Use the declared repository artifact");
  const archive = resolve(await realpath(root), artifact.path);
  assert.equal(await realpath(archive), archive, "Artifact paths cannot redirect outside this checkout");
  const bytes = await readRegularFile(archive);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256, "Artifact integrity changed");

  // Execute npm's JavaScript CLI directly, including on Windows; no shell quoting or .cmd dispatch.
  const candidates = [
    isAbsolute(node) ? resolve(dirname(node), "../lib/node_modules/npm/bin/npm-cli.js") : null,
    isAbsolute(node) ? resolve(dirname(node), "node_modules/npm/bin/npm-cli.js") : null,
    process.env.npm_execpath?.endsWith("npm-cli.js") ? process.env.npm_execpath : null,
  ].filter(Boolean);
  let npmCli;
  for (const path of candidates) if ((await lstat(path).catch(() => null))?.isFile()) { npmCli = path; break; }
  assert(npmCli, "Install qualification requires the npm CLI bundled with Node");
  const transport = await mkdtemp(join(tmpdir(), "workroom-artifact-install-"));
  try {
    // Install the verified buffer, never reread a repository pathname another
    // writer can replace after hashing it.
    const snapshot = join(transport, "verified-workroom.tgz");
    await writeFile(snapshot, bytes, { flag: "wx", mode: 0o600 });
    const userConfig = join(transport, "user.npmrc"), globalConfig = join(transport, "global.npmrc");
    await writeFile(userConfig, "", { flag: "wx", mode: 0o600 });
    await writeFile(globalConfig, "", { flag: "wx", mode: 0o600 });
    await writeFile(join(transport, "package.json"), JSON.stringify({ private: true, type: "module" }));
    // Inherited npm global/location/prefix settings must not redirect writes.
    // Keep configuration, cache and logs inside this owned temporary package too.
    const install = spawnSync(node, [npmCli, "install", "--offline", "--engine-strict", "--ignore-scripts",
      "--global=false", "--location=project", "--prefix", transport,
      "--userconfig", userConfig, "--globalconfig", globalConfig,
      "--cache", join(transport, "npm-cache"), "--logs-dir", join(transport, "npm-logs"), "--update-notifier=false",
      "--no-audit", "--no-fund", "--package-lock=false", snapshot], {
      cwd: transport, env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "", NPM_CONFIG_UPDATE_NOTIFIER: "false" }, encoding: "utf8",
    });
    assert.equal(install.status, 0, `Exact artifact installation failed:\n${install.stdout}${install.stderr}`);
    const installed = join(transport, "node_modules", ...PACKAGE.split("/"));
    const metadata = JSON.parse(await readRegularFile(join(installed, "package.json"), "utf8"));
    assert.equal(metadata.name, artifact.name); assert.equal(metadata.version, artifact.version);
    assert.deepEqual(metadata.dependencies, {}, "No undeclared transitive host/runtime dependency");
    async function inspect(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        assert(!entry.isSymbolicLink(), "The installed distribution cannot contain source links");
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await inspect(path);
        else {
          assert(entry.isFile(), "Expected a regular distribution file");
          if (/\.(?:js|ts)$/.test(path)) {
            const text = await readFile(path, "utf8");
            for (const match of text.matchAll(/(?:from\s*|import\s*\()(["'])([^"']+)\1/g)) {
              assert(match[2].startsWith(".") && match[2].endsWith(".js"), "Only emitted relative imports belong to this foundation");
              const target = resolve(dirname(path), match[2]);
              assert(!relative(installed, target).startsWith(".."), "Dependency escapes the installed package");
              assert((await lstat(target)).isFile(), "Emitted dependency is missing");
            }
          }
        }
      }
    }
    await inspect(installed);
    const target = join(destination, "node_modules", ...PACKAGE.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await cp(installed, target, { recursive: true, dereference: false, force: false, errorOnExist: true });
    const imports = new Set(Object.keys(metadata.exports).map(key => PACKAGE + (key === "." ? "" : key.slice(1))));
    return { acceptsImport: specifier => imports.has(specifier), evidence: {
      name: metadata.name, version: metadata.version, sha256: artifact.sha256,
      installation: "engine-strict exact tarball; no source aliases", emittedClosure: "verified",
    } };
  } finally {
    await rm(transport, { recursive: true, force: true });
  }
}
