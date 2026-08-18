#!/usr/bin/env node
// Tool-pack inline-case ratchet — BI-OPT-RATCHETS.
//
// executeTool() in apps/web/lib/mcp-tools.ts dispatches MCP tools through one
// giant `switch (toolName)`. BI-ARCH-TOOLPACKS is migrating tools OFF that
// switch into scoped, lazily-loaded packs (apps/web/lib/mcp/packs/*), but it
// had no enforcement teeth — nothing stopped a new tool from landing as yet
// another inline `case`. This guard is that ratchet, in the same shape as
// scripts/check-style-drift.mjs and check-module-size.mjs: it freezes the
// current set of inline case names and lets it only SHRINK. A NEW inline case
// fails CI; the fix is to register the tool in a pack instead. Extracting a
// tool to a pack removes its case, after which `--update` retightens the
// baseline.
//
// W9 (BI-0E7B0953) extended this ratchet from "no NEW inline case" to "no
// handler generation outside packs" now the inline set has reached zero:
//   - the abandoned lib/mcp-handlers/ third-generation home must stay deleted;
//   - PLATFORM_TOOLS in mcp-tools.ts must stay a pure pack-registry
//     composition — no inline ToolDefinition may reappear in the array.
//
//   node scripts/check-mcp-tool-pack.mjs            # check (CI)
//   node scripts/check-mcp-tool-pack.mjs --update   # regenerate the baseline

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MCP_TOOLS_PATH = join(REPO_ROOT, "apps", "web", "lib", "mcp-tools.ts");
const BASELINE_PATH = join(REPO_ROOT, "scripts", "mcp-tool-pack-baseline.json");
const LEGACY_HANDLERS_DIR = join(REPO_ROOT, "apps", "web", "lib", "mcp-handlers");

/**
 * The set of tool names dispatched by inline `case` arms of executeTool's
 * top-level `switch (toolName)`.
 *
 * Top-level arms are indented exactly 4 spaces (`    case "name": {`). Nested
 * switches inside a case body (e.g. `switch (result.kind)`) are more deeply
 * indented and use non-tool values, so the 4-space anchor excludes them
 * naturally. We bound the scan to the executeTool switch body — from
 * `  switch (toolName) {` to its `    default: {` arm — so unrelated switches
 * elsewhere in the file can never leak in.
 */
