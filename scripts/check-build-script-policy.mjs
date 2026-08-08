#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function unquote(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"')))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse the top-level pnpm `allowBuilds` mapping without accepting YAML's
 * broader scalar coercions. Build-script decisions must be literal booleans.
 */
export function parseAllowBuilds(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^allowBuilds:\s*$/.test(line));
  if (start === -1) throw new Error("no `allowBuilds:` block found");

  const entries = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z]/.test(line)) break;
    if (/^\s*(?:#.*)?$/.test(line)) continue;

    const match = line.match(/^\s{2}((?:'[^']+'|"[^"]+"|[^:]+)):\s*(.*?)\s*(?:#.*)?$/);
    if (!match) {
      entries.push({ name: `<line ${index + 1}>`, value: line.trim() });
      continue;
    }
    entries.push({ name: unquote(match[1].trim()), value: match[2].trim() });
  }
  return entries;
}

export function auditBuildScriptPolicy(text) {
  const entries = parseAllowBuilds(text);
  const decisions = new Map();
  const unresolved = [];
  const duplicates = [];

  for (const { name, value } of entries) {
    if (decisions.has(name) || unresolved.some((entry) => entry.name === name)) {
      if (!duplicates.includes(name)) duplicates.push(name);
    }
    if (value === "true" || value === "false") {
      decisions.set(name, value === "true");
    } else {
      unresolved.push({ name, value });
    }
  }

  return { decisions, duplicates, unresolved, scanned: entries.length };
}

async function main() {
  const text = await readFile("pnpm-workspace.yaml", "utf8");
  let result;
  try {
    result = auditBuildScriptPolicy(text);
  } catch (error) {
    console.error(`Build-script policy guard failed — ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.unresolved.length > 0 || result.duplicates.length > 0) {
    console.error("Build-script policy guard failed — every allowBuilds entry must have one explicit boolean decision.");
    for (const entry of result.unresolved) {
      console.error(`  - ${entry.name}: unresolved value ${JSON.stringify(entry.value)}`);
    }
    for (const name of result.duplicates) {
      console.error(`  - ${name}: duplicate decision`);
    }
    console.error("Set each package to true only after review, or false when its install script is unnecessary.");
    process.exitCode = 1;
    return;
  }

  console.log(`Build-script policy guard passed (${result.scanned} explicit decisions).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
