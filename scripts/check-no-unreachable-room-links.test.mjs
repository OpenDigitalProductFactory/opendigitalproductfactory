import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  normalizeRoomGuardPath,
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

test("Windows filesystem paths retain the same route and baseline identity", () => {
  const windowsTree = Object.fromEntries(Object.entries(TREE).map(([path, children]) =>
    [normalizeRoomGuardPath(`D:${path.replaceAll("/", "\\")}`), children]));
  const hits = findUnreachablePaths('const a = { href: `/ea/workrooms/${id}` };',
    windowsTree, normalizeRoomGuardPath("D:\\app"));
  assert.equal(hits.length, 1);
  assert.equal(normalizeRoomGuardPath("apps\\web\\lib\\room.ts"), "apps/web/lib/room.ts");
});

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

// BI-AB8FD9B9 — a scan that found nothing must not read as a clean tree. The
// guard resolves its roots from the working directory and both walks swallow a
// missing directory, so running it from anywhere but the repository root once
// reported "OK (0 route dirs scanned)", called every baseline entry stale, and
// offered an --update that deleted four grandfathered exemptions.
const GUARD = fileURLToPath(new URL("./check-no-unreachable-room-links.mjs", import.meta.url));

/** A minimal repo whose tree is real but holds no unreachable room link. */
function cleanFixtureRepo(baselineEntries) {
  const root = mkdtempSync(join(tmpdir(), "room-guard-"));
  for (const dir of ["apps/web/app/(shell)/workspace", "apps/web/lib", "apps/web/components", "scripts"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  for (const file of ["apps/web/lib/ok.ts", "apps/web/components/Ok.tsx", "apps/web/app/page.tsx"]) {
    writeFileSync(join(root, file), "export const ok = 1;\n");
  }
  writeFileSync(
    join(root, "scripts/room-addressing-baseline.json"),
    `${JSON.stringify({ version: 1, owner: "platform-architecture", expiry: "2026-12-07", unreachableLinks: baselineEntries }, null, 2)}\n`,
  );
  return root;
}

test("a run with no App Router tree refuses rather than reporting a clean scan", () => {
  const empty = mkdtempSync(join(tmpdir(), "room-guard-empty-"));
  const result = spawnSync(process.execPath, [GUARD], { cwd: empty, encoding: "utf8" });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /cannot run/);
  assert.doesNotMatch(result.stdout, /OK/);
});

test("a scan root with no source files refuses too — a partial tree is not a pass", () => {
  const root = cleanFixtureRepo([]);
  rmSync(join(root, "apps/web/components/Ok.tsx"));
  const result = spawnSync(process.execPath, [GUARD], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /apps\/web\/components/);
});

test("--update refuses to erase a populated baseline when the scan found nothing", () => {
  const entries = ["apps/web/lib/legacy.ts::/platform/tools/integrations/"];
  const root = cleanFixtureRepo(entries);
  const baselinePath = join(root, "scripts/room-addressing-baseline.json");
  const before = readFileSync(baselinePath, "utf8");

  const result = spawnSync(process.execPath, [GUARD, "--update"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /refusing to write an EMPTY baseline/);
  assert.equal(readFileSync(baselinePath, "utf8"), before, "the baseline must be untouched");
});

test("--allow-empty is the deliberate way to record that every entry really is fixed", () => {
  const root = cleanFixtureRepo(["apps/web/lib/legacy.ts::/platform/tools/integrations/"]);
  const baselinePath = join(root, "scripts/room-addressing-baseline.json");

  const result = spawnSync(process.execPath, [GUARD, "--update", "--allow-empty"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(baselinePath, "utf8")).unreachableLinks, []);
});
