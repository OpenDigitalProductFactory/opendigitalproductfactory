// apps/web/lib/routing/execution-adapter-types.ts
//
// Phase A4: Structured ExecutionAdapterSelector + capability-requirement types.
//
// Replaces the legacy string-typed `executionAdapter` field on RoutedExecutionPlan
// with a structured selector that carries adapter kind, auth posture, optional
// version pin, and optional sandbox-pool affinity hint. `parseExecutionAdapterSelector`
// round-trips legacy string values ("claude-cli", "codex-cli", "chat") into the
// new shape so call sites can be migrated incrementally without breaking
// in-flight route plans.
//
// Spec: docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §5.1
// Plan: docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md (Task A4)
//
// This file is intentionally pure types + a parser — no DB, no Prisma client.
// Phase A6 will swap the hard-coded `isCliAdapter` check in ai-inference.ts to
// route through the resolved selector.

/**
 * Discriminator for the execution adapter that runs an inference call.
 *
 * `http-*` kinds correspond to direct HTTP calls against the named provider
 * family. `http-generic` is the legacy `"chat"` sentinel — a generic HTTP
 * execution mode that doesn't bind to one provider; the registry resolves the
 * concrete handler from `(providerId, modelClass)` at dispatch time.
 *
 * `claude-code-cli` / `codex-cli` are subprocess CLI adapters with OAuth
 * sessions. `codex-mcp-server` is Codex acting as an MCP server (sidesteps
 * the `--json` + MCP degradation in openai/codex#15451). `local-runtime`
 * covers Ollama and other locally-hosted runtimes.
 */
export type ExecutionAdapterKind =
  | "http-anthropic"
  | "http-openai"
  | "http-gemini"
  | "http-ollama"
  | "http-generic"
  | "claude-code-cli"
  | "codex-cli"
  | "grok-cli"
  | "codex-mcp-server"
  | "local-runtime";

/**
 * Structured selector for an execution adapter.
 *
 * `version` pins a specific adapter version (e.g. `"codex-cli/0.125.0"`); when
 * absent, the registry uses the latest probed version for the kind.
 * `containerHint` lets a route plan steer the sandbox pool toward a specific
 * slot for CLI adapters (per-thread session affinity).
 */
export type ExecutionAdapterSelector = {
  kind: ExecutionAdapterKind;
  version?: string;
  authMode: "api-key" | "oauth" | "local";
  containerHint?: string;
};

/**
 * Capability fields on AdapterCapabilityProfile that a route plan can require.
 *
 * Listed explicitly rather than `keyof AdapterCapabilityProfileModel` because
 * the generated Prisma type includes non-capability columns (id, adapterKind,
 * adapterVersion, probedAt, …). The set below is exactly the boolean
 * capability columns from the prisma model definition (schema.prisma §
 * "AdapterCapabilityProfile" lines 5541–5552). Keeping it in sync is a
 * one-line edit when a new boolean capability is added to the model.
 */
export type AdapterCapability =
  | "supportsStreamingEvents"
  | "supportsMcpAttach"
  | "supportsMcpAttachPerInvoke"
  | "supportsSubagents"
  | "supportsHooks"
  | "supportsPlanState"
  | "supportsTodoState"
  | "supportsWebFetch"
  | "supportsWebSearch"
  | "supportsSessionResume"
  | "supportsExtendedThinking"
  | "supportsOutputSchema";

/**
 * A single capability requirement on a route plan.
 *
 * `required: true` → fail-route if the chosen adapter lacks the capability.
 * `required: false` → advisory; downgrade gracefully (e.g. todo state → text).
 */
export type AdapterCapabilityRequirement = {
  capability: AdapterCapability;
  required: boolean;
};

const VALID_KINDS: ReadonlySet<ExecutionAdapterKind> = new Set<ExecutionAdapterKind>([
  "http-anthropic",
  "http-openai",
  "http-gemini",
  "http-ollama",
  "http-generic",
  "claude-code-cli",
  "codex-cli",
  "grok-cli",
  "codex-mcp-server",
  "local-runtime",
]);

const VALID_AUTH_MODES: ReadonlySet<ExecutionAdapterSelector["authMode"]> = new Set<
  ExecutionAdapterSelector["authMode"]
>(["api-key", "oauth", "local"]);

/** Known transport limitation, shared by routing eligibility and final dispatch. */
export function requiredToolChoiceExclusionReason(adapter: string | ExecutionAdapterSelector | null): string | null {
  const kind = typeof adapter === "string" ? (adapter === "claude-cli" ? "claude-code-cli" : adapter) : adapter?.kind;
  return kind === "claude-code-cli" || kind === "codex-cli"
    ? `Execution adapter ${kind} cannot enforce required tool choice with a server-verifiable mechanism.`
    : null;
}

/**
 * Round-trip a legacy string-typed `executionAdapter` value (or an already-
 * structured selector) into the new ExecutionAdapterSelector shape.
 *
 * Mappings:
 *   "claude-cli" → { kind: "claude-code-cli", authMode: "oauth" }
 *   "codex-cli"  → { kind: "codex-cli",       authMode: "oauth" }
 *   "chat"       → { kind: "http-generic",    authMode: "api-key" }
 *
 * A valid selector object is returned (value-equal) after light validation.
 * `null` / `undefined` and unknown legacy strings throw.
 */
export function parseExecutionAdapterSelector(
  input: string | ExecutionAdapterSelector | undefined | null,
): ExecutionAdapterSelector {
  if (input === undefined || input === null) {
    throw new Error("executionAdapter is required");
  }

  if (typeof input === "string") {
    switch (input) {
      case "claude-cli":
        return { kind: "claude-code-cli", authMode: "oauth" };
      case "codex-cli":
        return { kind: "codex-cli", authMode: "oauth" };
      case "chat":
        return { kind: "http-generic", authMode: "api-key" };
      default:
        throw new Error(`Unknown executionAdapter: "${input}"`);
    }
  }

  // Object input — validate kind + authMode and pass through.
  if (!VALID_KINDS.has(input.kind)) {
    throw new Error(`Unknown executionAdapter kind: "${input.kind}"`);
  }
  if (!VALID_AUTH_MODES.has(input.authMode)) {
    throw new Error(`Unknown executionAdapter authMode: "${input.authMode}"`);
  }

  const out: ExecutionAdapterSelector = {
    kind: input.kind,
    authMode: input.authMode,
  };
  if (input.version !== undefined) out.version = input.version;
  if (input.containerHint !== undefined) out.containerHint = input.containerHint;
  return out;
}
