/**
 * Runtime kernel-commandment enforcement gate.
 *
 * Spec: docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md
 * Plan: docs/superpowers/plans/2026-05-24-runtime-kernel-commandments-slice-1.md
 *
 * Pure module — no I/O, no logging side effects. Callers (the API route,
 * the MCP dispatcher, the shell guard) load principles via the loader in
 * apps/web/lib/kernel/load-enforceable-principles.ts and pass them in.
 *
 * Companion to apps/web/lib/wiki/principle-decide.ts:
 *   - principle-decide:  decision-time scoring (rank options)
 *   - runtime-gate:      execution-time veto (allow/confirm/refuse)
 * Same registry, orthogonal evaluation moments.
 */

export type ExecutionAttempt =
  | { kind: "shell"; command: string; args: string[] }
  | { kind: "mcp_tool"; toolName: string; arguments: unknown }
  | { kind: "sql"; statement: string }
  | { kind: "git"; subcommand: string; args: string[] };

export type SessionClass = "interactive" | "autonomous";
export type EnforcementMode = "warn" | "confirm" | "refuse";

export type EnforceablePattern =
  | { kind: "shell"; regex: string; rationale: string }
  | { kind: "mcp_tool"; toolName: string; rationale: string }
  | { kind: "sql"; regex: string; rationale: string }
  | { kind: "git"; regex: string; rationale: string };

export type EnforceablePrinciple = {
  id: string;
  slug: string;
  tier: "commandment" | "core" | "contextual";
  runtime: {
    interactiveMode: EnforcementMode;
    autonomousMode: EnforcementMode;
    patterns: EnforceablePattern[];
  };
};

export type GateDecision =
  | { verdict: "allow" }
  | {
      verdict: "require_confirm";
      principleId: string;
      principleSlug: string;
      rationale: string;
      requiredPhrase: string;
    }
  | {
      verdict: "refuse";
      principleId: string;
      principleSlug: string;
      rationale: string;
    };

export function evaluateExecution(
  _attempt: ExecutionAttempt,
  _sessionClass: SessionClass,
  principles: EnforceablePrinciple[],
): GateDecision {
  if (principles.length === 0) return { verdict: "allow" };
  // Real matching arrives in Task 1.2+; for the empty-registry case we already
  // satisfy the spec contract ("allow when nothing registered").
  return { verdict: "allow" };
}
