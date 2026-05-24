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

/**
 * JavaScript's RegExp constructor does NOT support inline flags like `(?i)`.
 * Authors of principle patterns (especially SQL ones) commonly use `(?i)` to
 * express case-insensitivity, so we strip a leading `(?<flags>)` prefix and
 * lift it to the constructor's flags argument. Multi-prefix (`(?im)`,
 * `(?is)`, etc.) is supported; embedded mid-pattern inline flags are NOT
 * (treated as a regex syntax error, returns false from safeTest).
 */
function compileRegex(rawPattern: string): RegExp {
  const inlineFlagMatch = rawPattern.match(/^\(\?([a-z]+)\)/);
  if (inlineFlagMatch) {
    const flags = inlineFlagMatch[1];
    const body = rawPattern.slice(inlineFlagMatch[0].length);
    return new RegExp(body, flags);
  }
  return new RegExp(rawPattern);
}

function safeTest(regex: string, input: string): boolean {
  try {
    return compileRegex(regex).test(input);
  } catch {
    // Malformed regex never matches. Authors are protected by the
    // ingest-time lint detector (lib/wiki/principle-lint-detectors.ts).
    return false;
  }
}

function matchShell(a: Extract<ExecutionAttempt, { kind: "shell" }>, p: EnforceablePattern): boolean {
  return p.kind === "shell" && safeTest(p.regex, rebuildShell(a));
}

function matchMcpTool(a: Extract<ExecutionAttempt, { kind: "mcp_tool" }>, p: EnforceablePattern): boolean {
  return p.kind === "mcp_tool" && p.toolName === a.toolName;
}

function matchSql(a: Extract<ExecutionAttempt, { kind: "sql" }>, p: EnforceablePattern): boolean {
  return p.kind === "sql" && safeTest(p.regex, a.statement);
}

function matchGit(a: Extract<ExecutionAttempt, { kind: "git" }>, p: EnforceablePattern): boolean {
  return p.kind === "git" && safeTest(p.regex, [a.subcommand, ...a.args].join(" "));
}

function matches(attempt: ExecutionAttempt, pattern: EnforceablePattern): boolean {
  switch (attempt.kind) {
    case "shell":    return matchShell(attempt, pattern);
    case "mcp_tool": return matchMcpTool(attempt, pattern);
    case "sql":      return matchSql(attempt, pattern);
    case "git":      return matchGit(attempt, pattern);
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

// Tier-tie resolution: when multiple principles match the same attempt,
// the highest tier wins; among equal tiers the most restrictive mode wins
// (refuse > confirm > warn). Among equal tier AND equal mode, the
// first-in-array wins (deterministic ordering — callers can rely on it).
const TIER_WEIGHT = { commandment: 3, core: 2, contextual: 1 } as const;
const MODE_WEIGHT = { refuse: 3, confirm: 2, warn: 1 } as const;

type Match = {
  principle: EnforceablePrinciple;
  pattern: EnforceablePattern;
  mode: EnforcementMode;
  /** Original array index — preserved for deterministic equal-tier+mode ordering. */
  index: number;
};

export function evaluateExecution(
  attempt: ExecutionAttempt,
  sessionClass: SessionClass,
  principles: EnforceablePrinciple[],
): GateDecision {
  if (principles.length === 0) return { verdict: "allow" };

  const collected: Match[] = [];
  for (let i = 0; i < principles.length; i++) {
    const principle = principles[i];
    for (const pattern of principle.runtime.patterns) {
      if (matches(attempt, pattern)) {
        collected.push({ principle, pattern, mode: modeFor(principle, sessionClass), index: i });
      }
    }
  }
  if (collected.length === 0) return { verdict: "allow" };

  collected.sort((a, b) => {
    const t = TIER_WEIGHT[b.principle.tier] - TIER_WEIGHT[a.principle.tier];
    if (t !== 0) return t;
    const m = MODE_WEIGHT[b.mode] - MODE_WEIGHT[a.mode];
    if (m !== 0) return m;
    return a.index - b.index;  // deterministic: earlier-in-array wins on ties
  });

  const w = collected[0];
  const rationale = "rationale" in w.pattern ? w.pattern.rationale : "";

  if (w.mode === "refuse") {
    return { verdict: "refuse", principleId: w.principle.id, principleSlug: w.principle.slug, rationale };
  }
  if (w.mode === "confirm") {
    return {
      verdict: "require_confirm",
      principleId: w.principle.id,
      principleSlug: w.principle.slug,
      rationale,
      requiredPhrase: makeRequiredPhrase(w.principle.slug),
    };
  }
  // warn mode: still allow at runtime; caller emits telemetry separately.
  return { verdict: "allow" };
}
