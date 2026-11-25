// Self-test for check-docker-authority-cutover.mjs (BI-224F56F1).
//
// The guard must catch a new raw Docker call outside the registry, refuse a
// registered file whose call count grows, demand the registry shrink when a
// migration removes calls, and hold the immutable portal recipe off while any
// caller is still pending.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DOCKER_AUTHORITY_REGISTRY,
  checkDockerAuthority,
  checkSourceWriteAuthority,
  findSourceWriteLines,
  findRawDockerLines,
  recipeEnabled,
} from "./check-docker-authority-cutover.mjs";

test("detects socket, CLI argv and shell-string Docker calls", () => {
  const source = [
    'http.request({ socketPath: "/var/run/docker.sock" });',
    'await dockerSocketGet("/info");',
    'spawn("docker", ["ps"]);',
    'runProcessWithBudget("docker", args, {});',
    'await exec(`docker exec ${id} ls`);',
    "await runProcessWithBudget(",
    '  "docker",',
    "  args);",
    'const spec = { command: "docker" };',
    'await run("docker images dpf-promoter");',
    'await run("docker builder prune -f");',
  ].join("\n");
  assert.deepEqual(findRawDockerLines(source), [1, 2, 3, 4, 5, 6, 9, 10, 11]);
});

test("detects the Docker executable by absolute path and argv built by a call", () => {
  const source = [
    'const child = spawn("/usr/bin/docker", buildSandboxExecArgs(owner, id), { env });',
    'run("/usr/local/bin/docker", args);',
    'spawn("/usr/bin/docker", ["--host", "unix:///var/run/docker.sock", "exec", id]);',
    'const spec = { command: "/usr/bin/docker" };',
    'await exec(`/usr/bin/docker exec ${id} ls`);',
    'deps.spawn("docker", options.args);',
    'const label = "/usr/bin/dockerd-rootless";',
    'if (name.endsWith("/docker")) return;',
  ].join("\n");
  assert.deepEqual(findRawDockerLines(source), [1, 2, 3, 4, 5, 6]);
});

test("detects a launcher called with the literal executable whatever follows it", () => {
  const source = [
    'spawn("docker", argv["exec"]);',
    "execFile('/usr/bin/docker', parts[0], {});",
    'execFile(`docker`, build(owner)[1]);',
    'spawnSync("docker", flag ? a : b);',
    'execFile("docker");',
    'const child = spawn("docker"',
    '  , args);',
    "const other = child_process.execFileSync(",
    '  "docker",',
    "  argv[0],",
    ");",
    'const real = (deps.spawn ?? spawn)("docker", args, options);',
  ].join("\n");
  assert.deepEqual(findRawDockerLines(source), [1, 2, 3, 4, 5, 6, 8, 12]);
});

test("ignores comments, substring checks and non-call literals", () => {
  const source = [
    "// spawn(\"docker\", [\"ps\"]) is what we used to do",
    "/* `docker exec x` */",
    'if (name.includes("docker")) return;',
    'const modes = ["native", "docker", "transitioning"];',
    'soft(read, {}, "docker");',
    "const runtimes = [",
    '  "docker",',
    '  "podman",',
    "];",
    'const tools = ["docker", "podman"];',
  ].join("\n");
  assert.deepEqual(findRawDockerLines(source), []);
});

test("refuses an unregistered raw Docker caller", () => {
  const failures = checkDockerAuthority({
    observed: { "apps/web/lib/new-thing.ts": [3] },
    registry: {},
    recipeOn: false,
  });
  assert.match(failures.join("\n"), /new-thing\.ts.*not registered/);
});

