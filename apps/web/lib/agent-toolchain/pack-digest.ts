import "server-only";

// BI-52934B3E — the delivered-content identity of the dpf-platform pack.
//
// This is the TypeScript home of `delivered_digest()` in
// packages/dpf-skill-pack/scripts/installed_copy_freshness.py. The two must
// produce the same hex for the same tree; pack-digest.test.ts pins both to the
// fixture under __fixtures__/pack-digest/ (the Python suite asserts the same
// constant). The portal publishes this digest; clients compare their installed
// copy against it (design 2026-10-07-agent-toolchain-release-delivery §5.1).
//
// Order is by relative path SEGMENTS compared by code unit, case-sensitive.
// Python's `sorted(Path.rglob())` compares Path objects, which on Windows is
// case-insensitive, so the same tree hashed differently on a Windows client
// and the Linux portal. Both sides now sort by explicit segments.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Files no copy of the pack delivers (mirrors `is_build_debris`). */
function isBuildDebris(segments: readonly string[]): boolean {
  const name = segments[segments.length - 1] ?? "";
  return segments.includes("__pycache__") || name.endsWith(".pyc") || name === ".DS_Store";
}

/** Per-install files and directories excluded from the delivered identity. */
function isPerInstall(segments: readonly string[]): boolean {
  if (segments[0] === ".in_use") return true;
  if (segments.length === 2 && segments[0] === ".codex-plugin" && segments[1] === "plugin.json") return true;
  // Root connector descriptors carry per-install endpoints and the declaration.
  return segments.length === 1 && segments[0]!.endsWith(".mcp.json");
}

function compareSegments(left: readonly string[], right: readonly string[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (a !== b) return a < b ? -1 : 1;
  }
  return left.length - right.length;
}

function walk(root: string, prefix: string[], out: string[][]): void {
  for (const name of readdirSync(join(root, ...prefix))) {
    const segments = [...prefix, name];
    const stat = statSync(join(root, ...segments));
    if (stat.isDirectory()) walk(root, segments, out);
    else if (stat.isFile()) out.push(segments);
  }
}

/** Every file a copy of the pack delivers, in digest order, as POSIX-relative paths. */
export function listPackFiles(root: string): string[] {
  const files: string[][] = [];
  walk(root, [], files);
  return files
    .filter((segments) => !isBuildDebris(segments))
    .sort(compareSegments)
    .map((segments) => segments.join("/"));
}

/** Files the delivered identity covers: every pack file minus per-install ones. */
export function listDeliveredFiles(root: string): string[] {
  return listPackFiles(root).filter((relative) => !isPerInstall(relative.split("/")));
}

/** sha256 over `relative\0` + sha256(bytes) for each delivered file, in order. */
export function deliveredDigest(root: string): string {
  const digest = createHash("sha256");
  for (const relative of listDeliveredFiles(root)) {
    digest.update(Buffer.concat([Buffer.from(relative, "utf8"), Buffer.from([0])]));
    digest.update(createHash("sha256").update(readFileSync(join(root, ...relative.split("/")))).digest());
  }
  return digest.digest("hex");
}
