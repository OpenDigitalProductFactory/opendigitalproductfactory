// apps/web/lib/tak/decision-routing-governance-hook.ts
//
// Plane-2 server-side decision-routing gate (BI-B22DE548, EP-5560770F).
//
// The consult-scopes-before-asking commandment is enforced on the CLI surface by
// a PreToolUse hook (decision-routing-guard.mjs, plane 1) and steered on the
// in-portal coworker prompt by decision-routing-block.ts. This is the plane-2
// HARD gate on the server-side governed-execution seam: when an in-portal
// coworker / Build Studio agent (source: "agentic-loop") takes a CONSEQUENTIAL
// backlog DECISION (triage / retire — deciding among defer/discard/duplicate/
// reorder outcomes) with NO principle_decide consultation earlier in the same
// session window, the gate denies and points at the kernel.
//
// Design (kernel-consulted 2026-07-04, principle_decide: enforce_narrow ≈
// shadow_audit, margin 0.015 / low confidence — a genuine judgment call, so this
// ships BOTH: it enforces a NARROW, unambiguous tool subset by default AND is
// mode-configurable so the operator can drop to shadow/off without a redeploy):
//   - Scope: DECLARED-consequential tools, only source "agentic-loop" (external
//     CLI = plane 1; direct REST/JSON-RPC = operator, out of scope). The set is
//     DERIVED from ToolDefinition.consequence (TAK §8.4.1) by
//     consequential-tool-coverage.ts, unioned with CONSEQUENTIAL_DECISION_TOOLS
//     as a transitional seed. It was an allowlist of two names and therefore
//     governed 2 of 174 side-effecting tools; a tool now enters the gate by
//     declaring what it is, at the place it is declared.
//   - Consultation window: a principle_decide call (recorded via onPostToolUse)
//     clears the gate for CONSULT_WINDOW_MS. The natural bypass is "consult first".
//   - Mode DPF_DECISION_GATE_MODE = enforce (default) | shadow (audit only, no
//     deny) | off. An unconsulted consequential decision always emits a structured
//     audit signal (except off), regardless of enforce/shadow.
//   - Fail-open everywhere: any error → allow. A governance guard must never wedge
//     the loop (onPreToolUse throwing is NOT caught by the runner — see
//     mcp-governed-execute runPreToolHooks — so this wraps its own body).
//
// Ledger note: the consultation map is per-process, in-memory. A coworker session
// is effectively sticky to one portal process, so this holds for the single-portal
// deployment; a durable cross-process ledger (and a DB-backed audit sink) is a
// follow-up if multi-instance portals land.

import type {
  ToolLifecycleDecision,
  ToolLifecycleEvent,
  ToolLifecyclePostEvent,
  ToolLifecycleHook,
} from "@/lib/mcp-governed-execute";

export type DecisionGateMode = "enforce" | "shadow" | "off";

/**
 * TRANSITIONAL SEED — the backlog decision-actions whose consequence is the
 * DECISION taken (defer / discard / duplicate / reorder) rather than a declared
 * reach, so they do not derive from `ToolDefinition.consequence`. Unioned with
 * the derived set by `deriveConsequentialToolNames`, never replaced: dropping
 * it would silently shrink the gate.
 */
export const CONSEQUENTIAL_DECISION_TOOLS: ReadonlySet<string> = new Set([
  "triage_backlog_item",
  "retire_backlog_item",
]);

/**
 * Resolver for the live gated set. Indirected through a module-level slot so
 * this module does not statically import the whole 96-pack tool catalog (the
 * hook is loaded on every governed tool call, and its unit tests must stay
 * catalog-free). `installConsequentialToolResolver` is called by
 * register-tool-governance-hooks.ts at composition time.
 *
 * The default is the SEED, not an empty set: if installation is ever missed the
 * gate degrades to its previous, narrower behaviour rather than to no gate.
 */
let _resolveGatedTools: () => ReadonlySet<string> = () => CONSEQUENTIAL_DECISION_TOOLS;

export function installConsequentialToolResolver(resolver: () => ReadonlySet<string>): void {
  _resolveGatedTools = resolver;
}

export function _resetConsequentialToolResolverForTests(): void {
  _resolveGatedTools = () => CONSEQUENTIAL_DECISION_TOOLS;
}

/** The set the gate is currently enforcing. */
export function gatedToolNames(): ReadonlySet<string> {
  return _resolveGatedTools();
}

