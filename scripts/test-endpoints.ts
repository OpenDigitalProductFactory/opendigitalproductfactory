#!/usr/bin/env tsx
// scripts/test-endpoints.ts
// CLI wrapper for the endpoint test harness.
// Usage: pnpm test:endpoints [--endpoint <id>] [--task-type <type>] [--probes-only] [--ci]

import { runEndpointTests } from "../apps/web/lib/endpoint-test-runner";

async function main() {
  const args = process.argv.slice(2);
  const endpointId = getArg(args, "--endpoint");
  const taskType = getArg(args, "--task-type");
  const probesOnly = args.includes("--probes-only");
  const ciMode = args.includes("--ci");

  console.log("Running endpoint tests...\n");

  const results = await runEndpointTests({
    ...(endpointId ? { endpointId } : {}),
    ...(taskType ? { taskType } : {}),
    probesOnly,
    triggeredBy: "cli",
  });

  let hasFailures = false;

  for (const r of results) {
    const probesPassed = r.probes.filter((p) => p.pass).length;
    const probesFailed = r.probes.filter((p) => !p.pass).length;
    console.log(`\n=== ${r.endpointId} ===`);
    console.log(`Probes: ${probesPassed} passed, ${probesFailed} failed`);
    console.log(`Instruction following: ${r.instructionFollowing ?? "unknown"}`);
    if (r.codingCapability) console.log(`Coding capability: ${r.codingCapability}`);

    for (const p of r.probes) {
      console.log(`  ${p.pass ? "PASS" : "FAIL"} [${p.category}] ${p.name}`);
      if (!p.pass) {
        console.log(`       ${p.reason}`);
        hasFailures = true;
      }
    }

    if (r.scenarios.length > 0) {
      const scenariosPassed = r.scenarios.filter((s) => s.passed).length;
      const scenariosFailed = r.scenarios.filter((s) => !s.passed).length;
      console.log(`Scenarios: ${scenariosPassed} passed, ${scenariosFailed} failed`);

      for (const s of r.scenarios) {
        console.log(`  ${s.passed ? "PASS" : "FAIL"} [${s.taskType}] ${s.name}`);
        if (!s.passed) hasFailures = true;
        for (const a of s.assertionResults) {
          if (!a.passed) console.log(`       FAIL: ${a.description} — ${a.detail}`);
        }
        if (s.orchestratorScore !== null) console.log(`       Score: ${s.orchestratorScore}/5`);
      }
    }
  }

  if (ciMode && hasFailures) {
    console.log("\nCI mode: failures detected, exiting with code 1");
    process.exit(1);
  }
}

function getArg(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1]! : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
