// scripts/agent-host-resource-charter.contract.test.mjs — BI-1C88254D
// Platform engineer (AI Ops) must own host resource health in its seed charter.
// Lives under scripts/ so packages/db vitest does not load node:test suites.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const registryPath = "packages/db/data/agent_registry.json";

test("AGT-WS-PLATFORM charter mandates host resource health ownership", () => {
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const agents = registry.agents ?? registry;
  const list = Array.isArray(agents) ? agents : Object.values(agents);
  const platform = list.find((a) => a.agent_id === "AGT-WS-PLATFORM");
  assert.ok(platform, "AGT-WS-PLATFORM must exist in agent_registry.json");
  const domain = String(platform.capability_domain ?? "");
  assert.match(domain, /host resource health/i);
  assert.match(domain, /disk/i);
  assert.match(domain, /BI-1C88254D/);
});