/** A principle_decide consultation clears the gate for this long. */
export const CONSULT_WINDOW_MS = 30 * 60 * 1000;

const DENY_GUIDANCE =
  "Decision-routing gate (BI-B22DE548): a consequential act is being taken with no kernel consultation in this session. " +
  "consult-scopes-before-asking is a commandment — call principle_decide (dpf-decision-via-kernel / WWMD) to weigh the outcome first, then retry. " +
  "Act on a high-confidence recommendation; only escalate to a human on low confidence or a commandment conflict. " +
  "Operator override: set DPF_DECISION_GATE_MODE=shadow (audit-only) or off.";

export function resolveDecisionGateMode(
  env: Record<string, string | undefined> = process.env,
): DecisionGateMode {
  const raw = (env.DPF_DECISION_GATE_MODE ?? "enforce").trim().toLowerCase();
  return raw === "shadow" || raw === "off" ? raw : "enforce";
}

/** ToolResult is a success when `success === true`. */
function isSuccessResult(result: unknown): boolean {
  return Boolean(result && typeof result === "object" && (result as { success?: unknown }).success === true);
}

// ── in-process consultation ledger ───────────────────────────────────────────
const _lastConsultAtMs = new Map<string, number>();

export function recordConsultation(userId: string, atMs: number): void {
  if (userId) _lastConsultAtMs.set(userId, atMs);
}

export function hasRecentConsultation(userId: string, nowMs: number): boolean {
  const t = _lastConsultAtMs.get(userId);
  return typeof t === "number" && nowMs - t <= CONSULT_WINDOW_MS && nowMs - t >= 0;
}

/** Test seam — clear the in-process ledger between cases. */
export function _resetConsultationLedgerForTests(): void {
  _lastConsultAtMs.clear();
}

/**
 * Is this event a consequential decision-action on the in-portal/Build-Studio
 * surface? (The only surface + tool class this gate governs.)
 */
export function isGovernedDecisionAction(event: Pick<ToolLifecycleEvent, "toolName" | "source">): boolean {
  return event.source === "agentic-loop" && gatedToolNames().has(event.toolName);
}

/**
 * Pure pre-tool decision. Exported for unit tests.
 * Returns allow unless: a governed decision-action, unconsulted, in enforce mode.
 */
export function decidePreTool(
  event: Pick<ToolLifecycleEvent, "toolName" | "source">,
  opts: { mode: DecisionGateMode; hasConsult: boolean },
): ToolLifecycleDecision {
  if (opts.mode === "off") return { decision: "allow" };
  if (!isGovernedDecisionAction(event)) return { decision: "allow" };
  if (opts.hasConsult) return { decision: "allow" };
  if (opts.mode === "shadow") return { decision: "allow", reason: "decision-routing: shadow (unconsulted, audit-only)" };
  return { decision: "deny", reason: DENY_GUIDANCE };
}

function emitAuditSignal(event: ToolLifecycleEvent, mode: DecisionGateMode): void {
  // Structured, tainted-format-safe (mirrors runPostToolHooks logging style).
  console.warn(
    "[decision-routing-gate] unconsulted consequential decision mode=%s tool=%s user=%s agent=%s",
    JSON.stringify(mode),
    JSON.stringify(event.toolName),
    JSON.stringify(event.userId),
    JSON.stringify(event.context?.agentId ?? null),
  );
}

/**
 * Build the plane-2 decision-routing governance hook. `deps` is a test seam.
 */
export function createDecisionRoutingGovernanceHook(deps: {
  now?: () => number;
  mode?: DecisionGateMode;
} = {}): ToolLifecycleHook {
  const now = deps.now ?? (() => Date.now());
  return {
    id: "decision-routing-governance",
    onPreToolUse: (event: ToolLifecycleEvent): ToolLifecycleDecision => {
      try {
        const mode = deps.mode ?? resolveDecisionGateMode();
        const consulted = hasRecentConsultation(event.userId, now());
        if (isGovernedDecisionAction(event) && !consulted && mode !== "off") {
          emitAuditSignal(event, mode);
        }
        return decidePreTool(event, { mode, hasConsult: consulted });
      } catch {
        return { decision: "allow" }; // fail open — never wedge the loop
      }
    },
    onPostToolUse: (event: ToolLifecyclePostEvent): void => {
      try {
        if (event.toolName === "principle_decide" && isSuccessResult(event.result)) {
          recordConsultation(event.userId, now());
        }
      } catch {
        /* fail silent — recording is best-effort */
      }
    },
  };
}