export function extractInlineCaseNames(source) {
  const lines = source.split(/\r?\n/);
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (start === -1) {
      if (/^ {2}switch \(toolName\) \{/.test(lines[i])) start = i;
    } else if (/^ {4}default: \{/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (start === -1 || end === -1) {
    throw new Error(
      "check-mcp-tool-pack: could not locate the executeTool `switch (toolName)` body in mcp-tools.ts",
    );
  }
  const names = [];
  const CASE_RE = /^ {4}case "([a-zA-Z0-9_]+)":/;
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(CASE_RE);
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * The PLATFORM_TOOLS array in mcp-tools.ts must be a pure composition of the
 * pack registry: `...TOOL_PACK_REGISTRY.definitions` plus comments. Any inline
 * ToolDefinition (detected by a `name:`/`inputSchema:` field inside the array
 * literal) is a new tool registered outside a pack.
 */
export function extractInlinePlatformToolFields(source) {
  const start = source.indexOf("export const PLATFORM_TOOLS: ToolDefinition[] = [");
  if (start === -1) {
    throw new Error(
      "check-mcp-tool-pack: could not locate the PLATFORM_TOOLS array in mcp-tools.ts",
    );
  }
  const end = source.indexOf("\n];", start);
  if (end === -1) {
    throw new Error("check-mcp-tool-pack: could not locate the end of the PLATFORM_TOOLS array");
  }
  const body = source.slice(start, end);
  const offenders = [];
  for (const line of body.split(/\r?\n/)) {
    const code = line.replace(/\/\/.*$/, "");
    if (/(?:^|[\s{])name:\s*["']/.test(code) || /inputSchema:\s*\{/.test(code)) {
      offenders.push(line.trim());
    }
  }
  return offenders;
}

/** Files present in the abandoned lib/mcp-handlers/ home (deleted in W9). */
export function listLegacyHandlerFiles(dirPath = LEGACY_HANDLERS_DIR) {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath);
}

function readInlineCaseNames() {
  const source = readFileSync(MCP_TOOLS_PATH, "utf8");
  const names = extractInlineCaseNames(source);
  return [...new Set(names)].sort();
}

function main() {
  const current = readInlineCaseNames();

  if (process.argv.includes("--update")) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
    console.log(
      `Wrote MCP tool-pack baseline: ${current.length} inline executeTool cases (frozen; may only shrink).`,
    );
    process.exit(0);
  }

  let baseline = [];
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(
      `Missing baseline ${relative(REPO_ROOT, BASELINE_PATH)} — run: node scripts/check-mcp-tool-pack.mjs --update`,
    );
    process.exit(1);
  }

  // W9 structural ratchets — independent of the case-name baseline.
  const legacyFiles = listLegacyHandlerFiles();
  if (legacyFiles.length > 0) {
    console.error("Tool-pack ratchet failed (W9, BI-0E7B0953).\n");
    console.error("apps/web/lib/mcp-handlers/ was deleted when the handler layer collapsed to");
    console.error("one generation (packs). It must not come back. Found:\n");
    for (const f of legacyFiles) console.error(`  - apps/web/lib/mcp-handlers/${f}`);
    console.error("\nRegister the handler in a scoped pack (apps/web/lib/mcp/packs/*) instead.");
    process.exit(1);
  }
  const inlineDefs = extractInlinePlatformToolFields(readFileSync(MCP_TOOLS_PATH, "utf8"));
  if (inlineDefs.length > 0) {
    console.error("Tool-pack ratchet failed (W9, BI-0E7B0953).\n");
    console.error("PLATFORM_TOOLS in apps/web/lib/mcp-tools.ts is a pure pack-registry");
    console.error("composition — no inline ToolDefinition may be added to the array. Found:\n");
    for (const l of inlineDefs) console.error(`  - ${l}`);
    console.error("\nMove the definition (and its handler) into a scoped pack (apps/web/lib/mcp/packs/*).");
    process.exit(1);
  }

  const baselineSet = new Set(baseline);
  const added = current.filter((n) => !baselineSet.has(n));

  if (added.length > 0) {
    console.error("Tool-pack ratchet failed (BI-OPT-RATCHETS).\n");
    console.error(
      "These tools were added as a NEW inline `case` in executeTool's switch in",
    );
    console.error("apps/web/lib/mcp-tools.ts. The inline set is frozen and may only shrink —");
    console.error("new MCP tools must register in a scoped pack (apps/web/lib/mcp/packs/*),");
    console.error("not the switch (BI-ARCH-TOOLPACKS):\n");
    for (const n of added) console.error(`  - ${n}`);
    console.error(
      "\nMove each tool's definition + handler into a pack, or if you genuinely",
    );
    console.error(
      "intend to grow the inline set, run `node scripts/check-mcp-tool-pack.mjs --update`.",
    );
    process.exit(1);
  }

  const removed = baseline.filter((n) => !current.includes(n));
  if (removed.length > 0) {
    // Shrinking is the goal, but the baseline is stale until re-snapshotted.
    console.error("Tool-pack ratchet: the inline set SHRANK (good) but the baseline is stale.\n");
    console.error("These tools are no longer inline cases (extracted to a pack?):\n");
    for (const n of removed) console.error(`  - ${n}`);
    console.error(
      "\nRetighten the baseline: `node scripts/check-mcp-tool-pack.mjs --update`.",
    );
    process.exit(1);
  }

  console.log(
    `MCP tool-pack ratchet OK — ${current.length} inline executeTool cases, none added (frozen set, ratchet down as packs extract).`,
  );
}

// Run main() only when invoked directly, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
