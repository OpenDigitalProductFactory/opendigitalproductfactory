// scripts/lib/agent-identity.mjs
//
// Resolve WHICH agent client and WHICH thread is running a governed gate
// (BI-3A34D7A9).
//
// The problem this closes: the pregate used to default `ownerProvider` to
// "codex" and `ownerSessionId` to `gate-<pid>`. Nothing ever set them, so every
// client of every kind recorded itself as Codex with a fresh throwaway session
// id — 610 distinct "sessions" across 178 branches, with Claude branches
// labelled codex. The lease/evidence substrate was fine; the writers lied.
//
// Two rules govern everything here:
//
//   1. NEVER fabricate a provider. An unresolved provider is reported as
//      unresolved, not as a plausible-looking guess. A record that says "I do
//      not know" is useful; a record that says "codex" when it was Claude is
//      worse than no record at all, because it reads as authoritative.
//
//   2. Session identity must be the CLIENT THREAD, not the process. A pid
//      changes on every re-gate, so pid-derived ids cannot roll up the several
//      gates a single long-running thread runs, and cannot associate a
//      sub-thread with its parent.
//
// The provider vocabulary is a CLOSED enum owned by the
// `record_local_integration_result` MCP tool. This module must never emit a
// value outside it — see PROVIDERS below.

/**
 * Closed provider vocabulary, mirroring the `record_local_integration_result`
 * MCP tool's input schema (apps/web/lib/mcp/packs/build-evidence-pack.ts).
 * There is deliberately no "unknown" member: the tool would reject it. An
 * unresolved provider is represented by `provider: null` on the result and
 * handled by the caller, never by inventing an enum value.
 */
export const PROVIDERS = Object.freeze([
  "build-studio",
  "claude",
  "codex",
  "grok",
  "antigravity",
  "coworker",
]);

/**
 * Environment markers that identify a client, most-specific first.
 *
 * `claude` markers are verified from a live Claude Code session
 * (CLAUDECODE=1, CLAUDE_CODE_SESSION_ID=<uuid>,
 * CLAUDE_CODE_HOST_SESSION_ID=<parent>, CLAUDE_CODE_CHILD_SESSION=1).
 * The others are best-effort: they are the documented env of their CLI, and an
 * explicit `--owner-provider` / DPF_GATE_OWNER_PROVIDER always wins, so a
 * missed marker degrades to "unresolved" rather than to a wrong answer.
 */
