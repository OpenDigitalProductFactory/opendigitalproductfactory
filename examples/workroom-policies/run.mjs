import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const manifest = JSON.parse(await readFile(join(here, "closure.json"), "utf8"));
const node = process.env.WORKROOM_POLICIES_NODE24 ?? process.execPath;
const compiler = resolve(root, "node_modules/typescript/bin/tsc");
const compilerPackage = JSON.parse(await readFile(resolve(root, "node_modules/typescript/package.json"), "utf8"));
const version = spawnSync(node, ["--version"], { encoding: "utf8" });
if (version.status !== 0 || version.stdout.trim() !== `v${manifest.toolchain.node}`)
  throw new Error(`Expected Node ${manifest.toolchain.node}; received ${version.stdout || version.error || version.stderr}`);
if (compilerPackage.version !== manifest.toolchain.typescript)
  throw new Error(`Expected TypeScript ${manifest.toolchain.typescript}; received ${compilerPackage.version}`);
const ts = createRequire(import.meta.url)(resolve(root, "node_modules/typescript/lib/typescript.js"));
const temp = await mkdtemp(join(tmpdir(), "dpf-workroom-policies-consumer-"));
const sourceDigests = {}, fixtureDigests = {};
const digest = value => createHash("sha256").update(value).digest("hex");
const env = { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" };

function importsOf(contents, filename) {
  const imports = [];
  const source = ts.createSourceFile(filename, contents, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error(`Nonliteral import in ${filename}`);
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) throw new Error(`Dynamic import in ${filename}`);
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports;
}
async function regularTree(directory) {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name), stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Source links are not permitted: ${path}`);
    if (stat.isDirectory()) files.push(...await regularTree(path));
    else if (stat.isFile()) files.push(path);
    else throw new Error(`Unsupported fixture entry: ${path}`);
  }
  return files;
}
function child(args, label) {
  const result = spawnSync(node, args, { cwd: temp, env, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${label} failed:\n${result.stdout}${result.stderr}${result.error ?? ""}`);
  return result.stdout;
}
try {
  const packageName = "workroom-policies-isolated-consumer";
  await writeFile(join(temp, "package.json"), JSON.stringify({ name: packageName, version: "0.0.0", private: true, type: "module", dependencies: {} }, null, 2));
  await writeFile(join(temp, "package-lock.json"), JSON.stringify({ name: packageName, version: "0.0.0", lockfileVersion: 3, requires: true,
    packages: { "": { name: packageName, version: "0.0.0", dependencies: {} } } }, null, 2));
  for (const path of await regularTree(join(here, "src"))) fixtureDigests[relative(here, path)] = digest(await readFile(path));
  await cp(join(here, "src"), join(temp, "src"), { recursive: true, dereference: false });
  for (const name of ["tsconfig.json", "LICENSE", "NOTICE"]) await cp(join(here, name), join(temp, name));
  const sources = new Map();
  for (const source of manifest.sources) {
    const path = resolve(root, source), base = resolve(root, "packages/validators/src");
    if (!path.startsWith(base + sep) || !(await lstat(path)).isFile()) throw new Error(`Invalid closure source: ${source}`);
    const contents = await readFile(path, "utf8");
    sourceDigests[source] = digest(contents);
    for (const specifier of importsOf(contents, source))
      if (!specifier.startsWith(".") || !specifier.endsWith(".ts")) throw new Error(`Nonportable import in ${source}: ${specifier}`);
    const target = resolve(temp, "kernel", relative(base, path));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
    sources.set(target, contents);
  }
  const seen = new Set();
  function closure(path) {
    if (seen.has(path)) return;
    seen.add(path);
    const contents = sources.get(path);
    if (contents === undefined) throw new Error(`Manifest omitted source: ${path}`);
    for (const specifier of importsOf(contents, path)) closure(resolve(dirname(path), specifier));
  }
  closure(resolve(temp, manifest.entry));
  closure(resolve(temp, "kernel/workroom/index.ts"));
  child([compiler, "--project", join(temp, "tsconfig.json")], "Standalone ES2022/types[] NodeNext compilation");
  const result = JSON.parse(child(["--input-type=module", "--eval",
    `const {runSmoke}=await import(${JSON.stringify(pathToFileURL(join(temp, "dist/src/smoke.js")).href)}); console.log(JSON.stringify(runSmoke()));`], "Standalone synthetic policy smoke"));
  process.stdout.write(JSON.stringify({ ...result, toolchain: { node: version.stdout.trim(), typescript: compilerPackage.version },
    sourceBaseline: manifest.sourceBaseline, runtimeDependencies: [], sourceFiles: sources.size, reachableSourceFiles: seen.size,
    copiedSourceSha256: sourceDigests, fixtureSourceSha256: fixtureDigests }, null, 2) + "\n");
} finally {
  await rm(temp, { recursive: true, force: true });
}
