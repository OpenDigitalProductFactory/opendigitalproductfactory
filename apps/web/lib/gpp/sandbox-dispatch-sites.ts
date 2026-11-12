import type { BuildPhase } from "@/lib/explore/feature-build-types";
import type { SourceFile } from "./unmediated-execute-sites";

type DispatchGroup = "cli" | "dispatcher" | "provider";
type DispatchSite = { group: DispatchGroup; count: number; phase: BuildPhase | "outside-lifecycle" };

/**
 * Phase labels are maintained by hand; the ratchet fails only on a new file
 * or a changed count, not on a relabelling. Inspected on ee1e80b0 (BI-D37B2C13).
 * CLI dispatchers are reached from build agent runners; ideate has its own caller.
 * Git-promotion verification executes after lifecycle work, outside that lifecycle.
 */
export const SANDBOX_DISPATCH_SITES: Readonly<Record<string, DispatchSite>> = {
  "lib/build/claude-dispatch.ts": { group: "cli", count: 1, phase: "build" },
  "lib/build/codex-dispatch.ts": { group: "cli", count: 1, phase: "build" },
  "lib/build/grok-dispatch.ts": { group: "cli", count: 1, phase: "build" },
  "lib/build/opencode-dispatch.ts": { group: "cli", count: 1, phase: "build" },
  "lib/build/ideate-dispatch.ts": { group: "cli", count: 1, phase: "ideate" },
  "lib/build/build-pipeline.ts": { group: "dispatcher", count: 1, phase: "build" },
  "lib/build/sandbox/agents/claude-agent-runner.ts": { group: "dispatcher", count: 1, phase: "build" },
  "lib/build/sandbox/agents/codex-agent-runner.ts": { group: "dispatcher", count: 1, phase: "build" },
  "lib/build/sandbox/agents/grok-agent-runner.ts": { group: "dispatcher", count: 1, phase: "build" },
  "lib/build/sandbox/agents/opencode-agent-runner.ts": { group: "dispatcher", count: 1, phase: "build" },
  "lib/build/sandbox/agents/dpf-native-agent-runner.ts": { group: "provider", count: 1, phase: "build" },
  "lib/queue/functions/git-promotion-sandbox-verification.ts": { group: "provider", count: 1, phase: "outside-lifecycle" },
};

/** Named call-site inventory, like C-9's existing reach ratchet; it does not resolve aliases. */
export function findSandboxDispatchSites(files: readonly SourceFile[]): Record<string, Partial<Record<DispatchGroup, number>>> {
  const counts: Record<string, Partial<Record<DispatchGroup, number>>> = {};
  const patterns: readonly [DispatchGroup, RegExp][] = [
    ["cli", /\brunSandboxAgentCli\s*\(/g],
    ["dispatcher", /\bdispatch(?:Claude|Codex|Grok|Opencode)Task\s*\(/g],
    ["provider", /\bprovider\s*\.\s*(?:exec|writeFile)\s*\(/g],
  ];
  for (const file of files) {
    if (!/^(lib|app)\//.test(file.path) || /\.(test|spec)\.tsx?$/.test(file.path) || file.path.includes("/__fixtures__/")) continue;
    const source = file.content.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/)
      .filter((line) => !/^\s*\/\//.test(line) && !/\bfunction\s+(runSandboxAgentCli|dispatch(?:Claude|Codex|Grok|Opencode)Task)\s*\(/.test(line)).join("\n");
    for (const [group, pattern] of patterns) {
      const count = [...source.matchAll(pattern)].length;
      if (count) (counts[file.path] ??= {})[group] = count;
    }
  }
  return counts;
}

export function sandboxPhases(): ReadonlySet<BuildPhase> {
  return new Set(Object.values(SANDBOX_DISPATCH_SITES).flatMap((site) => site.phase === "outside-lifecycle" ? [] : [site.phase]));
}
