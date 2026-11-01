import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { findMissingWorkspaceContext, checkEdgeWorkspaceContext, findMissingFileContext, checkFileDependencyContext } from "./check-docker-workspace-context.mjs";
import { collectProdRoots, collectWorkspaceClosure } from "./sbom/runtime-surface.mjs";
const graph = {
  "services/app": { prod: [{name:"a", value:"link:../../packages/a"}], dev: [] },
  "packages/a": { prod: [{name:"b", value:"link:../b"}, {name:"registry",value:"1.0.0"}], dev: [] },
  "packages/b": { prod: [], dev: [] },
};
const prefix = "FROM node AS build\nWORKDIR /app\nCOPY services/app/package.json ./services/app/\nCOPY packages/a ./packages/a\n";
const install = "RUN pnpm install --filter app... --frozen-lockfile\n";
const complete = prefix + "COPY packages/b ./packages/b\n" + install;
test("missing transitive workspace is named", () => {
  assert.deepEqual(findMissingWorkspaceContext(prefix + install, graph, ["services/app"]), ["stage build requires workspace packages/b before pnpm install"]);
});
test("complete context satisfies closure", () => assert.deepEqual(findMissingWorkspaceContext(complete, graph, ["services/app"]), []));
test("late COPY cannot repair an earlier install", () => assert.equal(findMissingWorkspaceContext(prefix + install + "COPY packages/b ./packages/b\n", graph, ["services/app"]).length, 1));
test("inherited context is usable", () => assert.deepEqual(findMissingWorkspaceContext(complete.replace(install, "FROM build AS next\n" + install), graph, ["services/app"]), []));
test("wrong destination does not provide package", () => assert.equal(findMissingWorkspaceContext(complete.replace("./packages/b", "./wrong"), graph, ["services/app"]).length, 1));
test("dockerignore remains binding", () => assert.equal(findMissingWorkspaceContext(complete, graph, ["services/app"], "packages/b").length, 1));
test("root COPY covers workspace paths", () => assert.deepEqual(findMissingWorkspaceContext("FROM node AS build\nWORKDIR /app\nCOPY . .\n" + install, graph, ["services/app"]), []));
test("cycles terminate and production roots remain stable", () => {
  const cycle = structuredClone(graph);
  cycle["packages/b"].prod.push({name:"a",value:"link:../a"});
  assert.deepEqual([...collectWorkspaceClosure(cycle,["services/app"])], ["services/app","packages/a","packages/b"]);
  assert.deepEqual([...collectProdRoots(cycle,["services/app"])], ["registry@1.0.0"]);
});
test("missing importer refuses rather than truncating closure", () => {
  const missing = structuredClone(graph); delete missing["packages/b"];
  assert.throws(() => collectWorkspaceClosure(missing,["services/app"]), /Missing workspace importer/);
});
test("development workspace links belong to install closure", () => {
  const dev = structuredClone(graph); dev["packages/a"].dev.push({name:"dev",value:"link:../dev"});
  dev["packages/dev"] = {prod:[],dev:[]};
  assert.ok(collectWorkspaceClosure(dev,["services/app"]).has("packages/dev"));
});
test("real Edge Dockerfile includes current dependency closure before install", () => {
  const result = checkEdgeWorkspaceContext(fileURLToPath(new URL("../", import.meta.url)));
  assert.equal(result.ok, true, result.problems.join("\n"));
});

test("changing WORKDIR does not move earlier copies", () => {
  assert.equal(findMissingWorkspaceContext(complete.replace(install, "WORKDIR /elsewhere\n" + install), graph, ["services/app"]).length, 3);
});
test("child WORKDIR cannot reinterpret inherited input destinations", () => {
  assert.equal(findMissingWorkspaceContext(complete.replace(install, "FROM build AS next\nWORKDIR /elsewhere\n" + install), graph, ["services/app"]).length, 3);
});
test("missing direct input is reported", () => {
  assert.ok(findMissingWorkspaceContext(complete.replace("COPY packages/a ./packages/a\n", ""), graph, ["services/app"]).some(p => p.includes("packages/a")));
});
test("unresolved workspace protocol fails closed", () => {
  assert.throws(() => collectWorkspaceClosure({a:{prod:[{name:"b",value:"workspace:*"}],dev:[]}},["a"]), /Unresolved workspace/);
});

const archive = "packages/validators/vendor/foundation.tgz";
const archivePrefix = "FROM node AS build\nWORKDIR /app\n";
test("filtered installs still need the root file archive before install", () => {
  assert.match(findMissingFileContext(archivePrefix + install, [archive])[0], /foundation.tgz/);
});
test("late or wrong-destination archive copies do not satisfy transport", () => {
  assert.equal(findMissingFileContext(archivePrefix + install + "COPY packages/validators/vendor ./packages/validators/vendor\n", [archive]).length, 1);
  assert.equal(findMissingFileContext(archivePrefix + "COPY packages/validators/vendor ./wrong\n" + install, [archive]).length, 1);
});
test("archive copies are inherited only through the same stage filesystem", () => {
  const copied = archivePrefix + "COPY packages/validators/vendor ./packages/validators/vendor\n";
  assert.deepEqual(findMissingFileContext(copied + "FROM build AS child\n" + install, [archive]), []);
  assert.equal(findMissingFileContext(copied + "FROM node AS child\nWORKDIR /app\n" + install, [archive]).length, 1);
});
test("archive dockerignore and exact destination remain binding", () => {
  const copied = archivePrefix + "COPY " + archive + " ./packages/validators/vendor/\n" + install;
  assert.deepEqual(findMissingFileContext(copied, [archive]), []);
  assert.equal(findMissingFileContext(copied, [archive], "**/*.tgz").length, 1);
});
test("all canonical filtered images carry the current root file archives", () => {
  const result = checkFileDependencyContext(fileURLToPath(new URL("../", import.meta.url)),
    ["Dockerfile", "services/edge-node/Dockerfile", "services/adp/Dockerfile", "services/integration-test-harness/Dockerfile"]);
  assert.equal(result.ok, true, result.problems.join("\n"));
});