const PROVIDER_MARKERS = Object.freeze([
  { provider: "claude", vars: ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_ENTRYPOINT"] },
  { provider: "codex", vars: ["CODEX_THREAD_ID", "CODEX_SESSION_ID", "CODEX_SANDBOX", "CODEX_HOME"] },
  { provider: "grok", vars: ["GROK_SESSION_ID", "GROK_THREAD_ID"] },
  { provider: "antigravity", vars: ["ANTIGRAVITY_SESSION_ID"] },
  { provider: "build-studio", vars: ["DPF_BUILD_STUDIO_TASK_RUN_ID", "DPF_BUILD_STUDIO"] },
]);

/**
 * Per-provider thread id, then generic fallbacks. Ordered: the thread's own id
 * first, then anything that at least identifies the client instance.
 */
const SESSION_VARS = Object.freeze({
  claude: ["CLAUDE_CODE_SESSION_ID"],
  codex: ["CODEX_THREAD_ID", "CODEX_SESSION_ID"],
  grok: ["GROK_THREAD_ID", "GROK_SESSION_ID"],
  antigravity: ["ANTIGRAVITY_SESSION_ID"],
  "build-studio": ["DPF_BUILD_STUDIO_TASK_RUN_ID"],
  coworker: [],
});

/**
 * The parent/host thread, when the client exposes one. This is what makes a
 * fleet of sub-threads roll up to the thread a human actually started.
 */
const ROOT_SESSION_VARS = Object.freeze({
  claude: ["CLAUDE_CODE_HOST_SESSION_ID"],
  codex: ["CODEX_ROOT_THREAD_ID", "CODEX_PARENT_SESSION_ID"],
  grok: [],
  antigravity: [],
  "build-studio": [],
  coworker: [],
});

function firstSet(env, names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/**
 * Resolve the calling agent's identity from the environment plus any explicit
 * overrides.
 *
 * @param {object} input
 * @param {Record<string, string | undefined>} input.env - environment to read.
 * @param {string} [input.providerOverride] - explicit `--owner-provider`.
 * @param {string} [input.sessionOverride] - explicit `--owner-session-id`.
 * @param {number|string} [input.pid] - used only to label an unattributed run.
 * @returns {{
 *   provider: string | null,
 *   providerSource: "explicit" | "detected" | "unresolved",
 *   sessionId: string | null,
 *   sessionSource: "explicit" | "detected" | "unresolved",
 *   rootSessionId: string | null,
 *   isChildThread: boolean,
 *   attribution: "attributed" | "partial" | "unattributed",
 *   warnings: string[],
 * }}
 */
export function resolveAgentIdentity(input = {}) {
  const env = input.env ?? {};
  const warnings = [];

  const providerOverride =
    typeof input.providerOverride === "string" && input.providerOverride.trim()
      ? input.providerOverride.trim()
      : null;

  let provider = null;
  let providerSource = "unresolved";
  if (providerOverride) {
    if (!PROVIDERS.includes(providerOverride)) {
      // An out-of-vocabulary provider is a caller error, not something to
      // silently coerce: the MCP tool would reject it downstream anyway, and
      // coercion is exactly the class of lie this module exists to remove.
      warnings.push(
        `owner provider "${providerOverride}" is not one of: ${PROVIDERS.join(", ")}`,
      );
    } else {
      provider = providerOverride;
      providerSource = "explicit";
    }
  }

  if (!provider) {
    for (const marker of PROVIDER_MARKERS) {
      if (firstSet(env, marker.vars)) {
        provider = marker.provider;
        providerSource = "detected";
        break;
      }
    }
  }

  if (!provider) {
    warnings.push(
      "could not identify the agent client from the environment — pass " +
        "--owner-provider <" + PROVIDERS.join("|") + "> (or set " +
        "DPF_GATE_OWNER_PROVIDER) so this gate's evidence is attributable",
    );
  }

  const sessionOverride =
    typeof input.sessionOverride === "string" && input.sessionOverride.trim()
      ? input.sessionOverride.trim()
      : null;

  let sessionId = null;
  let sessionSource = "unresolved";
  if (sessionOverride) {
    sessionId = sessionOverride;
    sessionSource = "explicit";
  } else if (provider) {
    const detected = firstSet(env, SESSION_VARS[provider] ?? []);
    if (detected) {
      sessionId = detected;
      sessionSource = "detected";
    }
  }

  if (!sessionId) {
    // Deliberately NOT `gate-<pid>`: that reads like a legitimate session id
    // while being a per-invocation throwaway. The `unattributed-` prefix makes
    // every such record self-labelling and trivially queryable, so the fleet's
    // real attribution coverage is measurable instead of assumed.
    const pid = input.pid ?? "unknown";
    sessionId = `unattributed-${pid}`;
    warnings.push(
      "could not identify the agent THREAD from the environment — pass " +
        "--owner-session-id <client thread id> (or set DPF_GATE_OWNER_SESSION_ID) " +
        "so repeated gates from one thread roll up instead of looking like " +
        "separate contributors",
    );
  }

  const rootSessionId = provider ? firstSet(env, ROOT_SESSION_VARS[provider] ?? []) : null;
  const isChildThread =
    (rootSessionId !== null && rootSessionId !== sessionId) ||
    firstSet(env, ["CLAUDE_CODE_CHILD_SESSION"]) === "1";

  const attribution =
    providerSource !== "unresolved" && sessionSource !== "unresolved"
      ? "attributed"
      : providerSource === "unresolved" && sessionSource === "unresolved"
        ? "unattributed"
        : "partial";

  return {
    provider,
    providerSource,
    sessionId,
    sessionSource,
    rootSessionId,
    isChildThread,
    attribution,
    warnings,
  };
}

/**
 * The attribution block recorded inside the gate's evidence `details` JSON.
 *
 * Kept out of the closed-enum columns on purpose: this is descriptive
 * provenance, and putting it in free-form evidence means it needs no schema
 * migration and can grow (root thread, child flag, how each field was
 * resolved) without touching the lease contract.
 */
export function buildAttributionEvidence(identity) {
  return {
    attribution: identity.attribution,
    providerSource: identity.providerSource,
    sessionSource: identity.sessionSource,
    rootSessionId: identity.rootSessionId,
    isChildThread: identity.isChildThread,
  };
}
