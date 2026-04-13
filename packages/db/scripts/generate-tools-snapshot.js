#!/usr/bin/env node
// generate-tools-snapshot.js
// Extracts tool metadata from apps/web/lib/mcp-tools.ts and writes
// packages/db/src/platform-tools-snapshot.json.
//
// Run: node packages/db/scripts/generate-tools-snapshot.js
// Runs automatically in the Dockerfile init stage before seeding.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..", "..");
const srcPath = path.join(root, "apps", "web", "lib", "mcp-tools.ts");
const outPath = path.join(__dirname, "..", "src", "platform-tools-snapshot.json");

if (!fs.existsSync(srcPath)) {
  console.error("[generate-tools-snapshot] Source not found:", srcPath);
  process.exit(1);
}

const src = fs.readFileSync(srcPath, "utf8");

const start = src.indexOf("export const PLATFORM_TOOLS: ToolDefinition[] = [");
if (start === -1) {
  console.error("[generate-tools-snapshot] PLATFORM_TOOLS not found in source.");
  process.exit(1);
}

const endMarker = src.indexOf("\nexport function ", start);
const section = src.slice(start, endMarker === -1 ? undefined : endMarker);

const tools = [];
const lines = section.split("\n");
let depth = 0;
let inArray = false;
let currentTool = null;

for (const line of lines) {
  if (!inArray && line.includes("PLATFORM_TOOLS")) {
    inArray = true;
    depth = 0;
  }
  if (!inArray) continue;

  for (const c of line) {
    if (c === "{") depth++;
    if (c === "}") depth--;
  }

  const nameMatch = line.match(/^\s{4}name: "([^"]+)"/);
  if (nameMatch && depth === 1) {
    if (currentTool) tools.push(currentTool);
    currentTool = {
      name: nameMatch[1],
      description: "",
      sideEffect: false,
      requiresExternalAccess: false,
      buildPhases: null,
    };
  }

  if (currentTool) {
    const descMatch = line.match(/^\s{4}description: "([^"]+)"/);
    if (descMatch) currentTool.description = descMatch[1];

    const seMatch = line.match(/^\s{4}sideEffect: (true|false)/);
    if (seMatch) currentTool.sideEffect = seMatch[1] === "true";

    const reMatch = line.match(/^\s{4}requiresExternalAccess: (true|false)/);
    if (reMatch) currentTool.requiresExternalAccess = reMatch[1] === "true";

    const bpMatch = line.match(/^\s{4}buildPhases: \[([^\]]+)\]/);
    if (bpMatch) {
      currentTool.buildPhases = bpMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/"/g, ""));
    }
  }
}
if (currentTool) tools.push(currentTool);

fs.writeFileSync(outPath, JSON.stringify(tools, null, 2) + "\n");
console.log(
  `[generate-tools-snapshot] Written ${tools.length} tools to ${path.relative(root, outPath)}`
);
