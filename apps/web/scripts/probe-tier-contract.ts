/**
 * Tier-contract probe — runs the full routing pipeline for each task type
 * in BUILT_IN_TASK_REQUIREMENTS against the LIVE model registry and prints
 * whether the selection satisfies the task's declared minimum tier and
 * required capabilities.
 *
 * This is the executable form of the "right LLM for the right job" principle.
 * Failures here are specific and fixable: either a model's qualityTier / scores
 * are wrong, a call-site's taskType tag is wrong, or the task's minimum
 * thresholds are wrong. Not a redesign — a truing-up.
 *
 * Usage inside the portal container:
 *   pnpm --filter web exec tsx scripts/probe-tier-contract.ts
 */
import { loadEndpointManifests, loadPolicyRules, loadOverrides } from "@/lib/routing/loader";
import { routeEndpointV2 } from "@/lib/routing/pipeline-v2";
import { inferContract } from "@/lib/routing/request-contract";
import { BUILT_IN_TASK_REQUIREMENTS } from "@/lib/routing/task-requirements";
import { TIER_MINIMUM_DIMENSIONS } from "@/lib/routing/quality-tiers";
import type { QualityTier } from "@/lib/routing/quality-tiers";

const TIER_ORDER: Record<QualityTier, number> = {
  basic: 0,
  adequate: 1,
  strong: 2,
  frontier: 3,
};

const CANONICAL_MESSAGES: Record<string, string> = {
  greeting: "Hello there",
  "status-query": "What's the status of order #12345?",
  summarization: "Summarize this text: The meeting discussed Q4 plans, focusing on product launches and staffing needs.",
  "data-extraction": "Extract the name, email, and company from this signature: John Smith, CEO, Acme Corp, john@acme.com",
  "web-search": "Search the web for recent news about Kubernetes.",
  creative: "Write a 2-sentence tagline for a sustainable clothing brand.",
  reasoning: "If A implies B, and B implies C, and we observe not-C, what can we conclude about A?",
  "code-gen": "Write a TypeScript function that deduplicates an array while preserving order.",
  "tool-action": "Use the get_weather tool to check today's forecast for Seattle.",
};

const COLORS = {
  ok: "\u001b[32m",     // green
  warn: "\u001b[33m",   // yellow
  fail: "\u001b[31m",   // red
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
};

type CheckResult = {
  taskType: string;
  passed: boolean;
  selectedModel: string;
  selectedTier: string;
  requiredTier: string;
  violations: string[];
};

async function runProbe(): Promise<void> {
  const [manifests, policies, overrides] = await Promise.all([
    loadEndpointManifests(),
    loadPolicyRules(),
    loadOverrides("default"),
  ]);

  console.log(`\n${COLORS.bold}Tier-contract probe${COLORS.reset}`);
  console.log(`  Manifests loaded: ${manifests.length}`);
  console.log(`  Tier distribution: ${summarizeTiers(manifests)}`);
  console.log("");

  const results: CheckResult[] = [];

  for (const [taskType, req] of Object.entries(BUILT_IN_TASK_REQUIREMENTS)) {
    const message = CANONICAL_MESSAGES[taskType] ?? `(no canonical message for ${taskType})`;
    const violations: string[] = [];
    let selectedModel = "(none)";
    let selectedTier = "(none)";

    try {
      const contract = await inferContract(taskType, [{ role: "user", content: message }]);

      const decision = await routeEndpointV2(manifests, contract, policies, overrides);

      if (!decision.selectedEndpoint) {
        violations.push(`NO ELIGIBLE ENDPOINT: ${decision.reason}`);
      } else {
        const selected = manifests.find((m) => m.id === decision.selectedEndpoint);
        if (!selected) {
          violations.push(`selected endpoint ${decision.selectedEndpoint} not in manifests`);
        } else {
          selectedModel = `${selected.providerId}/${selected.modelId}`;
          selectedTier = selected.qualityTier ?? "(unset)";

          // Check 1: qualityTier floor
          const reqTier = req.minimumTier as QualityTier | undefined;
          if (reqTier) {
            const actualTierOrder = selected.qualityTier ? TIER_ORDER[selected.qualityTier] : -1;
            const requiredTierOrder = TIER_ORDER[reqTier];
            if (actualTierOrder < requiredTierOrder) {
              violations.push(
                `TIER BELOW FLOOR: selected ${selected.qualityTier ?? "(unset)"} < required ${reqTier}`,
              );
            }
          }

          // Check 2: required capabilities present
          const reqCaps = req.requiredCapabilities ?? {};
          if (reqCaps.supportsToolUse && !selected.supportsToolUse) {
            violations.push("MISSING supportsToolUse");
          }
          if (reqCaps.supportsStructuredOutput && selected.capabilities.structuredOutput !== true) {
            violations.push("MISSING supportsStructuredOutput");
          }
          if (reqCaps.supportsStreaming && selected.capabilities.streaming !== true) {
            violations.push("MISSING supportsStreaming");
          }

          // Check 3: preferred min scores
          const minScores = (req.preferredMinScores ?? {}) as Record<string, number>;
          for (const [dim, min] of Object.entries(minScores)) {
            const actual = (selected as unknown as Record<string, number>)[dim];
            if (typeof actual === "number" && actual < min) {
              violations.push(`DIMENSION BELOW ${dim}: ${actual} < ${min}`);
            }
          }

          // Check 4: tier-dimension floor (more aggressive than preferredMinScores)
          if (reqTier && TIER_MINIMUM_DIMENSIONS[reqTier]) {
            for (const [dim, min] of Object.entries(TIER_MINIMUM_DIMENSIONS[reqTier])) {
              const actual = (selected as unknown as Record<string, number>)[dim];
              if (typeof actual === "number" && actual < min) {
                violations.push(`TIER-FLOOR ${dim}: ${actual} < ${min} (tier ${reqTier})`);
              }
            }
          }
        }
      }
    } catch (err) {
      violations.push(`EXCEPTION: ${err instanceof Error ? err.message : String(err)}`);
    }

    const result: CheckResult = {
      taskType,
      passed: violations.length === 0,
      selectedModel,
      selectedTier,
      requiredTier: req.minimumTier ?? "(none)",
      violations,
    };
    results.push(result);

    const badge = result.passed ? `${COLORS.ok}PASS${COLORS.reset}` : `${COLORS.fail}FAIL${COLORS.reset}`;
    console.log(
      `  ${badge} ${taskType.padEnd(18)} → ${selectedModel.padEnd(40)} ${COLORS.dim}tier=${selectedTier} (req ${result.requiredTier})${COLORS.reset}`,
    );
    for (const v of violations) {
      console.log(`        ${COLORS.warn}✗ ${v}${COLORS.reset}`);
    }
  }

  console.log("");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  const color = failed === 0 ? COLORS.ok : COLORS.fail;
  console.log(`${color}${COLORS.bold}${passed}/${results.length} task types satisfy their tier contract${COLORS.reset}`);

  if (failed > 0) {
    console.log("\nSummary of failures:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ${r.taskType}:`);
      for (const v of r.violations) console.log(`    - ${v}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

function summarizeTiers(manifests: Array<{ qualityTier?: string }>): string {
  const counts = new Map<string, number>();
  for (const m of manifests) {
    const tier = m.qualityTier ?? "(unset)";
    counts.set(tier, (counts.get(tier) ?? 0) + 1);
  }
  return [...counts.entries()].map(([t, n]) => `${t}=${n}`).join(", ");
}

runProbe().catch((err) => {
  console.error("Probe crashed:", err);
  process.exit(2);
});
