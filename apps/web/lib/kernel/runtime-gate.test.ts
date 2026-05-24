import { describe, expect, it } from "vitest";
import { evaluateExecution, type EnforceablePrinciple } from "./runtime-gate";

const NEVER_WIPE_DB: EnforceablePrinciple = {
  id: "p1",
  slug: "never-wipe-db-for-code-fixes",
  tier: "commandment",
  runtime: {
    interactiveMode: "confirm",
    autonomousMode: "refuse",
    patterns: [
      { kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "Wipes operator state" },
    ],
  },
};

describe("evaluateExecution — empty registry", () => {
  it("allows everything when no principles are registered", () => {
    expect(
      evaluateExecution(
        { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
        "interactive",
        [],
      ),
    ).toEqual({ verdict: "allow" });
  });
});

describe("evaluateExecution — shell refuse (autonomous)", () => {
  it("refuses a shell command matching a commandment in autonomous mode", () => {
    const d = evaluateExecution(
      { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
      "autonomous",
      [NEVER_WIPE_DB],
    );
    expect(d.verdict).toBe("refuse");
    if (d.verdict === "refuse") {
      expect(d.principleSlug).toBe("never-wipe-db-for-code-fixes");
      expect(d.rationale).toContain("Wipes operator state");
    }
  });

  it("allows a non-matching shell command", () => {
    expect(
      evaluateExecution(
        { kind: "shell", command: "docker", args: ["ps"] },
        "autonomous",
        [NEVER_WIPE_DB],
      ),
    ).toEqual({ verdict: "allow" });
  });

  it("returns require_confirm in interactive mode with a typed phrase", () => {
    const d = evaluateExecution(
      { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
      "interactive",
      [NEVER_WIPE_DB],
    );
    expect(d.verdict).toBe("require_confirm");
    if (d.verdict === "require_confirm") {
      expect(d.requiredPhrase).toMatch(
        /^I-MEAN-IT-never-wipe-db-for-code-fixes-[A-Z0-9]{4}$/,
      );
    }
  });
});

// ─── Task 1.4: MCP-tool pattern matching ────────────────────────────────────

const MCP_TOOL_BLOCKED: EnforceablePrinciple = {
  id: "p2",
  slug: "never-wipe-db-for-code-fixes",
  tier: "commandment",
  runtime: {
    interactiveMode: "confirm",
    autonomousMode: "refuse",
    patterns: [
      { kind: "mcp_tool", toolName: "prisma_migrate_reset", rationale: "Drops + recreates schema" },
    ],
  },
};

describe("evaluateExecution — mcp_tool", () => {
  it("refuses a matching mcp_tool attempt in autonomous mode", () => {
    expect(
      evaluateExecution(
        { kind: "mcp_tool", toolName: "prisma_migrate_reset", arguments: {} },
        "autonomous",
        [MCP_TOOL_BLOCKED],
      ).verdict,
    ).toBe("refuse");
  });

  it("allows a non-matching mcp_tool attempt", () => {
    expect(
      evaluateExecution(
        { kind: "mcp_tool", toolName: "list_backlog_items", arguments: {} },
        "autonomous",
        [MCP_TOOL_BLOCKED],
      ),
    ).toEqual({ verdict: "allow" });
  });
});

// ─── Task 1.5: SQL + git pattern matching ───────────────────────────────────

const SQL_GUARD: EnforceablePrinciple = {
  id: "p3",
  slug: "never-wipe-db-for-code-fixes",
  tier: "commandment",
  runtime: {
    interactiveMode: "confirm",
    autonomousMode: "refuse",
    patterns: [
      { kind: "sql", regex: "(?i)^\\s*DROP\\s+DATABASE\\s+dpf\\b", rationale: "Drops production DB" },
    ],
  },
};

const GIT_GUARD: EnforceablePrinciple = {
  id: "p4",
  slug: "destructive-actions-require-explicit-go",
  tier: "commandment",
  runtime: {
    interactiveMode: "confirm",
    autonomousMode: "refuse",
    patterns: [
      { kind: "git", regex: "^push\\s+.*--force.*\\bmain\\b", rationale: "Force-push to main" },
    ],
  },
};

describe("evaluateExecution — sql + git", () => {
  it("matches SQL case-insensitively", () => {
    expect(
      evaluateExecution(
        { kind: "sql", statement: "drop database dpf" },
        "autonomous",
        [SQL_GUARD],
      ).verdict,
    ).toBe("refuse");
  });

  it("matches git subcommand+flags", () => {
    expect(
      evaluateExecution(
        { kind: "git", subcommand: "push", args: ["--force", "origin", "main"] },
        "autonomous",
        [GIT_GUARD],
      ).verdict,
    ).toBe("refuse");
  });
});

// ─── Task 1.6: tier-tie + restrictiveness + warn + determinism ──────────────

const CONTEXTUAL_CONFIRM: EnforceablePrinciple = {
  id: "pc",
  slug: "low-tier",
  tier: "contextual",
  runtime: {
    interactiveMode: "confirm",
    autonomousMode: "confirm",
    patterns: [{ kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "tier=contextual" }],
  },
};

const EQUAL_TIER_WARN: EnforceablePrinciple = {
  id: "eq",
  slug: "warn-only",
  tier: "commandment",
  runtime: {
    interactiveMode: "warn",
    autonomousMode: "warn",
    patterns: [{ kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "warn-tier" }],
  },
};

const WARN_ONLY: EnforceablePrinciple = {
  id: "pw",
  slug: "noisy-but-allowed",
  tier: "core",
  runtime: {
    interactiveMode: "warn",
    autonomousMode: "warn",
    patterns: [{ kind: "shell", regex: "^docker\\s+", rationale: "any docker call" }],
  },
};

describe("evaluateExecution — tier + restrictiveness", () => {
  it("higher tier wins over lower tier", () => {
    const d = evaluateExecution(
      { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
      "autonomous",
      [CONTEXTUAL_CONFIRM, NEVER_WIPE_DB],
    );
    expect(d.verdict).toBe("refuse");
    if (d.verdict === "refuse") expect(d.principleSlug).toBe("never-wipe-db-for-code-fixes");
  });

  it("equal-tier, more-restrictive mode wins", () => {
    expect(
      evaluateExecution(
        { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
        "autonomous",
        [EQUAL_TIER_WARN, NEVER_WIPE_DB],
      ).verdict,
    ).toBe("refuse");
  });

  it("warn mode does NOT block in slice 1 (telemetry only — emitted by callers)", () => {
    expect(
      evaluateExecution(
        { kind: "shell", command: "docker", args: ["ps"] },
        "interactive",
        [WARN_ONLY],
      ),
    ).toEqual({ verdict: "allow" });
  });

  it("equal tier + equal mode: first-in-array wins (deterministic ordering)", () => {
    const A: EnforceablePrinciple = {
      id: "a", slug: "principle-a", tier: "commandment",
      runtime: { interactiveMode: "refuse", autonomousMode: "refuse",
        patterns: [{ kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "first" }] },
    };
    const B: EnforceablePrinciple = {
      id: "b", slug: "principle-b", tier: "commandment",
      runtime: { interactiveMode: "refuse", autonomousMode: "refuse",
        patterns: [{ kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "second" }] },
    };
    const d = evaluateExecution(
      { kind: "shell", command: "docker", args: ["volume", "rm", "x"] },
      "autonomous",
      [A, B],
    );
    expect(d.verdict).toBe("refuse");
    if (d.verdict === "refuse") expect(d.principleSlug).toBe("principle-a");
  });
});
