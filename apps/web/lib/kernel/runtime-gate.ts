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

function rebuildShell(a: Extract<ExecutionAttempt, { kind: "shell" }>): string {
  return [a.command, ...a.args].join(" ");
}

function matchShell(
  a: Extract<ExecutionAttempt, { kind: "shell" }>,
  p: EnforceablePattern,
): boolean {
  if (p.kind !== "shell") return false;
  try {
    return new RegExp(p.regex).test(rebuildShell(a));
  } catch {
    // Malformed regex never matches. Authors are protected by the
    // ingest-time lint detector (lib/wiki/principle-lint-detectors.ts).
    return false;
  }
}

function modeFor(p: EnforceablePrinciple, sc: SessionClass): EnforcementMode {
  return sc === "autonomous" ? p.runtime.autonomousMode : p.runtime.interactiveMode;
}

function generateConfirmationToken(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const buf = new Uint8Array(4);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join("");
}

function makeRequiredPhrase(slug: string): string {
  return `I-MEAN-IT-${slug}-${generateConfirmationToken()}`;
}

export function evaluateExecution(
  attempt: ExecutionAttempt,
  sessionClass: SessionClass,
  principles: EnforceablePrinciple[],
): GateDecision {
  if (principles.length === 0) return { verdict: "allow" };

  for (const principle of principles) {
    for (const pattern of principle.runtime.patterns) {
      const matched = attempt.kind === "shell" && matchShell(attempt, pattern);
      if (!matched) continue;
      const mode = modeFor(principle, sessionClass);
      const rationale = "rationale" in pattern ? pattern.rationale : "";
      if (mode === "refuse") {
        return { verdict: "refuse", principleId: principle.id, principleSlug: principle.slug, rationale };
      }
      if (mode === "confirm") {
        return {
          verdict: "require_confirm",
          principleId: principle.id,
          principleSlug: principle.slug,
          rationale,
          requiredPhrase: makeRequiredPhrase(principle.slug),
        };
      }
      // warn handled in Task 1.6 (still allows, caller logs)
    }
  }
  return { verdict: "allow" };
}
