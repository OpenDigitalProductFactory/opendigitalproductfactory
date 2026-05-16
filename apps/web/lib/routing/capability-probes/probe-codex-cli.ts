// apps/web/lib/routing/capability-probes/probe-codex-cli.ts
//
// Phase A5: Capability probe for the codex CLI adapter.
//
// Shells out to `docker exec <sandbox> codex --version` to capture the
// installed version, then returns a populated AdapterCapabilityProfile shape.
//
// Capabilities are observed from codex-cli-adapter.ts and the JSONL audit at
// docs/superpowers/audits/evidence/2026-04-29-codex-jsonl-probe.md.
//
// `knownDegradations` carries the two documented silent-failure modes:
//   - openai/codex#15451: --json events silently dropped when MCP active
//   - openai/codex#4776: schema rename (item_type→type, assistant_message→agent_message)
//
// These let A6's capability-aware fallback reason about Codex limitations
// honestly instead of trusting an aspirational booleans table.

import { lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";
import type { CapabilityProbeResult } from "../capability-probe-types";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const PROBE_TIMEOUT_MS = 10_000;
const VERSION_REGEX = /(\d+\.\d+\.\d+)/;

export async function probeCodexCli(): Promise<CapabilityProbeResult> {
  const execAsync = lazyUtil().promisify(lazyChildProcess().exec);

  let stdout: string;
  try {
    const result = (await execAsync(
      `docker exec ${SANDBOX_CONTAINER} codex --version`,
      { timeout: PROBE_TIMEOUT_MS },
    )) as { stdout: string; stderr: string };
    stdout = result.stdout ?? "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `probeCodexCli: failed to invoke 'codex --version' in sandbox '${SANDBOX_CONTAINER}': ${message}`,
    );
  }

  const match = VERSION_REGEX.exec(stdout);
  if (!match) {
    throw new Error(
      `probeCodexCli: could not parse codex version from stdout: ${JSON.stringify(stdout)}`,
    );
  }

  return {
    adapterKind: "codex-cli",
    adapterVersion: `codex-cli/${match[1]}`,

    // Per audit Q1 + JSONL probe evidence:
    supportsStreamingEvents: true, // --json
    supportsMcpAttach: true, // ~/.codex/config.toml + codex mcp subcommand
    supportsMcpAttachPerInvoke: false, // static config only — KEY DIFF vs Claude
    supportsSubagents: false, // not in current Codex
    supportsHooks: false,
    supportsPlanState: true, // item.completed type=plan_update
    supportsTodoState: true, // same
    supportsWebFetch: true, // model-dependent but advertised
    supportsWebSearch: true, // item.completed type=web_search
    supportsSessionResume: true, // codex exec resume <uuid>
    supportsExtendedThinking: true, // -c reasoning.effort=high
    supportsOutputSchema: true, // --output-schema (gpt-5 family only)

    maxInteractiveLatencyMs: 180_000,
    supportedAuthModes: ["oauth", "api-key"],

    knownDegradations: [
      {
        trigger: "--json + MCP active",
        behavior: "stream malformed; events silently dropped",
        source: "https://github.com/openai/codex/issues/15451",
      },
      {
        trigger: "schema rename observed in 0.x releases",
        behavior:
          "item_type field renamed to type without notice; assistant_message renamed to agent_message",
        source: "https://github.com/openai/codex/issues/4776",
      },
    ],
  };
}
