// packages/db/src/agent-host-resource-charter.test.ts — BI-1C88254D
// Platform engineer (AI Ops) must own host resource health in its seed charter.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = join(root, "data", "agent_registry.json");

test("AGT-WS-PLATFORM charter mandates host resource health ownership", () => {
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const agents = registry.agents ?? registry;
  const list = Array.isArray(agents) ? agents : Object.values(agents);
  const platform = list.find(
    (a: { agent_id?: string }) => a.agent_id === "AGT-WS-PLATFORM",
  );
  assert.ok(platform, "AGT-WS-PLATFORM must exist in agent_registry.json");
  const domain = String(platform.capability_domain ?? "");
  assert.match(domain, /host resource health/i);
  assert.match(domain, /disk/i);
  assert.match(domain, /BI-1C88254D/);
});
