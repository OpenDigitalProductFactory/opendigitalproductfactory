import { installWorkroomArtifact } from "../_shared/install-workroom-artifact.mjs";
import { readRegularFile } from "../_shared/read-regular-file.mjs";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const manifest = JSON.parse(await readFile(join(here, "closure.json"), "utf8"));
const require = createRequire(import.meta.url);
const node = process.env.GPP_TOOLKIT_NODE24 ?? process.execPath;
const compiler = resolve(root, "node_modules/typescript/bin/tsc");
const compilerPackage = JSON.parse(await readFile(resolve(root, "node_modules/typescript/package.json"), "utf8"));
const version = spawnSync(node, ["--version"], { encoding: "utf8" });
if (version.status !== 0 || version.stdout.trim() !== `v${manifest.toolchain.node}`) throw new Error(`Expected Node ${manifest.toolchain.node}; received ${version.stdout || version.stderr}`);
if (compilerPackage.version !== manifest.toolchain.typescript) throw new Error(`Expected TypeScript ${manifest.toolchain.typescript}; received ${compilerPackage.version}`);
const ts = require(resolve(root, "node_modules/typescript/lib/typescript.js"));
const temp = await mkdtemp(join(tmpdir(), "dpf-gpp-consumer-"));
const sourceDigests = {}, distributions = [];
const digest = (value) => createHash("sha256").update(value).digest("hex");
const env = { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// Inspect syntax, not generated-module strings or comments that happen to say `from`.
function moduleImports(contents, filename) {
  const imports = [];
  const source = ts.createSourceFile(filename, contents, ts.ScriptTarget.Latest, true);
  function walk(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error(`Nonliteral module specifier: ${filename}`);
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) throw new Error(`Nonliteral dynamic import: ${filename}`);
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
  return imports;
}

async function regularFiles(directory, prefix = "") {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => compare(a.name, b.name))) {
    const local = join(directory, entry.name), name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stat = await lstat(local);
    if (stat.isSymbolicLink()) throw new Error(`Dependency/fixture links are not permitted: ${name}`);
    if (stat.isDirectory()) result.push(...await regularFiles(local, name));
    else if (stat.isFile()) result.push({ name, path: local });
    else throw new Error(`Unsupported distribution entry: ${name}`);
  }
  return result;
}
async function distribution(name, expectedVersion, role) {
  const packagePath = require.resolve(`${name}/package.json`, { paths: [root] });
  const directory = await realpath(dirname(packagePath));
  const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  if (pkg.version !== expectedVersion) throw new Error(`Expected ${name}@${expectedVersion}; received ${pkg.version}`);
  const files = await regularFiles(directory);
  const identity = [];
  for (const file of files) identity.push(`${file.name}\0${digest(await readRegularFile(file.path))}`);
  distributions.push({ name, version: pkg.version, license: pkg.license, role, files: files.length, distributionSha256: digest(identity.join("\n")) });
  return directory;
}
function child(args, label) {
  const result = spawnSync(node, args, { cwd: temp, env, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${label} failed:\n${result.stdout}${result.stderr}${result.error ?? ""}`);
  return result.stdout;
}
async function runtimeDependencies(outDir, zodDirectory) {
  await mkdir(join(temp, outDir, "node_modules/@dpf/integration-shared"), { recursive: true });
  await cp(zodDirectory, join(temp, outDir, "node_modules/zod"), { recursive: true, dereference: false });
  await writeFile(join(temp, outDir, "node_modules/@dpf/integration-shared/package.json"), JSON.stringify({
    name: "@dpf/integration-shared", version: "0.0.1", type: "module", private: true, license: "Apache-2.0",
    exports: { "./canonical-json": { types: "./canonical-json.d.ts", default: "./canonical-json.js" } },
  }, null, 2));
  for (const name of ["LICENSE", "NOTICE"]) await cp(join(root, name), join(temp, outDir, "node_modules/@dpf/integration-shared", name));
}

try {
  const workroomArtifact = await installWorkroomArtifact({ root, destination: temp, artifact: manifest.componentArtifact, node });
  for (const name of ["LICENSE", "NOTICE"]) await cp(join(here, name), join(temp, name));
  const dependencies = { zod: manifest.dependencies.zod, "@dpf/integration-shared": "0.0.1" };
  await writeFile(join(temp, "package.json"), JSON.stringify({ name: "gpp-toolkit-isolated-consumer", version: "0.0.0", private: true, type: "module", dependencies,
    devDependencies: { "@types/node": manifest.dependencies.nodeTypes, "undici-types": manifest.dependencies.undiciTypes } }, null, 2));
  await writeFile(join(temp, "package-lock.json"), JSON.stringify({ name: "gpp-toolkit-isolated-consumer", version: "0.0.0", lockfileVersion: 3, requires: true,
    packages: { "": { name: "gpp-toolkit-isolated-consumer", version: "0.0.0", dependencies },
      "node_modules/zod": { version: manifest.dependencies.zod, license: "MIT" },
      "node_modules/@dpf/integration-shared": { version: "0.0.1", license: "Apache-2.0" },
      "node_modules/@types/node": { version: manifest.dependencies.nodeTypes, dev: true, license: "MIT" },
      "node_modules/undici-types": { version: manifest.dependencies.undiciTypes, dev: true, license: "MIT" } } }, null, 2));
  await regularFiles(join(here, "src"));
  for (const name of ["LICENSE", "NOTICE"]) await cp(join(here, name), join(temp, name));
  await cp(join(here, "src"), join(temp, "src"), { recursive: true, dereference: false });
  for (const name of ["tsconfig.browser.json", "tsconfig.node.json"]) await cp(join(here, name), join(temp, name));
  const sourceByTarget = new Map();
  for (const source of manifest.sources) {
    const path = resolve(root, source), base = resolve(root, "packages/validators/src");
    if (!path.startsWith(base + sep)) throw new Error(`Invalid regular closure source: ${source}`);
    const contents = await readRegularFile(path, "utf8"); sourceDigests[source] = digest(contents);
    for (const specifier of moduleImports(contents, source)) {
      if (!workroomArtifact.acceptsImport(specifier) && specifier !== "zod" && specifier !== "@dpf/integration-shared/canonical-json" && specifier !== "node:crypto"
        && (!specifier.startsWith(".") || !specifier.endsWith(".ts"))) throw new Error(`Nonportable import in ${source}: ${specifier}`);
    }
    const target = resolve(temp, "kernel", relative(base, path));
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, contents); sourceByTarget.set(target, contents);
  }
  const canonicalPath = resolve(root, manifest.canonicalJsonSource);
  const canonical = await readRegularFile(canonicalPath, "utf8"); sourceDigests[manifest.canonicalJsonSource] = digest(canonical);
  if (moduleImports(canonical, manifest.canonicalJsonSource).length !== 0) throw new Error("The canonical JSON leaf gained an undeclared dependency.");
  const canonicalDirectory = join(temp, "node_modules/@dpf/integration-shared");
  await mkdir(canonicalDirectory, { recursive: true }); await writeFile(join(canonicalDirectory, "canonical-json.ts"), canonical);
  await writeFile(join(canonicalDirectory, "package.json"), JSON.stringify({ name: "@dpf/integration-shared", version: "0.0.1", type: "module", private: true, license: "Apache-2.0",
    exports: { "./canonical-json": { types: "./canonical-json.ts", default: "./canonical-json.js" } } }, null, 2));
  for (const name of ["LICENSE", "NOTICE"]) await cp(join(root, name), join(canonicalDirectory, name));
  const zodDirectory = await distribution("zod", manifest.dependencies.zod, "only third-party runtime dependency");
  const nodeTypesDirectory = await distribution("@types/node", manifest.dependencies.nodeTypes, "Node compiler declarations only");
  const undiciTypesDirectory = await distribution("undici-types", manifest.dependencies.undiciTypes, "@types/node declaration dependency only; not undici runtime");
  await mkdir(join(temp, "node_modules/@types"), { recursive: true });
  for (const [directory, target] of [[zodDirectory, "zod"], [nodeTypesDirectory, "@types/node"], [undiciTypesDirectory, "undici-types"]])
    await cp(directory, join(temp, "node_modules", target), { recursive: true, dereference: false });

  // Traverse the declared browser entry independently, so Node-only imports cannot hide in its re-exports.
  const seen = new Set();
  function browserClosure(path) {
    if (seen.has(path)) return; seen.add(path);
    const contents = sourceByTarget.get(path); if (contents === undefined) throw new Error(`Browser closure omitted source: ${path}`);
    for (const specifier of moduleImports(contents, path)) {
      if (specifier.startsWith("node:")) throw new Error(`Browser entry reaches Node builtin: ${specifier}`);
      if (workroomArtifact.acceptsImport(specifier) || specifier === "zod" || specifier === "@dpf/integration-shared/canonical-json") continue;
      browserClosure(resolve(dirname(path), specifier));
    }
  }
  browserClosure(resolve(temp, manifest.browserEntry));
  child([compiler, "--project", join(temp, "tsconfig.browser.json")], "Browser ES2022+DOM/types[] compilation");
  await runtimeDependencies("browser-dist", zodDirectory);
  const browser = JSON.parse(child(["--input-type=module", "--eval", `const {runBrowserSmoke}=await import(${JSON.stringify(pathToFileURL(join(temp, "browser-dist/src/browser-smoke.js")).href)}); console.log(JSON.stringify(await runBrowserSmoke()));`], "Browser-entry contract smoke under Node"));
  child([compiler, "--project", join(temp, "tsconfig.node.json")], "Node compiler NodeNext compilation");
  await runtimeDependencies("dist", zodDirectory);
  const result = JSON.parse(child(["--input-type=module", "--eval", `const {runNodeSmoke}=await import(${JSON.stringify(pathToFileURL(join(temp, "dist/src/node-smoke.js")).href)}); console.log(JSON.stringify(await runNodeSmoke()));`], "Node compiler behavioral smoke"));
  const generatedSource = join(temp, "src/generated.ts"); await writeFile(generatedSource, result.generatedModule);
  child([compiler, "--project", join(temp, "tsconfig.node.json")], "Actual generated TypeScript module compilation");
  child(["--input-type=module", "--eval", `const {SYNTHETIC_READ_1_2_3}=await import(${JSON.stringify(pathToFileURL(join(temp, "dist/src/generated.js")).href)}); if(SYNTHETIC_READ_1_2_3.key!=="synthetic-read"||SYNTHETIC_READ_1_2_3.version!=="1.2.3")throw Error("wrong generated definition");`], "Actual emitted generated module import");
  delete result.generatedModule;
  process.stdout.write(JSON.stringify({ browser: { sourceFiles: seen.size, compilation: "ES2022+DOM/types[]; no Node builtin imports", execution: "contract smoke under Node, not real browser/CSP acceptance", passed: browser },
    nodeCompiler: { ...result, generatedModule: "TypeScript compiled and emitted JavaScript imported" },
    toolchain: { node: version.stdout.trim(), typescript: compilerPackage.version }, distributions, workroomArtifact: workroomArtifact.evidence,
    canonicalJson: "one copied exact source; parent package undici runtime is neither copied nor evaluated", copiedSourceSha256: sourceDigests }, null, 2) + "\n");
} finally {
  await rm(temp, { recursive: true, force: true });
}
