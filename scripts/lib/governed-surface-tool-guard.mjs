import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function validateGovernedSurfaceContracts(contracts, toolNames, options = {}) {
  const failures = [];
  const surfaceIds = new Set();
  const routes = new Set();

  for (const contract of contracts) {
    if (!contract?.surfaceId || typeof contract.surfaceId !== "string") {
      failures.push("Governed surface contract has no stable surfaceId.");
      continue;
    }
    if (surfaceIds.has(contract.surfaceId)) failures.push(`Duplicate surfaceId '${contract.surfaceId}'.`);
    surfaceIds.add(contract.surfaceId);
    for (const route of contract.routes ?? []) {
      if (routes.has(route)) failures.push(`Duplicate route '${route}' across governed surface contracts.`);
      routes.add(route);
    }
    if (!contract.readModel?.trim()) failures.push(`Surface '${contract.surfaceId}' has no canonical read-model source.`);

    const exemption = contract.exemption;
    if (exemption && (!exemption.rationale?.trim() || !exemption.owner?.trim())) {
      failures.push(`Surface '${contract.surfaceId}' exemption requires non-empty rationale and owner.`);
      continue;
    }
    const required = [...(contract.requiredReadTools ?? []), ...(contract.requiredActTools ?? [])];
    if (required.length === 0 && !exemption) {
      failures.push(`Surface '${contract.surfaceId}' has no required MCP read/act tool and no explicit exemption.`);
      continue;
    }
    const missing = required.filter((toolName) => !toolNames.has(toolName));
    if (missing.length > 0) {
      failures.push(
        `Surface '${contract.surfaceId}' is missing MCP tool(s) ${missing.join(", ")}; read-model '${contract.readModel}', routes ${(contract.routes ?? []).join(", ")}.`,
      );
    }

    for (const uiFile of contract.uiFiles ?? []) {
      const source = options.sourceByPath?.get(uiFile)
        ?? (options.repoRoot ? readFileSync(join(options.repoRoot, uiFile), "utf8") : null);
      if (source === null) {
        failures.push(`Surface '${contract.surfaceId}' declares UI file '${uiFile}' but no source was supplied to the conformance guard.`);
        continue;
      }
      for (const nodeId of contract.requiredNodeIds ?? []) {
        const marker = `data-surface-node-id="${nodeId}"`;
        if (!source.includes(marker)) {
          failures.push(`Surface '${contract.surfaceId}' UI file '${uiFile}' is missing semantic node marker '${nodeId}'.`);
        }
      }
      const interactiveTags = source.match(/<(?:input|select|textarea|button)\b[^>]*>/gs) ?? [];
      for (const tag of interactiveTags) {
        if (!/\bdata-surface-node-id\s*=/.test(tag)) {
          const compact = tag.replace(/\s+/g, " ").slice(0, 120);
          failures.push(`Surface '${contract.surfaceId}' UI file '${uiFile}' contains an unbound interactive control: ${compact}`);
        }
      }
    }
  }
  return failures;
}

export function extractPlatformToolNames(repoRoot) {
  const files = [join(repoRoot, "apps/web/lib/mcp-tools.ts")];
  const packDir = join(repoRoot, "apps/web/lib/mcp/packs");
  for (const entry of readdirSync(packDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(join(packDir, entry.name));
    }
  }
  const names = new Set();
  const pattern = /\bname\s*:\s*["']([a-zA-Z0-9_]+)["']/g;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  return names;
}