test("refuses growth in a registered file and requires shrink to be recorded", () => {
  const registry = { "a.ts": { class: "pending", count: 2, reason: "r" }, "b.ts": { class: "pending", count: 3, reason: "r" } };
  const grown = checkDockerAuthority({ observed: { "a.ts": [1, 2, 3], "b.ts": [1, 2, 3] }, registry, recipeOn: false });
  assert.match(grown.join("\n"), /a\.ts.*3 raw Docker call lines.*registered 2/);
  const shrunk = checkDockerAuthority({ observed: { "a.ts": [1, 2], "b.ts": [1] }, registry, recipeOn: false });
  assert.match(shrunk.join("\n"), /b\.ts.*1 raw Docker call line.*lower the registered count/);
  const removed = checkDockerAuthority({ observed: { "a.ts": [1, 2] }, registry, recipeOn: false });
  assert.match(removed.join("\n"), /b\.ts.*no raw Docker call remains.*remove it/);
});

test("holds the immutable portal recipe while any caller is pending", () => {
  const registry = { "a.ts": { class: "pending", count: 1, reason: "r" }, "b.ts": { class: "actuator", count: 1, reason: "r" } };
  const observed = { "a.ts": [1], "b.ts": [1] };
  assert.deepEqual(checkDockerAuthority({ observed, registry, recipeOn: false }), []);
  assert.match(checkDockerAuthority({ observed, registry, recipeOn: true }).join("\n"), /portal-immutable-v1.*1 pending/);
  assert.deepEqual(checkDockerAuthority({ observed: { "b.ts": [1] }, registry: { "b.ts": registry["b.ts"] }, recipeOn: true }), []);
});

test("recognizes the recipe label only as a Dockerfile LABEL", () => {
  assert.equal(recipeEnabled('LABEL com.opendpf.scope-writer.recipe="portal-immutable-v1"\n'), true);
  assert.equal(recipeEnabled('# LABEL com.opendpf.scope-writer.recipe="portal-immutable-v1"\n'), false);
  assert.equal(recipeEnabled("FROM node\n"), false);
});

test("every registry entry names a known class and a reason", () => {
  for (const [path, entry] of Object.entries(DOCKER_AUTHORITY_REGISTRY)) {
    assert.ok(["actuator", "routed", "message", "pending"].includes(entry.class), path);
    assert.ok(Number.isInteger(entry.count) && entry.count > 0, path);
    assert.ok(entry.reason.length > 10, path);
  }
});

test("the checked-in tree satisfies the registry", async () => {
  const { runInRepo } = await import("./check-docker-authority-cutover.mjs");
  assert.deepEqual(runInRepo(), []);
});

test("finds install checkout writes only in files that name a host source root", () => {
  const writer = [
    'const root = process.env.DPF_REPO_ROOT;',
    'await gitRun(["-C", root, "fetch", remote]);',
    '// writeFileSync(target, body) in a comment is ignored',
    'writeFileSync(target, body);',
    'await prepareUpgradeSource(input, gitRun);',
    'await gitRun(["-C", root, "log", "--oneline"]);',
  ].join("\n");
  assert.deepEqual(findSourceWriteLines(writer), [2, 4, 5]);
  assert.deepEqual(findSourceWriteLines('writeFileSync("/tmp/x", body);\nawait git(["fetch", r]);'), []);
});

test("holds the immutable portal recipe while any install checkout writer is pending", () => {
  const registry = { "a.ts": { class: "pending", count: 1, reason: "r" }, "b.ts": { class: "routed", count: 1, reason: "r" } };
  const observed = { "a.ts": [1], "b.ts": [1] };
  assert.deepEqual(checkSourceWriteAuthority({ observed, registry, recipeOn: false }), []);
  assert.match(checkSourceWriteAuthority({ observed, registry, recipeOn: true }).join("\n"), /portal-immutable-v1.*1 pending install checkout write/);
  assert.match(checkSourceWriteAuthority({ observed: { "c.ts": [3] }, registry: {}, recipeOn: false }).join("\n"),
    /c\.ts: install checkout write at line\(s\) 3 is not registered\. Route it through the authorized source writer/);
});
