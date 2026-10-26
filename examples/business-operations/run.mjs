import { mkdtemp, mkdir, readFile, writeFile, cp, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const manifest = JSON.parse(await readFile(join(here, "closure.json"), "utf8"));
const node = process.env.BUSINESS_OPERATIONS_NODE24 ?? process.execPath;
const compiler = resolve(root, "node_modules/typescript/bin/tsc");
const compilerPackage = JSON.parse(await readFile(resolve(root, "node_modules/typescript/package.json"), "utf8"));
const version = spawnSync(node, ["--version"], { encoding: "utf8" });
if (version.status !== 0 || version.stdout.trim() !== `v${manifest.toolchain.node}`) throw new Error(`Expected Node ${manifest.toolchain.node}; received ${version.stdout || version.error || version.stderr}`);
if (compilerPackage.version !== manifest.toolchain.typescript) throw new Error(`Expected TypeScript ${manifest.toolchain.typescript}; received ${compilerPackage.version}`);
const temp = await mkdtemp(join(tmpdir(), "dpf-business-operations-consumer-"));
const sourceDigests = {};
try {
  await writeFile(join(temp, "package.json"), JSON.stringify({ name: "business-operations-isolated-consumer", private: true, type: "module", version: "0.0.0", dependencies: {} }, null, 2));
  await writeFile(join(temp, "package-lock.json"), JSON.stringify({ name: "business-operations-isolated-consumer", version: "0.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "business-operations-isolated-consumer", version: "0.0.0" } } }, null, 2));
  await cp(join(here, "src"), join(temp, "src"), { recursive: true, dereference: false });
  await cp(join(here, "tsconfig.json"), join(temp, "tsconfig.json"));
  for (const name of ["LICENSE", "NOTICE"]) await cp(join(here, name), join(temp, name));
  for (const source of manifest.sources) {
      const path = resolve(root, source);
      if (!(await lstat(path)).isFile()) throw new Error(`Closure source must be a regular file: ${source}`);
      const contents = await readFile(path, "utf8");
      sourceDigests[source] = createHash("sha256").update(contents).digest("hex");
      for (const match of contents.matchAll(/(?:from\s*|import\s*\()(["'])([^"']+)\1/g)) {
        if (!match[2].startsWith(".") || !match[2].endsWith(".ts")) throw new Error(`Nonportable import in ${source}: ${match[2]}`);
      }
      const target = resolve(temp, "kernel", relative(resolve(root, "packages/storefront-templates/src/operations"), path));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents);
  }
  const build = spawnSync(node, [compiler, "--project", join(temp, "tsconfig.json")], { cwd: temp, encoding: "utf8", env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" } });
  if (build.status !== 0) throw new Error(`Standalone NodeNext compilation failed:\n${build.stdout}${build.stderr}`);
  const run = spawnSync(node, ["--input-type=module", "--eval", `const {runSmoke}=await import(${JSON.stringify(pathToFileURL(join(temp, "dist/src/smoke.js")).href)}); console.log(JSON.stringify(runSmoke(),null,2));`], { cwd: temp, encoding: "utf8", env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" } });
  if (run.status !== 0) throw new Error(`Standalone behavioral smoke failed:\n${run.stdout}${run.stderr}`);
  process.stdout.write(run.stdout);
  process.stdout.write(`${JSON.stringify({ node: version.stdout.trim(), typescript: compilerPackage.version, runtimeDependencies: [], copiedSourceSha256: sourceDigests }, null, 2)}\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
