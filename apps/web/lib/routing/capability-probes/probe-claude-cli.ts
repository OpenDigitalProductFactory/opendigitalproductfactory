// apps/web/lib/routing/capability-probes/probe-claude-cli.ts
//
// Phase A5: Capability probe for the claude-code CLI adapter.
//
// Shells out to `docker exec <sandbox> claude --version` to capture the
// installed version, then returns a populated AdapterCapabilityProfile
// (minus the DB-managed id/probedAt/probedBy fields). The cache layer
// in capability-profile-cache.ts wraps this and persists the result.
//
// Capabilities are observed from cli-adapter.ts and the audit at
// docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §5.2.
//
// If the CLI is missing or docker exec fails, the probe THROWS — it does not
// return a stub. Probe failure is operationally meaningful and must surface
// to the cache layer (and any caller) so the routing system doesn't make
// decisions based on phantom capabilities.

import { lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";
import type { CapabilityProbeResult } from "../capability-probe-types";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const PROBE_TIMEOUT_MS = 10_000;
const VERSION_REGEX = /(\d+\.\d+\.\d+)/;

export async function probeClaudeCli(): Promise<CapabilityProbeResult> {
  const execAsync = lazyUtil().promisify(lazyChildProcess().exec);

  let stdout: string;
  try {
    const result = (await execAsync(
      `docker exec ${SANDBOX_CONTAINER} claude --version`,
      { timeout: PROBE_TIMEOUT_MS },
    )) as { stdout: string; stderr: string };
    stdout = result.stdout ?? "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `probeClaudeCli: failed to invoke 'claude --version' in sandbox '${SANDBOX_CONTAINER}': ${message}`,
    );
  }

  const match = VERSION_REGEX.exec(stdout);
  if (!match) {
    throw new Error(
      `probeClaudeCli: could not parse claude version from stdout: ${JSON.stringify(stdout)}`,
    );
  }

  return {
    adapterKind: "claude-code-cli",
    adapterVersion: `claude-code/${match[1]}`,

    // Observed capabilities — see cli-adapter.ts and Claude Code feature set.
    supportsStreamingEvents: true,
    supportsMcpAttach: true,
    supportsMcpAttachPerInvoke: true, // --mcp-config flag
    supportsSubagents: true, // Task tool
    supportsHooks: true, // settings.json hooks
    supportsPlanState: true,
    supportsTodoState: true, // TodoWrite tool
    supportsWebFetch: true,
    supportsWebSearch: true,
    supportsSessionResume: true, // --session-id
    supportsExtendedThinking: true,
    supportsOutputSchema: false, // not equivalent to Codex's --output-schema

    maxInteractiveLatencyMs: 600_000, // matches CLI_TIMEOUT_MS in cli-adapter.ts
    supportedAuthModes: ["oauth", "api-key"],
    knownDegradations: null,
  };
}
