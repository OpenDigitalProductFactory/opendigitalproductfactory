import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const manifest = JSON.parse(await readFile(join(here, "source-manifest.json"), "utf8"));
const node = process.env.OPERATING_COMPOSITION_NODE24 ?? process.execPath;
const compiler = resolve(root, "node_modules/typescript/bin/tsc");
const compilerPackage = JSON.parse(await readFile(resolve(root, "node_modules/typescript/package.json"), "utf8"));
const version = spawnSync(node, ["--version"], { encoding: "utf8" });
if (version.status !== 0 || version.stdout.trim() !== `v${manifest.toolchain.node}`) throw new Error(`Expected Node ${manifest.toolchain.node}; received ${version.stdout || version.stderr}`);
if (compilerPackage.version !== manifest.toolchain.typescript) throw new Error(`Expected TypeScript ${manifest.toolchain.typescript}; received ${compilerPackage.version}`);
const ts = createRequire(import.meta.url)(resolve(root, "node_modules/typescript/lib/typescript.js"));
const hash = text => createHash("sha256").update(text).digest("hex");
const temp = await mkdtemp(join(tmpdir(), "dpf-operating-composition-"));
const sourceDigests = {};
const env = { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" };
function imports(text, name) {
  const result = [], source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  function walk(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error(`Nonliteral import in ${name}`);
      result.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) throw new Error(`Undeclared dynamic import in ${name}`);
    ts.forEachChild(node, walk);
  }
  walk(source); return result;
}
async function regularTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`No fixture dependency links permitted: ${path}`);
    if (stat.isDirectory()) await regularTree(path);
    else if (!stat.isFile()) throw new Error(`Expected regular source: ${path}`);
  }
}
function child(args, label) {
  const run = spawnSync(node, args, { cwd: temp, env, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`${label}:\n${run.stdout}${run.stderr}${run.error ?? ""}`);
  return run.stdout;
}
try {
  for (const name of ["package.json", "package-lock.json", "tsconfig.json", "LICENSE", "NOTICE"]) await cp(join(here, name), join(temp, name));
  await regularTree(join(here, "src"));
  await cp(join(here, "src"), join(temp, "src"), { recursive: true, dereference: false });
  const targets = new Map();
  for (const source of manifest.sources) {
    const base = resolve(root, "packages/validators/src"), path = resolve(root, source);
    if (!path.startsWith(base + sep) || !(await lstat(path)).isFile()) throw new Error(`Invalid regular closure source: ${source}`);
    const text = await readFile(path, "utf8"); sourceDigests[source] = hash(text);
    const target = resolve(temp, "kernel", relative(base, path)); targets.set(target, text);
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, text);
  }
  for (const [target, text] of targets) for (const specifier of imports(text, target)) {
    if (specifier === "@dpf/integration-shared/canonical-json") continue;
    if (!specifier.startsWith(".") || !specifier.endsWith(".js") || !targets.has(resolve(dirname(target), specifier.replace(/\.js$/, ".ts"))))
      throw new Error(`Import escapes the exact source closure: ${target}: ${specifier}`);
  }
  const canonicalPath = resolve(root, manifest.canonicalJsonSource);
  if (!(await lstat(canonicalPath)).isFile()) throw new Error("Canonical JSON must be a regular file");
  const canonical = await readFile(canonicalPath, "utf8"); sourceDigests[manifest.canonicalJsonSource] = hash(canonical);
  if (imports(canonical, canonicalPath).length) throw new Error("Canonical JSON leaf gained an undeclared dependency");
  const packagePath = join(temp, "node_modules/@dpf/integration-shared");
  await mkdir(packagePath, { recursive: true });
  await writeFile(join(packagePath, "canonical-json.ts"), canonical);
  const localPackage = { name: "@dpf/integration-shared", version: "0.0.1", private: true, type: "module", license: "Apache-2.0",
    exports: { "./canonical-json": { types: "./canonical-json.ts", default: "./canonical-json.js" } } };
  await writeFile(join(packagePath, "package.json"), JSON.stringify(localPackage, null, 2));
  for (const name of ["LICENSE", "NOTICE"]) await cp(join(root, name), join(packagePath, name));
  child([compiler, "--project", join(temp, "tsconfig.json")], "Isolated NodeNext/types[] compilation failed");
  const runtimePackage = join(temp, "dist/node_modules/@dpf/integration-shared");
  await mkdir(runtimePackage, { recursive: true });
  await writeFile(join(runtimePackage, "package.json"), JSON.stringify({ ...localPackage,
    exports: { "./canonical-json": { types: "./canonical-json.d.ts", default: "./canonical-json.js" } } }, null, 2));
  for (const name of ["LICENSE", "NOTICE"]) await cp(join(root, name), join(runtimePackage, name));
  const result = JSON.parse(child(["--input-type=module", "--eval", `import {createHash} from 'node:crypto'; const {runSmoke}=await import(${JSON.stringify(pathToFileURL(join(temp, "dist/src/consumer.test.js")).href)}); console.log(JSON.stringify(await runSmoke(s=>createHash('sha256').update(s).digest('hex'))));`], "Isolated behavioral consumer failed"));
  process.stdout.write(JSON.stringify({ ...result, toolchain: { node: version.stdout.trim(), typescript: compilerPackage.version },
    compilation: "ES2022 NodeNext types=[]; no app paths, ambient Node declarations or dependency links",
    thirdPartyRuntimeDependencies: [], internalRuntimeLeaf: manifest.canonicalJsonSource,
    qualification: manifest.qualification, copiedSourceSha256: sourceDigests }, null, 2) + "\n");
} finally { await rm(temp, { recursive: true, force: true }); }
