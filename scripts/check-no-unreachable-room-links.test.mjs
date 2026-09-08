import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { discoverGuardFiles } from "./check-guards.mjs";
import {
  acceptsDynamicChild,
  findHandBuiltCaseKeys,
  findInterpolatedPaths,
  findUnreachablePaths,
  isLinkContext,
  resolveRouteDirs,
} from "./lib/room-addressing-detect.mjs";

// A tiny App Router tree: /workspace/cases/[caseKey] exists behind a route
// group; /ea/workrooms has no dynamic child, which is exactly the BI-6F2CC21B
// shape.
const ROOT = "/app";
const TREE = {
  "/app": ["(shell)"],
  "/app/(shell)": ["workspace", "ea"],
  "/app/(shell)/workspace": ["cases"],
  "/app/(shell)/workspace/cases": ["[caseKey]"],
  "/app/(shell)/workspace/cases/[caseKey]": [],
  "/app/(shell)/ea": ["workrooms"],
  "/app/(shell)/ea/workrooms": [],
};

test("a route group is transparent when resolving a path prefix", () => {
  assert.deepEqual(resolveRouteDirs(TREE, ROOT, ["workspace", "cases"]), [
    "/app/(shell)/workspace/cases",
  ]);
  assert.deepEqual(resolveRouteDirs(TREE, ROOT, ["nope"]), []);
});

test("a dynamic child is detected through a route group", () => {
  assert.equal(acceptsDynamicChild(TREE, ["/app/(shell)/workspace/cases"]), true);
  assert.equal(acceptsDynamicChild(TREE, ["/app/(shell)/ea/workrooms"]), false);
});

test("RED: the BI-6F2CC21B defect — a link to a route with no dynamic segment", () => {
  const source = 'const a = { href: `/ea/workrooms/${row.capsuleId}` };';
  const hits = findUnreachablePaths(source, TREE, ROOT);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].prefix, "/ea/workrooms/");
});

test("GREEN: a link to a route that does accept a dynamic segment passes", () => {
  const source = 'const a = { href: `/workspace/cases/${key}` };';
  assert.deepEqual(findUnreachablePaths(source, TREE, ROOT), []);
});

test("RED: the BacklogItemRow defect — a work-case path spelled out by hand", () => {
  const source = 'href={`/workspace/cases/${room.capsuleId}`}';
  const hits = findHandBuiltCaseKeys(source);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "hand-built-case-key");
});

test("GREEN: the canonical helper composes the address", () => {
  const source =
    'href={`/workspace/cases/${encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: id })}`}';
  assert.deepEqual(findHandBuiltCaseKeys(source), []);
});

test("a non-link path of the same shape is out of scope", () => {
  // revalidatePath cannot 404 at a person; folding it in would make the guard
  // noisy enough to be ignored.
  const source = "revalidatePath(`/ea/workrooms/${buildId}`);";
  assert.deepEqual(findUnreachablePaths(source, TREE, ROOT), []);
  assert.equal(isLinkContext(source, source.indexOf("`")), false);
});

test("a whole computed path carries no route signal", () => {
  assert.deepEqual(findInterpolatedPaths("const p = `/${slug}`;"), []);
});

test("mid-segment interpolation is not a path join", () => {
  assert.deepEqual(findInterpolatedPaths("const p = `/cases-${id}`;"), []);
});

test("guard follows check-no convention and passes on the live tree", () => {
  const source = readFileSync(new URL("./check-no-unreachable-room-links.mjs", import.meta.url), "utf8");
  assert.match(source, /room-addressing-detect/);
  const discovered = discoverGuardFiles(readdirSync(new URL(".", import.meta.url)));
  assert.ok(discovered.guards.includes("check-no-unreachable-room-links.mjs"));
  assert.ok(discovered.tests.has("check-no-unreachable-room-links.test.mjs"));
  const execution = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./check-no-unreachable-room-links.mjs", import.meta.url))],
    { encoding: "utf8", cwd: fileURLToPath(new URL("..", import.meta.url)) },
  );
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /guard passed/i);
});
