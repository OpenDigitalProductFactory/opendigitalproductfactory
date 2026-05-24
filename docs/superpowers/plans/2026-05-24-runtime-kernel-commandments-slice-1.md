# Runtime Kernel Commandments — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add execution-time enforcement of tier-1 kernel commandments via a pure gate module that consults the existing principle wiki registry; wire shell + MCP dispatcher integrations; ship one fully-enforced commandment (`never-wipe-db-for-code-fixes`).

**Architecture:** New pure module `apps/web/lib/kernel/runtime-gate.ts` exposes `evaluateExecution(attempt, sessionClass, principles) → GateDecision`. Frontmatter extension `principleRuntimeEnforcement` on principle pages makes them executable. Shell-guard binaries on `$PATH` and one call site in `executeTool` are the slice-1 integration surfaces. The existing decision-time substrate at `apps/web/lib/wiki/principle-decide.ts` is untouched — orthogonal evaluation moments.

**Tech Stack:** TypeScript / Vitest / Next.js 15 app router (API route) / POSIX sh + PowerShell 5.1 (shell guard) / Prisma (registry read via `@dpf/db`)

**Spec:** `docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md` (PR #1068)
**BI:** BI-43F95F77 (EP-DR-HARDENING-2026-05-23)

---

## Substrate orientation (read before starting)

Files the implementer should skim to anchor on existing patterns:

- `apps/web/lib/wiki/principle-decide.ts` — pure decision math; the model for the gate's pure-function shape.
- `apps/web/lib/wiki/principle-recall.ts` — how principles get loaded from Postgres; uses `listPrinciplesByTier`.
- `packages/db/src/wiki-frontmatter.ts` — hand-rolled YAML subset parser. **Important:** supports scalars, inline arrays, block-style string lists, AND single-line inline JSON objects (`key: {"a":1,...}`) — but does NOT support nested YAML blocks or lists-of-objects. The plan works around this by authoring `principleRuntimeEnforcement` as a single inline-JSON value (ugly but parser-compatible; nested-block authoring is a separate parser-extension PR if/when more keys want it).
- `packages/db/prisma/schema.prisma:7974-8027` — `WikiPage` model. We add ONE new column: `principleRuntimeEnforcement Json?`.
- `apps/web/lib/mcp-tools.ts:4187` — `executeTool(toolName, rawParams, userId, context?)` signature; gate hook lands BEFORE the switch.
- `apps/web/app/api/health/route.ts` — minimal route exemplar. **Note:** project convention is `Response.json(...)` (web-standard), NOT `NextResponse.json`. Verify against `apps/web/app/api/quality/report/route.ts` for a POST exemplar.
- `apps/web/lib/operate/backups/postgres-restore-runner.test.ts` — vitest patterns including `vi.mock("@dpf/db", …)` for DB isolation.
- `scripts/backup-neo4j.sh` — POSIX shell-script pattern, uses `jq` not `python3` for JSON.
- `docs/founder-kernel/wiki/principles/never-wipe-db-for-code-fixes.md` — first commandment to wire.
- `packages/db/src/seed-wiki-kernel.ts` — seed walker that propagates frontmatter to DB; updated in Task 2.2.

---

## Phase 1 — Pure gate module (TDD)

### Task 1.1: Scaffold types + first failing test (empty registry → allow)

**Files:**
- Create: `apps/web/lib/kernel/runtime-gate.ts`
- Test: `apps/web/lib/kernel/runtime-gate.test.ts`

- [ ] **Step 1: Create scaffold with full type surface + stub implementation**

```typescript
// apps/web/lib/kernel/runtime-gate.ts

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
  | { kind: "shell";    regex: string;    rationale: string }
  | { kind: "mcp_tool"; toolName: string; rationale: string }
  | { kind: "sql";      regex: string;    rationale: string }
  | { kind: "git";      regex: string;    rationale: string };

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
  | { verdict: "require_confirm"; principleId: string; principleSlug: string; rationale: string; requiredPhrase: string }
  | { verdict: "refuse"; principleId: string; principleSlug: string; rationale: string };

export function evaluateExecution(
  _attempt: ExecutionAttempt,
  _sessionClass: SessionClass,
  principles: EnforceablePrinciple[],
): GateDecision {
  if (principles.length === 0) return { verdict: "allow" };
  return { verdict: "allow" };  // real matching arrives in Task 1.2+
}
```

- [ ] **Step 2: Write failing test for empty-registry case**

```typescript
// apps/web/lib/kernel/runtime-gate.test.ts
import { describe, expect, it } from "vitest";
import { evaluateExecution, type EnforceablePrinciple } from "./runtime-gate";

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
```

- [ ] **Step 3: Run** — `cd apps/web && pnpm exec vitest run lib/kernel/runtime-gate.test.ts` — expect PASS (stub allows all).
- [ ] **Step 4: skipped (already minimal-impl)**
- [ ] **Step 5: Commit** `feat(kernel): scaffold runtime-gate module`

---

### Task 1.2: Shell pattern matching — refuse (autonomous mode)

**Files:**
- Modify: `apps/web/lib/kernel/runtime-gate.ts`
- Test: `apps/web/lib/kernel/runtime-gate.test.ts`

- [ ] **Step 1: Add failing tests for refuse + non-match**

```typescript
const NEVER_WIPE_DB: EnforceablePrinciple = {
  id: "p1", slug: "never-wipe-db-for-code-fixes", tier: "commandment",
  runtime: {
    interactiveMode: "confirm", autonomousMode: "refuse",
    patterns: [
      { kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "Wipes operator state" },
    ],
  },
};

describe("evaluateExecution — shell refuse", () => {
  it("refuses a shell command matching a commandment in autonomous mode", () => {
    const d = evaluateExecution(
      { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
      "autonomous", [NEVER_WIPE_DB],
    );
    expect(d.verdict).toBe("refuse");
    if (d.verdict === "refuse") {
      expect(d.principleSlug).toBe("never-wipe-db-for-code-fixes");
      expect(d.rationale).toContain("Wipes operator state");
    }
  });

  it("allows a non-matching shell command", () => {
    expect(
      evaluateExecution({ kind: "shell", command: "docker", args: ["ps"] }, "autonomous", [NEVER_WIPE_DB]),
    ).toEqual({ verdict: "allow" });
  });
});
```

- [ ] **Step 2: Run, expect 2 failures**
- [ ] **Step 3: Implement shell matcher + refuse branch**

```typescript
function rebuildShell(a: Extract<ExecutionAttempt, { kind: "shell" }>): string {
  return [a.command, ...a.args].join(" ");
}

function matchShell(a: Extract<ExecutionAttempt, { kind: "shell" }>, p: EnforceablePattern): boolean {
  if (p.kind !== "shell") return false;
  try { return new RegExp(p.regex).test(rebuildShell(a)); } catch { return false; }
}

function modeFor(p: EnforceablePrinciple, sc: SessionClass): EnforcementMode {
  return sc === "autonomous" ? p.runtime.autonomousMode : p.runtime.interactiveMode;
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
      if (mode === "refuse") {
        return {
          verdict: "refuse",
          principleId: principle.id,
          principleSlug: principle.slug,
          rationale: "rationale" in pattern ? pattern.rationale : "",
        };
      }
      // confirm / warn handled in Task 1.3 + 1.6
    }
  }
  return { verdict: "allow" };
}
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(kernel): shell pattern matching + refuse verdict`

---

### Task 1.3: require_confirm path + typed-confirmation phrase

**Files:**
- Modify: `apps/web/lib/kernel/runtime-gate.ts`
- Test: `apps/web/lib/kernel/runtime-gate.test.ts`

- [ ] **Step 1: Add failing test**

```typescript
it("returns require_confirm in interactive mode with a typed phrase", () => {
  const d = evaluateExecution(
    { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
    "interactive", [NEVER_WIPE_DB],
  );
  expect(d.verdict).toBe("require_confirm");
  if (d.verdict === "require_confirm") {
    expect(d.requiredPhrase).toMatch(/^I-MEAN-IT-never-wipe-db-for-code-fixes-[A-Z0-9]{4}$/);
  }
});
```

- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Add phrase generator + confirm branch**

```typescript
function generateConfirmationToken(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const buf = new Uint8Array(4);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join("");
}

function makeRequiredPhrase(slug: string): string {
  return `I-MEAN-IT-${slug}-${generateConfirmationToken()}`;
}

// Inside the match block, after the refuse branch:
if (mode === "confirm") {
  return {
    verdict: "require_confirm",
    principleId: principle.id,
    principleSlug: principle.slug,
    rationale: "rationale" in pattern ? pattern.rationale : "",
    requiredPhrase: makeRequiredPhrase(principle.slug),
  };
}
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(kernel): require_confirm verdict + typed-phrase generation`

---

### Task 1.4: MCP-tool pattern matching

**Files:**
- Modify: `apps/web/lib/kernel/runtime-gate.ts`
- Test: `apps/web/lib/kernel/runtime-gate.test.ts`

- [ ] **Step 1: Failing tests for mcp_tool match + non-match**

```typescript
const MCP_TOOL_BLOCKED: EnforceablePrinciple = {
  id: "p2", slug: "never-wipe-db-for-code-fixes", tier: "commandment",
  runtime: {
    interactiveMode: "confirm", autonomousMode: "refuse",
    patterns: [{ kind: "mcp_tool", toolName: "prisma_migrate_reset", rationale: "Drops + recreates schema" }],
  },
};

it("refuses a matching mcp_tool attempt in autonomous mode", () => {
  expect(
    evaluateExecution({ kind: "mcp_tool", toolName: "prisma_migrate_reset", arguments: {} }, "autonomous", [MCP_TOOL_BLOCKED]).verdict,
  ).toBe("refuse");
});

it("allows a non-matching mcp_tool attempt", () => {
  expect(
    evaluateExecution({ kind: "mcp_tool", toolName: "list_backlog_items", arguments: {} }, "autonomous", [MCP_TOOL_BLOCKED]),
  ).toEqual({ verdict: "allow" });
});
```

- [ ] **Step 2: Run, expect 2 FAIL**
- [ ] **Step 3: Add MCP matcher and extend the matched condition**

```typescript
function matchMcpTool(a: Extract<ExecutionAttempt, { kind: "mcp_tool" }>, p: EnforceablePattern): boolean {
  return p.kind === "mcp_tool" && p.toolName === a.toolName;
}

// In the loop body, replace the single shell check with:
const matched =
  (attempt.kind === "shell"    && matchShell(attempt, pattern)) ||
  (attempt.kind === "mcp_tool" && matchMcpTool(attempt, pattern));
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(kernel): mcp_tool pattern matching`

---

### Task 1.5: SQL + git pattern matching

**Files:** same as Task 1.4

- [ ] **Step 1: Failing tests for SQL (case-insensitive) + git**

```typescript
const SQL_GUARD: EnforceablePrinciple = {
  id: "p3", slug: "never-wipe-db-for-code-fixes", tier: "commandment",
  runtime: { interactiveMode: "confirm", autonomousMode: "refuse",
    patterns: [{ kind: "sql", regex: "(?i)^\\s*DROP\\s+DATABASE\\s+dpf\\b", rationale: "Drops production DB" }] },
};

const GIT_GUARD: EnforceablePrinciple = {
  id: "p4", slug: "destructive-actions-require-explicit-go", tier: "commandment",
  runtime: { interactiveMode: "confirm", autonomousMode: "refuse",
    patterns: [{ kind: "git", regex: "^push\\s+.*--force.*\\bmain\\b", rationale: "Force-push to main" }] },
};

it("matches SQL case-insensitively", () => {
  expect(evaluateExecution({ kind: "sql", statement: "drop database dpf" }, "autonomous", [SQL_GUARD]).verdict).toBe("refuse");
});

it("matches git subcommand+flags", () => {
  expect(evaluateExecution({ kind: "git", subcommand: "push", args: ["--force", "origin", "main"] }, "autonomous", [GIT_GUARD]).verdict).toBe("refuse");
});
```

- [ ] **Step 2: Run, expect 2 FAIL**
- [ ] **Step 3: Add matchers + extend the matched expression**

```typescript
function matchSql(a: Extract<ExecutionAttempt, { kind: "sql" }>, p: EnforceablePattern): boolean {
  if (p.kind !== "sql") return false;
  try { return new RegExp(p.regex).test(a.statement); } catch { return false; }
}
function matchGit(a: Extract<ExecutionAttempt, { kind: "git" }>, p: EnforceablePattern): boolean {
  if (p.kind !== "git") return false;
  try { return new RegExp(p.regex).test([a.subcommand, ...a.args].join(" ")); } catch { return false; }
}

const matched =
  (attempt.kind === "shell"    && matchShell(attempt, pattern)) ||
  (attempt.kind === "mcp_tool" && matchMcpTool(attempt, pattern)) ||
  (attempt.kind === "sql"      && matchSql(attempt, pattern)) ||
  (attempt.kind === "git"      && matchGit(attempt, pattern));
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(kernel): sql + git pattern matching`

---

### Task 1.6: Tier-tie resolution + restrictiveness ordering + warn mode

**Files:** same

- [ ] **Step 1: Failing tests covering all three scoring rules**

```typescript
const CONTEXTUAL_CONFIRM: EnforceablePrinciple = {
  id: "pc", slug: "low-tier", tier: "contextual",
  runtime: { interactiveMode: "confirm", autonomousMode: "confirm",
    patterns: [{ kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "tier=contextual" }] },
};

const EQUAL_TIER_WARN: EnforceablePrinciple = {
  id: "eq", slug: "warn-only", tier: "commandment",
  runtime: { interactiveMode: "warn", autonomousMode: "warn",
    patterns: [{ kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "warn-tier" }] },
};

const WARN_ONLY: EnforceablePrinciple = {
  id: "pw", slug: "noisy-but-allowed", tier: "core",
  runtime: { interactiveMode: "warn", autonomousMode: "warn",
    patterns: [{ kind: "shell", regex: "^docker\\s+", rationale: "any docker call" }] },
};

describe("evaluateExecution — tier + restrictiveness", () => {
  it("higher tier wins over lower tier", () => {
    const d = evaluateExecution(
      { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
      "autonomous", [CONTEXTUAL_CONFIRM, NEVER_WIPE_DB],
    );
    expect(d.verdict).toBe("refuse");
    if (d.verdict === "refuse") expect(d.principleSlug).toBe("never-wipe-db-for-code-fixes");
  });
  it("equal-tier, more-restrictive mode wins", () => {
    expect(
      evaluateExecution(
        { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
        "autonomous", [EQUAL_TIER_WARN, NEVER_WIPE_DB],
      ).verdict,
    ).toBe("refuse");
  });
  it("warn mode does NOT block in slice 1 (telemetry only — emitted by callers)", () => {
    expect(
      evaluateExecution({ kind: "shell", command: "docker", args: ["ps"] }, "interactive", [WARN_ONLY]),
    ).toEqual({ verdict: "allow" });
  });

  it("equal tier + equal mode: first-in-array wins (deterministic ordering)", () => {
    const A: EnforceablePrinciple = { id: "a", slug: "principle-a", tier: "commandment",
      runtime: { interactiveMode: "refuse", autonomousMode: "refuse",
        patterns: [{ kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "first" }] } };
    const B: EnforceablePrinciple = { id: "b", slug: "principle-b", tier: "commandment",
      runtime: { interactiveMode: "refuse", autonomousMode: "refuse",
        patterns: [{ kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "second" }] } };
    const d = evaluateExecution(
      { kind: "shell", command: "docker", args: ["volume", "rm", "x"] },
      "autonomous", [A, B],
    );
    expect(d.verdict).toBe("refuse");
    if (d.verdict === "refuse") expect(d.principleSlug).toBe("principle-a");
  });
});
```

- [ ] **Step 2: Run, expect 3 FAIL (first-match-wins is in place from Task 1.2)**
- [ ] **Step 3: Refactor to collect ALL matches then pick winner by tier × restrictiveness**

```typescript
const TIER_WEIGHT = { commandment: 3, core: 2, contextual: 1 } as const;
const MODE_WEIGHT = { refuse: 3, confirm: 2, warn: 1 } as const;

type Match = { principle: EnforceablePrinciple; pattern: EnforceablePattern; mode: EnforcementMode };

export function evaluateExecution(
  attempt: ExecutionAttempt,
  sessionClass: SessionClass,
  principles: EnforceablePrinciple[],
): GateDecision {
  if (principles.length === 0) return { verdict: "allow" };

  const matches: Match[] = [];
  for (const principle of principles) {
    for (const pattern of principle.runtime.patterns) {
      const matched =
        (attempt.kind === "shell"    && matchShell(attempt, pattern)) ||
        (attempt.kind === "mcp_tool" && matchMcpTool(attempt, pattern)) ||
        (attempt.kind === "sql"      && matchSql(attempt, pattern)) ||
        (attempt.kind === "git"      && matchGit(attempt, pattern));
      if (matched) matches.push({ principle, pattern, mode: modeFor(principle, sessionClass) });
    }
  }
  if (matches.length === 0) return { verdict: "allow" };

  matches.sort((a, b) => {
    const t = TIER_WEIGHT[b.principle.tier] - TIER_WEIGHT[a.principle.tier];
    if (t !== 0) return t;
    return MODE_WEIGHT[b.mode] - MODE_WEIGHT[a.mode];
  });

  const w = matches[0];
  const rationale = "rationale" in w.pattern ? w.pattern.rationale : "";
  if (w.mode === "refuse") return { verdict: "refuse", principleId: w.principle.id, principleSlug: w.principle.slug, rationale };
  if (w.mode === "confirm") return { verdict: "require_confirm", principleId: w.principle.id, principleSlug: w.principle.slug, rationale, requiredPhrase: makeRequiredPhrase(w.principle.slug) };
  return { verdict: "allow" };  // warn — caller logs separately
}
```

- [ ] **Step 4: Run all gate tests + `pnpm exec vitest run lib/kernel/runtime-gate.test.ts --coverage` — expect PASS, branch coverage ≥95%**
- [ ] **Step 5: Commit** `feat(kernel): tier-tie resolution + restrictiveness ordering + warn-mode pass-through`

---

## Phase 2 — Frontmatter extension + schema + registry loading

### Task 2.0: Prisma migration — add `principleRuntimeEnforcement` column

**Files:**
- Modify: `packages/db/prisma/schema.prisma:7998-8027`
- Create: `packages/db/prisma/migrations/<timestamp>_add_principle_runtime_enforcement/migration.sql`

- [ ] **Step 1: Add field to `WikiPage` model** at line 8016 (alphabetical/grouped with other principle-only fields):

```prisma
  principleRuntimeEnforcement Json?   // {interactiveMode, autonomousMode, patterns[]} per spec 2026-05-24
```

- [ ] **Step 2: Generate migration** — `cd packages/db && pnpm exec prisma migrate dev --create-only --name add_principle_runtime_enforcement`. Verify the generated SQL is `ALTER TABLE "WikiPage" ADD COLUMN "principleRuntimeEnforcement" JSONB`.
- [ ] **Step 3: Apply migration locally** — `pnpm exec prisma migrate dev` (or `migrate deploy` if dev DB already in sync). Confirm the column appears via `psql -c '\d "WikiPage"'`.
- [ ] **Step 4: Regenerate client** — `pnpm exec prisma generate`.
- [ ] **Step 5: Commit** `feat(db): add WikiPage.principleRuntimeEnforcement column + migration`

> **Note:** there is no `WikiPageRevision` mirroring of principle fields today (only `payloadJson`); no revision-table change is needed.

---

### Task 2.1: Extend `WikiPageFrontmatter` type + parser-compatibility test

**Files:**
- Modify: `packages/db/src/wiki-frontmatter.ts:25-54`
- Test: `packages/db/src/wiki-frontmatter.test.ts` (create if missing)

> **Authoring constraint:** the hand-rolled parser supports single-line inline JSON (line 134 of wiki-frontmatter.ts) but NOT nested YAML blocks or list-of-objects. Authors write the whole `principleRuntimeEnforcement` value as one inline-JSON line. Ugly but parser-compatible; a separate parser-extension PR can land block-style authoring later.

- [ ] **Step 1: Failing test — inline-JSON value round-trips through `parseFrontmatter`**

```typescript
// packages/db/src/wiki-frontmatter.test.ts
import { describe, expect, it } from "vitest";
import { parseFrontmatter, type WikiPageFrontmatter } from "./wiki-frontmatter";

describe("parseFrontmatter — principleRuntimeEnforcement (inline JSON)", () => {
  it("parses a complete runtime-enforcement block", () => {
    const yaml = `---
title: Never wipe DB
pageKind: principle
principleTier: commandment
principleRuntimeEnforcement: {"interactiveMode":"confirm","autonomousMode":"refuse","patterns":[{"kind":"shell","regex":"^docker\\\\s+volume\\\\s+rm\\\\b","rationale":"wipes operator state"}]}
---
body`;
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(yaml);
    expect(frontmatter.principleRuntimeEnforcement).toEqual({
      interactiveMode: "confirm",
      autonomousMode: "refuse",
      patterns: [
        { kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "wipes operator state" },
      ],
    });
  });

  it("leaves the field undefined when absent", () => {
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(
      `---\ntitle: x\npageKind: principle\n---\nbody`,
    );
    expect(frontmatter.principleRuntimeEnforcement).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL only on type mismatch (parser already supports inline JSON; failure is the missing type field).**
- [ ] **Step 3: Add the typed field on `WikiPageFrontmatter` (NOT `RawSourceFrontmatter`)**

```typescript
// packages/db/src/wiki-frontmatter.ts — append to WikiPageFrontmatter
export type PrincipleRuntimeEnforcement = {
  interactiveMode: "warn" | "confirm" | "refuse";
  autonomousMode: "warn" | "confirm" | "refuse";
  patterns: Array<
    | { kind: "shell"; regex: string; rationale: string }
    | { kind: "mcp_tool"; toolName: string; rationale: string }
    | { kind: "sql"; regex: string; rationale: string }
    | { kind: "git"; regex: string; rationale: string }
  >;
};

export type WikiPageFrontmatter = {
  // …existing fields…
  principleRuntimeEnforcement?: PrincipleRuntimeEnforcement;
};
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(wiki-frontmatter): principleRuntimeEnforcement type via inline-JSON authoring`

---

### Task 2.2: Update seed walker to propagate the new field

**Files:**
- Modify: `packages/db/src/seed-wiki-kernel.ts` (search for where `principleTier` / `principleDimensionVector` are passed to `prisma.wikiPage.upsert`)
- Test: existing seed walker tests (extend with one fixture)

- [ ] **Step 1: Failing test — a fixture wiki page with `principleRuntimeEnforcement` should land the value into `WikiPage.principleRuntimeEnforcement`**
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: In the upsert payload, add `principleRuntimeEnforcement: frontmatter.principleRuntimeEnforcement ?? null` alongside the existing principle fields**
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(seed): propagate principleRuntimeEnforcement to WikiPage`

---

### Task 2.3: Lint detector for runtime-enforcement frontmatter

**Files:**
- Modify: `apps/web/lib/wiki/principle-lint-detectors.ts`
- Test: `apps/web/lib/wiki/principle-lint-detectors.test.ts`

- [ ] **Step 1: Failing tests for invalid regex + missing rationale + missing modes**

```typescript
it("flags invalid regex in a runtime-enforcement pattern", () => {
  const fm: WikiPageFrontmatter = { title: "x", pageKind: "principle", principleTier: "commandment",
    principleRuntimeEnforcement: { interactiveMode: "confirm", autonomousMode: "refuse",
      patterns: [{ kind: "shell", regex: "[unterminated", rationale: "x" }] } };
  const findings = lintRuntimeEnforcement(fm);
  expect(findings).toContainEqual(expect.objectContaining({ code: "runtime_enforcement_invalid_regex" }));
});

it("flags missing rationale", () => {
  const fm: WikiPageFrontmatter = { title: "x", pageKind: "principle", principleTier: "commandment",
    principleRuntimeEnforcement: { interactiveMode: "confirm", autonomousMode: "refuse",
      patterns: [{ kind: "shell", regex: "^docker\\s+ps", rationale: "" }] } };
  expect(lintRuntimeEnforcement(fm)).toContainEqual(expect.objectContaining({ code: "runtime_enforcement_missing_rationale" }));
});
```

- [ ] **Step 2: Run, expect 2 FAIL**
- [ ] **Step 3: Implement `lintRuntimeEnforcement(fm) → LintFinding[]`** — iterate `patterns`; try `new RegExp(p.regex)` for shell/sql/git kinds; require `rationale.length > 0`; require both modes ∈ {warn,confirm,refuse}.
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(wiki-lint): runtime-enforcement schema lint`

---

### Task 2.4: `loadEnforceablePrinciples()` helper with process-lifetime cache + test-hook injection

**Files:**
- Create: `apps/web/lib/kernel/load-enforceable-principles.ts`
- Test: `apps/web/lib/kernel/load-enforceable-principles.test.ts`

> **Caching:** the loader runs on every MCP dispatch and every shell-guard call. A Postgres roundtrip per dispatch is a hot-path tax we cannot pay. Slice 1 ships a process-lifetime in-memory cache (load once on first call, reuse forever); cache invalidation across wiki edits is a slice-2+ concern — for now a portal restart suffices (matches how `principle-recall` warms today). Export `__resetCacheForTest()` for vitest.
>
> **Synthetic test-tool injection:** when `process.env.DPF_TEST_MCP_REFUSE_PROBE === "1"` the loader appends ONE hardcoded synthetic principle that matches `mcp_tool` toolName `dpf_test_kernel_refuse_probe` with `refuse` mode in both session classes. This keeps Phase 9.3 live verification reproducible without contaminating the production DB. The synthetic principle is NEVER injected when the env var is absent.

- [ ] **Step 1: Failing tests covering filter, cache, and the test-hook injection**

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: { wikiPage: { findMany: vi.fn() } },
}));

import { loadEnforceablePrinciples, __resetCacheForTest } from "./load-enforceable-principles";
import { prisma } from "@dpf/db";

beforeEach(() => {
  __resetCacheForTest();
  delete process.env.DPF_TEST_MCP_REFUSE_PROBE;
  (prisma.wikiPage.findMany as ReturnType<typeof vi.fn>).mockReset();
});

it("returns only rows with non-empty runtime.patterns", async () => {
  (prisma.wikiPage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "a", slug: "with-runtime", principleTier: "commandment",
      principleRuntimeEnforcement: { interactiveMode: "confirm", autonomousMode: "refuse",
        patterns: [{ kind: "shell", regex: "^x", rationale: "x" }] } },
    { id: "b", slug: "empty-patterns", principleTier: "commandment",
      principleRuntimeEnforcement: { interactiveMode: "confirm", autonomousMode: "refuse", patterns: [] } },
    { id: "c", slug: "no-runtime", principleTier: "commandment", principleRuntimeEnforcement: null },
  ]);
  const out = await loadEnforceablePrinciples();
  expect(out.map((p) => p.slug)).toEqual(["with-runtime"]);
});

it("caches the result across calls (one Postgres query per process)", async () => {
  (prisma.wikiPage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  await loadEnforceablePrinciples();
  await loadEnforceablePrinciples();
  await loadEnforceablePrinciples();
  expect(prisma.wikiPage.findMany).toHaveBeenCalledTimes(1);
});

it("appends the synthetic probe principle only when DPF_TEST_MCP_REFUSE_PROBE=1", async () => {
  (prisma.wikiPage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  process.env.DPF_TEST_MCP_REFUSE_PROBE = "1";
  const out = await loadEnforceablePrinciples();
  expect(out.find((p) => p.slug === "__synthetic_refuse_probe__")).toBeDefined();
  const probe = out.find((p) => p.slug === "__synthetic_refuse_probe__")!;
  expect(probe.runtime.patterns).toEqual([
    { kind: "mcp_tool", toolName: "dpf_test_kernel_refuse_probe", rationale: "synthetic probe (DPF_TEST_MCP_REFUSE_PROBE)" },
  ]);
});

it("does NOT inject the synthetic probe when the env is unset", async () => {
  (prisma.wikiPage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const out = await loadEnforceablePrinciples();
  expect(out.find((p) => p.slug === "__synthetic_refuse_probe__")).toBeUndefined();
});
```

- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**

```typescript
// apps/web/lib/kernel/load-enforceable-principles.ts
import { prisma } from "@dpf/db";
import type { EnforceablePrinciple } from "./runtime-gate";

let cached: EnforceablePrinciple[] | null = null;

export function __resetCacheForTest(): void { cached = null; }

const SYNTHETIC_PROBE: EnforceablePrinciple = {
  id: "__synthetic_probe__",
  slug: "__synthetic_refuse_probe__",
  tier: "commandment",
  runtime: {
    interactiveMode: "refuse",
    autonomousMode: "refuse",
    patterns: [{ kind: "mcp_tool", toolName: "dpf_test_kernel_refuse_probe",
                 rationale: "synthetic probe (DPF_TEST_MCP_REFUSE_PROBE)" }],
  },
};

function maybeAppendSynthetic(base: EnforceablePrinciple[]): EnforceablePrinciple[] {
  return process.env.DPF_TEST_MCP_REFUSE_PROBE === "1" ? [...base, SYNTHETIC_PROBE] : base;
}

const TIER_VALUES = new Set(["commandment", "core", "contextual"]);
const MODE_VALUES = new Set(["warn", "confirm", "refuse"]);

function shapeOf(row: {
  id: string; slug: string; principleTier: string | null;
  principleRuntimeEnforcement: unknown;
}): EnforceablePrinciple | null {
  if (!row.principleTier || !TIER_VALUES.has(row.principleTier)) return null;
  const r = row.principleRuntimeEnforcement;
  if (!r || typeof r !== "object") return null;
  const obj = r as Record<string, unknown>;
  if (!MODE_VALUES.has(String(obj.interactiveMode))) return null;
  if (!MODE_VALUES.has(String(obj.autonomousMode))) return null;
  const patterns = Array.isArray(obj.patterns) ? obj.patterns : [];
  if (patterns.length === 0) return null;
  return {
    id: row.id,
    slug: row.slug,
    tier: row.principleTier as EnforceablePrinciple["tier"],
    runtime: {
      interactiveMode: obj.interactiveMode as EnforceablePrinciple["runtime"]["interactiveMode"],
      autonomousMode: obj.autonomousMode as EnforceablePrinciple["runtime"]["autonomousMode"],
      patterns: patterns as EnforceablePrinciple["runtime"]["patterns"],
    },
  };
}

export async function loadEnforceablePrinciples(): Promise<EnforceablePrinciple[]> {
  if (cached !== null) return maybeAppendSynthetic(cached);
  const rows = await prisma.wikiPage.findMany({
    where: {
      pageKind: "principle",
      NOT: { principleRuntimeEnforcement: { equals: null as unknown as object } },
    },
    select: { id: true, slug: true, principleTier: true, principleRuntimeEnforcement: true },
  });
  const shaped = rows.map(shapeOf).filter((p): p is EnforceablePrinciple => p !== null);
  cached = shaped;
  return maybeAppendSynthetic(shaped);
}
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(kernel): loadEnforceablePrinciples with process cache + synthetic-probe test hook`

---

## Phase 3 — Wire two tier-1 commandments

### Task 3.1: Update `never-wipe-db-for-code-fixes.md` frontmatter

**Files:**
- Modify: `docs/founder-kernel/wiki/principles/never-wipe-db-for-code-fixes.md`

> **Authoring shape:** the parser supports a single-line inline-JSON value. Multi-line authoring requires the parser-extension follow-up; until then, ALL patterns live on one (long) JSON line.

- [ ] **Step 1: Add the inline-JSON `principleRuntimeEnforcement` line to the frontmatter**

```yaml
principleRuntimeEnforcement: {"interactiveMode":"confirm","autonomousMode":"refuse","patterns":[{"kind":"shell","regex":"^docker\\s+compose\\s+down\\s.*-v\\b","rationale":"docker compose down -v drops named volumes including dpf_pgdata"},{"kind":"shell","regex":"^docker\\s+volume\\s+rm\\b","rationale":"Removes Docker volumes including operator state"},{"kind":"shell","regex":"^prisma\\s+migrate\\s+reset\\b","rationale":"Drops + recreates schema; wipes all rows"},{"kind":"shell","regex":"^pnpm\\s+(--filter\\s+\\S+\\s+)?(exec\\s+)?prisma\\s+migrate\\s+reset\\b","rationale":"pnpm-wrapped prisma migrate reset"},{"kind":"sql","regex":"(?i)^\\s*DROP\\s+DATABASE\\s+dpf\\b","rationale":"Drops the operator's production database"}]}
```

- [ ] **Step 2: Run** `cd packages/db && pnpm exec vitest run wiki-frontmatter` to confirm the file parses with non-undefined field.
- [ ] **Step 3: Run** the lint test against the file's frontmatter.
- [ ] **Step 4: Re-seed locally** — `pnpm --filter @dpf/db exec tsx src/seed-wiki-kernel.ts` and verify with `psql -c 'SELECT slug, "principleRuntimeEnforcement" FROM "WikiPage" WHERE slug=\\'never-wipe-db-for-code-fixes\\';'` that the JSONB column is populated.
- [ ] **Step 5: Commit** `feat(kernel-principles): never-wipe-db-for-code-fixes runtime enforcement`

---

### Task 3.2: Update `destructive-actions-require-explicit-go.md` frontmatter

**Files:** as above, sibling file.

- [ ] **Step 1: Add the inline-JSON line** — patterns drawn from the principle's existing "What counts as destructive" list, restricted to surfaces SAFE to autonomously refuse (e.g., NOT `docker compose build` — too broad).

```yaml
principleRuntimeEnforcement: {"interactiveMode":"confirm","autonomousMode":"refuse","patterns":[{"kind":"git","regex":"^push\\s+.*--force(-with-lease)?\\b.*\\bmain\\b","rationale":"force-push to main is on the destructive list"},{"kind":"shell","regex":"^git\\s+reset\\s+--hard\\b","rationale":"git reset --hard past committed work is destructive"},{"kind":"shell","regex":"^rm\\s+(-rf|-r\\s+-f|-fr|-rfv|-vrf)\\s+/","rationale":"rm -rf on a rooted absolute path is irreversible"}]}
```

- [ ] **Step 2-4: same verification path as Task 3.1**
- [ ] **Step 5: Commit** `feat(kernel-principles): destructive-actions runtime enforcement`

---

## Phase 4 — API route + telemetry

### Task 4.1: Failing route test

**Files:**
- Create: `apps/web/app/api/kernel/gate/route.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/kernel/load-enforceable-principles", () => ({
  loadEnforceablePrinciples: vi.fn().mockResolvedValue([{
    id: "p1", slug: "never-wipe-db-for-code-fixes", tier: "commandment",
    runtime: { interactiveMode: "confirm", autonomousMode: "refuse",
      patterns: [{ kind: "shell", regex: "^docker\\s+volume\\s+rm\\b", rationale: "x" }] },
  }]),
}));

const counterInc = vi.fn();
vi.mock("@/lib/operate/metrics", () => ({
  kernelGateDecisionsTotal: { inc: counterInc },
}));

import { POST } from "./route";

it("returns refuse for a matching autonomous attempt and increments the counter", async () => {
  const req = new Request("http://x/api/kernel/gate", {
    method: "POST",
    body: JSON.stringify({
      attempt: { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
      sessionClass: "autonomous",
    }),
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.verdict).toBe("refuse");
  expect(body.principleSlug).toBe("never-wipe-db-for-code-fixes");
  expect(counterInc).toHaveBeenCalledWith({
    verdict: "refuse", principle_slug: "never-wipe-db-for-code-fixes", session_class: "autonomous",
  });
});

it("returns 400 on malformed body", async () => {
  const req = new Request("http://x/api/kernel/gate", { method: "POST", body: "{garbage" });
  expect((await POST(req)).status).toBe(400);
});
```

- [ ] **Step 2: Run, expect FAIL**

---

### Task 4.2: Implement the route (using `Response.json`, matching project convention)

**Files:**
- Create: `apps/web/app/api/kernel/gate/route.ts`
- Modify: `apps/web/lib/operate/metrics.ts` (add the counter)

- [ ] **Step 3: Add Prometheus counter to metrics module** — `Counter` is already imported from `prom-client` near the top of `apps/web/lib/operate/metrics.ts` (verified line 11). Just append the new counter near the other `new Counter({…})` declarations:

```typescript
// apps/web/lib/operate/metrics.ts — append alongside existing counters
export const kernelGateDecisionsTotal = new Counter({
  name: "dpf_kernel_gate_decisions_total",
  help: "Runtime kernel-commandment gate decisions, labelled by verdict + principle slug + session class.",
  labelNames: ["verdict", "principle_slug", "session_class"] as const,
});
```

- [ ] **Step 4: Implement the route**

```typescript
// apps/web/app/api/kernel/gate/route.ts
import { z } from "zod";
import { evaluateExecution, type ExecutionAttempt, type SessionClass } from "@/lib/kernel/runtime-gate";
import { loadEnforceablePrinciples } from "@/lib/kernel/load-enforceable-principles";
import { kernelGateDecisionsTotal } from "@/lib/operate/metrics";

const BodySchema = z.object({
  attempt: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("shell"),    command: z.string(), args: z.array(z.string()) }),
    z.object({ kind: z.literal("mcp_tool"), toolName: z.string(), arguments: z.unknown() }),
    z.object({ kind: z.literal("sql"),      statement: z.string() }),
    z.object({ kind: z.literal("git"),      subcommand: z.string(), args: z.array(z.string()) }),
  ]),
  sessionClass: z.enum(["interactive", "autonomous"]),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });

  const principles = await loadEnforceablePrinciples();
  const decision = evaluateExecution(parsed.data.attempt as ExecutionAttempt, parsed.data.sessionClass as SessionClass, principles);

  const slug = decision.verdict === "allow" ? "_none" : decision.principleSlug;
  kernelGateDecisionsTotal.inc({ verdict: decision.verdict, principle_slug: slug, session_class: parsed.data.sessionClass });
  console.log(`[kernel-gate-trace] verdict=${decision.verdict} slug=${slug} session=${parsed.data.sessionClass} kind=${parsed.data.attempt.kind}`);

  return Response.json(decision);
}
```

- [ ] **Step 5: Run route test, expect PASS. Commit** `feat(kernel): POST /api/kernel/gate route + per-decision telemetry`

---

## Phase 5 — Shell guard

### Task 5.0: Installer preflight — require `jq` on POSIX, fail install if missing

**Files:**
- Modify: `install-dpf.sh`

> **Why mandate jq:** the shell-guard's JSON write+parse is the load-bearing surface that decides whether destructive commands get through. A pure-sh JSON parser is too fragile to trust as primary (rationale strings contain `"`, `\\`, control chars). We mandate jq at install time on POSIX so the guard can use jq unconditionally — no fragile sed/grep parse paths. macOS ships jq via Homebrew; most Linux distros via apt/yum/apk. Windows uses PowerShell's `ConvertFrom-Json` natively, so jq is not required there.

- [ ] **Step 1: Failing test** — a shell-level preflight test invoking `install-dpf.sh` with `PATH` stripped of `jq` exits non-zero with the documented message.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Add the preflight to `install-dpf.sh`** — early, before any side-effect-bearing step:

```sh
# Required runtime dependency for the kernel-commandment shell guard
# (scripts/safety/dpf-shell-guard.sh). The guard's JSON parsing is too
# load-bearing to trust to grep/sed fallbacks; jq is the floor.
if ! command -v jq >/dev/null 2>&1; then
  fail "jq is required (kernel-commandment shell guard depends on it).
        Install via your package manager:
          macOS:  brew install jq
          Debian: sudo apt-get install jq
          RHEL:   sudo dnf install jq
          Alpine: apk add jq"
fi
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(install): require jq for kernel-commandment shell guard`

---

### Task 5.1: POSIX shell guard (jq-only after Task 5.0; portable shebang)

**Files:**
- Create: `scripts/safety/dpf-shell-guard.sh`
- Create: `scripts/safety/dpf-shell-guard-fallback-patterns.json`
- Test: `scripts/safety/dpf-shell-guard.test.sh`

> **Discovery + test design:**
> - Real-binary discovery: at install time the installer probes for the real `docker` / `git` / `prisma` via `command -v` BEFORE adding the safety-bin to PATH, and writes the absolute paths to `$DPF_DIR/safety-bin/real-binaries.env` (e.g. `DPF_REAL_DOCKER=/usr/local/bin/docker`). The shell guard sources this file at runtime — NO PATH manipulation, NO `sed` stripping. Robust against reinstalls + works on Windows where the resolver is different.
> - Test stub: the guard checks for `DPF_GATE_CMD` env var; if set, it execs that command instead of `curl`. The test sets `DPF_GATE_CMD='cat $DPF_TEST_RESPONSE_FILE'` and writes the expected gate JSON to the file before invoking the guard. No live HTTP server in CI.
> - JSON: use `jq` if available; sh-only fallback constructs the JSON inline using `printf` + a small `sh_json_escape()` function (no python3 dependency).

- [ ] **Step 1: Implement the guard**

```sh
#!/bin/sh
# scripts/safety/dpf-shell-guard.sh
#
# DPF runtime kernel-commandment shell guard. Installer symlinks this
# script under names like `docker`, `git`, `prisma` in $DPF_DIR/safety-bin/
# and prepends that dir to PATH.
#
# Spec: docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md
# Plan: docs/superpowers/plans/2026-05-24-runtime-kernel-commandments-slice-1.md

set -eu

BIN_NAME="$(basename "$0")"
GATE_URL="${DPF_GATE_URL:-http://localhost:3000/api/kernel/gate}"
SESSION_CLASS="${DPF_AUTONOMOUS_SESSION_ID:+autonomous}"
SESSION_CLASS="${SESSION_CLASS:-interactive}"
# Portable script-dir discovery (macOS default readlink lacks -f).
GUARD_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load real-binary paths cached at install time (avoids PATH manipulation).
[ -f "$GUARD_DIR/real-binaries.env" ] && . "$GUARD_DIR/real-binaries.env" || true
real_var="DPF_REAL_$(echo "$BIN_NAME" | tr '[:lower:]' '[:upper:]')"
eval "REAL_BIN=\${$real_var:-}"

[ -n "$REAL_BIN" ] && [ -x "$REAL_BIN" ] || {
  echo "[dpf-shell-guard] cannot find real $BIN_NAME (set $real_var or reinstall)" >&2
  exit 127
}

# jq is mandated by Task 5.0 installer preflight; use it unconditionally for
# both encoding (handles backslash, quotes, control chars, newlines) and decoding.
JSON_ARGS=""
for a in "$@"; do
  esc="$(printf '%s' "$a" | jq -Rs .)"
  JSON_ARGS="${JSON_ARGS:+$JSON_ARGS,}$esc"
done
BODY=$(printf '{"attempt":{"kind":"shell","command":%s,"args":[%s]},"sessionClass":"%s"}' \
  "$(printf '%s' "$BIN_NAME" | jq -Rs .)" "$JSON_ARGS" "$SESSION_CLASS")

# Call the gate (overridable for tests via DPF_GATE_CMD).
if [ -n "${DPF_GATE_CMD:-}" ]; then
  RESP="$(eval "$DPF_GATE_CMD" || echo '{"verdict":"_unreachable"}')"
else
  RESP="$(curl -s --max-time 3 -X POST -H 'Content-Type: application/json' -d "$BODY" "$GATE_URL" || echo '{"verdict":"_unreachable"}')"
fi

# Extract fields via jq (mandated; no sed fallback).
read_field() { printf '%s' "$RESP" | jq -r ".$1 // empty"; }

VERDICT="$(read_field verdict)"
SLUG="$(read_field principleSlug)"
RAT="$(read_field rationale)"
PHRASE="$(read_field requiredPhrase)"

case "$VERDICT" in
  allow) exec "$REAL_BIN" "$@" ;;
  refuse)
    echo "[dpf-shell-guard] REFUSED by kernel commandment '$SLUG'" >&2
    echo "                  $RAT" >&2
    echo "                  Operator may bypass via absolute path (e.g. $REAL_BIN ...)" >&2
    exit 1 ;;
  require_confirm)
    {
      echo ""
      echo "[dpf-shell-guard] Commandment '$SLUG' requires explicit operator go:"
      echo "                  $RAT"
      echo ""
      echo "  Type EXACTLY (no quotes): $PHRASE"
      printf "  > "
    } >&2
    read -r TYPED || TYPED=""
    if [ "$TYPED" = "$PHRASE" ]; then exec "$REAL_BIN" "$@"; fi
    echo "[dpf-shell-guard] phrase mismatch — REFUSED" >&2
    exit 1 ;;
  _unreachable|"")
    # Fail-closed for tier-commandment patterns: load the static fallback,
    # regex-match the command line, refuse if any pattern matches.
    # Non-commandment commands fall through to exec (fail-open). jq is mandated
    # by Task 5.0 installer preflight, so no jq-presence check needed here.
    FALLBACK="$GUARD_DIR/dpf-shell-guard-fallback-patterns.json"
    CMDLINE="$BIN_NAME $*"
    if [ -f "$FALLBACK" ]; then
      MATCH_RATIONALE="$(jq -r --arg cmd "$CMDLINE" '[.patterns[] | select(.kind=="shell") | select($cmd | test(.regex)) | .rationale] | .[0] // empty' "$FALLBACK")"
      if [ -n "$MATCH_RATIONALE" ]; then
        echo "[dpf-shell-guard] gate unreachable AND command matches static fallback — REFUSED: $MATCH_RATIONALE" >&2
        exit 1
      fi
    fi
    exec "$REAL_BIN" "$@" ;;
  *)
    echo "[dpf-shell-guard] unknown verdict '$VERDICT'; refusing" >&2
    exit 1 ;;
esac
```

- [ ] **Step 2: Write the static fallback patterns** (hand-authored mirror of Task 3.1's shell patterns):

```json
{
  "patterns": [
    { "kind": "shell", "regex": "^docker\\s+compose\\s+down\\s.*-v\\b", "rationale": "docker compose down -v drops named volumes" },
    { "kind": "shell", "regex": "^docker\\s+volume\\s+rm\\b", "rationale": "docker volume rm wipes operator state" },
    { "kind": "shell", "regex": "^prisma\\s+migrate\\s+reset\\b", "rationale": "prisma migrate reset wipes all rows" },
    { "kind": "shell", "regex": "^pnpm\\s+(--filter\\s+\\S+\\s+)?(exec\\s+)?prisma\\s+migrate\\s+reset\\b", "rationale": "pnpm-wrapped prisma migrate reset" }
  ]
}
```

- [ ] **Step 3: Write the integration test using `DPF_GATE_CMD` stub**

```sh
# scripts/safety/dpf-shell-guard.test.sh
#!/bin/sh
set -eu
HERE="$(dirname "$0")"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# Stub real docker as `echo` so allow/confirm exec is safely observable.
mkdir -p "$TMPDIR/safety-bin"
ln -s "$HERE/dpf-shell-guard.sh" "$TMPDIR/safety-bin/docker"
printf 'DPF_REAL_DOCKER=/bin/echo\n' > "$TMPDIR/safety-bin/real-binaries.env"

run_with_response() {
  RESP_FILE="$TMPDIR/resp.json"
  printf '%s' "$1" > "$RESP_FILE"
  export DPF_GATE_CMD="cat $RESP_FILE"
  shift
  "$TMPDIR/safety-bin/docker" "$@"
}

# Case 1: allow
out="$(run_with_response '{"verdict":"allow"}' ps)"
[ "$out" = "ps" ] || { echo "FAIL allow: $out"; exit 1; }
echo "PASS allow"

# Case 2: refuse
if run_with_response '{"verdict":"refuse","principleSlug":"x","rationale":"r"}' volume rm dpf_pgdata; then
  echo "FAIL refuse: should have exited non-zero"; exit 1
fi
echo "PASS refuse"

# Case 3: require_confirm with correct phrase (need DPF_GATE_CMD then a stdin) — covered by manual Phase 9.2
# Case 4: _unreachable + static fallback refuse
if echo "" | run_with_response '{"verdict":"_unreachable"}' volume rm dpf_pgdata; then
  echo "FAIL unreachable+fallback should refuse"; exit 1
fi
echo "PASS unreachable+fallback"
```

- [ ] **Step 4: Run** — `sh -n scripts/safety/dpf-shell-guard.sh && sh scripts/safety/dpf-shell-guard.test.sh` — expect all PASS.
- [ ] **Step 5: Commit** `feat(safety): POSIX shell guard + static fallback + integration test`

---

### Task 5.2: PowerShell shell guard (parity with POSIX)

**Files:**
- Create: `scripts/safety/dpf-shell-guard.ps1`

- [ ] **Step 1: Mirror POSIX semantics** — `Invoke-RestMethod` to `$env:DPF_GATE_URL`, session-class from `$env:DPF_AUTONOMOUS_SESSION_ID`, real-binary discovery via env (`$env:DPF_REAL_DOCKER`) loaded from `$PSScriptRoot\real-binaries.ps1`, `Read-Host` for typed confirmation, `Start-Process -Wait` to invoke the real binary.
- [ ] **Step 2: Static-fallback patterns** — same `dpf-shell-guard-fallback-patterns.json`; parsed via `ConvertFrom-Json`.
- [ ] **Step 3: Parse-check via `[System.Management.Automation.Language.Parser]::ParseFile`**.
- [ ] **Step 4: Integration test under pwsh — stub via `$env:DPF_GATE_CMD = 'Get-Content $env:DPF_TEST_RESPONSE_FILE'`** mirroring the POSIX harness.
- [ ] **Step 5: Commit** `feat(safety): PowerShell shell guard parity`

---

### Task 5.3: Installer wiring (PATH shim + Windows propagation note)

**Files:**
- Modify: `install-dpf.ps1`
- Modify: `install-dpf.sh`

> **Windows PATH propagation:** `[Environment]::SetEnvironmentVariable(..."User")` writes to the registry but the CURRENT shell does not see it. Installer also sets `$env:Path = "$DPF_DIR\safety-bin;$env:Path"` for the running session AND prints an explicit "open a new terminal for the change to take effect in other windows" message.

- [ ] **Step 1: In `install-dpf.ps1`, after the existing `.env` write block:**
  1. Create `$DPF_DIR\safety-bin\` if missing.
  2. Probe real binaries via `Get-Command docker -All | Where-Object Source -notmatch 'safety-bin' | Select-Object -First 1 -ExpandProperty Source`; write to `$DPF_DIR\safety-bin\real-binaries.ps1` (`$env:DPF_REAL_DOCKER = '<path>'` etc.).
  3. Copy `scripts/safety/dpf-shell-guard.ps1` and `dpf-shell-guard-fallback-patterns.json` into safety-bin.
  4. Generate `docker.cmd`, `git.cmd`, `prisma.cmd` wrappers (each: `@pwsh -NoProfile -File "%~dp0dpf-shell-guard.ps1" %*` with the basename used by the guard for tool-name detection).
  5. Idempotently prepend `$DPF_DIR\safety-bin` to user PATH via `[Environment]::SetEnvironmentVariable(...)`. Check for prior presence.
  6. Also set `$env:Path = "$DPF_DIR\safety-bin;$env:Path"` for the current session.
  7. Print: `"Shell guard installed. Open a new terminal for the PATH change to take effect in other windows."`
- [ ] **Step 2: In `install-dpf.sh`, equivalent shell-side logic:**
  1. `mkdir -p $REPO_ROOT/safety-bin`
  2. Probe real binaries via `command -v docker` etc.; write to `$REPO_ROOT/safety-bin/real-binaries.env`.
  3. Symlink `dpf-shell-guard.sh` under `docker`, `git`, `prisma` in safety-bin.
  4. Prepend `$REPO_ROOT/safety-bin` to PATH via idempotent block in `~/.profile` and `~/.zshrc` (markers `# >>> dpf-safety-bin >>>` / `# <<< dpf-safety-bin <<<`).
  5. `export PATH="$REPO_ROOT/safety-bin:$PATH"` for the running shell.
  6. Print the open-new-terminal hint.
- [ ] **Step 3: Manual verify on a fresh install** — new terminal → `which docker` shows the shim, `docker ps` works (allow → exec real), `docker volume rm dpf_pgdata` autonomously refuses.
- [ ] **Step 4: Re-run installer → confirm PATH not double-added (idempotent)**.
- [ ] **Step 5: Commit** `feat(install): wire shell-guard PATH shim with real-binary caching`

---

## Phase 6 — MCP dispatcher integration + telemetry

### Task 6.1: Failing dispatcher test using a REAL tool name with synthetic principle

**Files:**
- Create: `apps/web/lib/mcp-tools-runtime-gate.test.ts`

> **Why a real tool name:** `executeTool` is a giant switch over real tool names. Calling an unknown tool name falls through to the default case (404-equivalent) and the gate would never fire. Test against a real tool name (`list_backlog_items` — a safe read) with a synthetic principle that artificially matches it.

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/kernel/load-enforceable-principles", () => ({
  loadEnforceablePrinciples: vi.fn().mockResolvedValue([{
    id: "p1", slug: "synthetic-block", tier: "commandment",
    runtime: { interactiveMode: "refuse", autonomousMode: "refuse",
      patterns: [{ kind: "mcp_tool", toolName: "list_backlog_items", rationale: "TEST" }] },
  }]),
}));
vi.mock("@/lib/kernel/session-class", () => ({
  detectSessionClass: () => "autonomous",
}));
// Mock the underlying handler so we can assert it was NEVER called.
const handlerSpy = vi.fn().mockResolvedValue({ content: [] });
vi.mock("@/lib/backlog/mcp-handlers", () => ({
  listBacklogItemsTool: (...args: unknown[]) => handlerSpy(...args),
}));

import { executeTool } from "./mcp-tools";

it("refuses an MCP tool that matches a refuse-pattern; handler never runs", async () => {
  const result = await executeTool("list_backlog_items", {}, "user-x");
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).toContain("synthetic-block");
  expect(handlerSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, expect FAIL**

---

### Task 6.2: Insert gate call before switch + emit telemetry

**Files:**
- Create: `apps/web/lib/kernel/session-class.ts`
- Modify: `apps/web/lib/mcp-tools.ts` (in `executeTool` near line 4187)

- [ ] **Step 3: Add session-class helper**

```typescript
// apps/web/lib/kernel/session-class.ts
import type { SessionClass } from "./runtime-gate";
export function detectSessionClass(): SessionClass {
  return process.env.DPF_AUTONOMOUS_SESSION_ID ? "autonomous" : "interactive";
}
```

- [ ] **Step 4a: Add static imports at the top of `apps/web/lib/mcp-tools.ts`** (with the other imports near the file head — do NOT use dynamic `await import()` in this hot path):

```typescript
import { evaluateExecution } from "@/lib/kernel/runtime-gate";
import { loadEnforceablePrinciples } from "@/lib/kernel/load-enforceable-principles";
import { detectSessionClass } from "@/lib/kernel/session-class";
import { kernelGateDecisionsTotal } from "@/lib/operate/metrics";
```

- [ ] **Step 4b: At the top of `executeTool`, after `sanitizeToolParams` and BEFORE the switch.** The loader is process-cached (Task 2.4), so the Postgres roundtrip happens only on the first call per process — subsequent dispatches read from memory:

```typescript
const _sessionClass = detectSessionClass();
const _principles = await loadEnforceablePrinciples();   // cached after first call
const _decision = evaluateExecution(
  { kind: "mcp_tool", toolName, arguments: params },
  _sessionClass, _principles,
);

const _slug = _decision.verdict === "allow" ? "_none" : _decision.principleSlug;
kernelGateDecisionsTotal.inc({ verdict: _decision.verdict, principle_slug: _slug, session_class: _sessionClass });
console.log(`[kernel-gate-trace] verdict=${_decision.verdict} slug=${_slug} session=${_sessionClass} kind=mcp_tool tool=${toolName}`);

if (_decision.verdict === "refuse") {
  return {
    isError: true,
    content: [{ type: "text", text:
      `[kernel-gate] REFUSED by commandment '${_decision.principleSlug}': ${_decision.rationale}` }],
  };
}
if (_decision.verdict === "require_confirm") {
  return {
    isError: true,
    content: [{ type: "text", text:
      `[kernel-gate] Commandment '${_decision.principleSlug}' requires typed confirmation. ` +
      `Operator must reply with exactly: ${_decision.requiredPhrase}` }],
  };
}
// _decision.verdict === "allow" — fall through to the existing switch
```

- [ ] **Step 5: Run dispatcher test, expect PASS. Commit** `feat(mcp): runtime gate integration in executeTool + telemetry`

---

## Phase 7 — Test-only synthetic-tool probe (for live verification)

### Task 7.1: Add the `dpf_test_kernel_refuse_probe` tool to the MCP dispatcher

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts` — one switch case gated on `process.env.DPF_TEST_MCP_REFUSE_PROBE === "1"`.

> **How this composes with Task 2.4's loader injection:** the synthetic refuse-pattern is INJECTED INTO THE PRINCIPLE REGISTRY by `loadEnforceablePrinciples()` when `DPF_TEST_MCP_REFUSE_PROBE=1` (the `SYNTHETIC_PROBE` constant added in Task 2.4). NO production wiki page is touched. NO DB row is added. The synthetic principle only exists in-memory and only when the env var is set. The dispatcher hits the gate first (Task 6.2 wiring); the gate matches the synthetic principle on the probe tool name; the dispatcher returns the refuse response and the probe tool body NEVER runs. This task just adds the probe tool itself to the switch so the dispatcher recognizes the tool name as valid (otherwise it would 404 before the gate runs).

- [ ] **Step 1: Failing test** that confirms the probe tool name returns the kernel-gate refuse response when `DPF_TEST_MCP_REFUSE_PROBE=1` and a not-found error when unset:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { __resetCacheForTest } from "@/lib/kernel/load-enforceable-principles";

beforeEach(() => { __resetCacheForTest(); });

it("returns kernel-gate refuse for the synthetic probe when env is set", async () => {
  process.env.DPF_TEST_MCP_REFUSE_PROBE = "1";
  const { executeTool } = await import("./mcp-tools");
  const r = await executeTool("dpf_test_kernel_refuse_probe", {}, "user-x");
  expect(r.isError).toBe(true);
  expect(JSON.stringify(r)).toContain("__synthetic_refuse_probe__");
  delete process.env.DPF_TEST_MCP_REFUSE_PROBE;
});

it("returns the default unknown-tool response when env is unset", async () => {
  delete process.env.DPF_TEST_MCP_REFUSE_PROBE;
  const { executeTool } = await import("./mcp-tools");
  const r = await executeTool("dpf_test_kernel_refuse_probe", {}, "user-x");
  expect(r.isError).toBe(true);
  // Whatever the existing default 'unknown tool' content looks like — assert it does NOT contain the synthetic-probe slug.
  expect(JSON.stringify(r)).not.toContain("__synthetic_refuse_probe__");
});
```

- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Add the switch case** to `executeTool`, placed alongside existing cases (the gate runs BEFORE the switch per Task 6.2, so a refusable env-gated synthetic principle will short-circuit before this case is reached):

```typescript
case "dpf_test_kernel_refuse_probe": {
  // Gated test-only tool. Reachable ONLY when DPF_TEST_MCP_REFUSE_PROBE=1.
  // The gate intercepts this in autonomous + interactive mode via the
  // synthetic principle injected by loadEnforceablePrinciples (Task 2.4),
  // so this body is normally never reached. Kept as a recognizable
  // pre-gate tool name so the dispatcher does not 404 before the gate runs.
  if (process.env.DPF_TEST_MCP_REFUSE_PROBE !== "1") {
    return { isError: true, content: [{ type: "text", text: "tool not registered" }] };
  }
  return { content: [{ type: "text", text: "probe tool body — should not be reached when gate is wired" }] };
}
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(mcp): DPF_TEST_MCP_REFUSE_PROBE synthetic probe tool`

---

## Phase 8 — Operator-facing doc

### Task 8.1: docs/operations/runtime-kernel-commandments.md

**Files:**
- Create: `docs/operations/runtime-kernel-commandments.md`

- [ ] **Step 1: Author the doc.** Sections:
  1. What the shell guard does (one-paragraph non-technical explainer).
  2. How to recognize the typed-confirmation prompt (verbatim example).
  3. How to bypass via absolute path (`$DPF_REAL_DOCKER volume rm dpf_pgdata` or the absolute path printed in the refuse message).
  4. How to add a new commandment (point at the principle wiki + the inline-JSON frontmatter pattern; flag the "single-line authoring constraint until parser-extension PR lands").
  5. Where the audit trail lives (Prometheus counter `dpf_kernel_gate_decisions_total` + `[kernel-gate-trace]` log line).
- [ ] **Step 2-4: skipped (doc-only)**
- [ ] **Step 5: Commit** `docs(operations): runtime kernel commandments operator guide`

---

## Phase 9 — Live verification

### Task 9.1: Manual — autonomous-mode refuse on `docker volume rm`

- [ ] **Step 1: Fresh install with this branch + migration applied.**
- [ ] **Step 2: New shell with `export DPF_AUTONOMOUS_SESSION_ID=test`.**
- [ ] **Step 3: Run `docker volume rm dpf_pgdata`.**
- [ ] **Step 4: Verify** output is the `[dpf-shell-guard] REFUSED by kernel commandment 'never-wipe-db-for-code-fixes'` line; exit code 1; `docker volume ls | grep dpf_pgdata` still shows the volume.
- [ ] **Step 5: Capture terminal screenshot for the PR body.**

### Task 9.2: Manual — interactive typed-confirm

- [ ] **Step 1: New shell with `DPF_AUTONOMOUS_SESSION_ID` unset.**
- [ ] **Step 2: Run `docker volume rm dpf_pgdata`.**
- [ ] **Step 3: Verify** the prompt shows rationale + required phrase.
- [ ] **Step 4: Type something wrong, expect refuse. Re-run, type the phrase exactly, expect the command to proceed.**
- [ ] **Step 5: Capture screenshots.**

### Task 9.3: Manual — MCP dispatcher refuse via test probe

- [ ] **Step 1: Restart portal with `DPF_TEST_MCP_REFUSE_PROBE=1` set in compose env.**
- [ ] **Step 2: Call `dpf_test_kernel_refuse_probe` via the MCP harness.**
- [ ] **Step 3: Verify** the `ToolResult` contains `[kernel-gate] REFUSED` + `synthetic-block` (or whichever principle matched).
- [ ] **Step 4: `curl http://localhost:3000/api/metrics | grep dpf_kernel_gate_decisions_total`** — confirm the counter increment.
- [ ] **Step 5: Mark verification complete.**

---

## Wrap-up

- [ ] **Spec PR #1068 merges** before this implementation PR.
- [ ] **Implementation PR opens** with Phase-9 screenshots in the test plan.
- [ ] **BI-43F95F77 marked done** with resolution `Shipped via PR #<n>`.
- [ ] **Spawn follow-up BIs** for slices 2-4 (Prisma middleware, git pre-push, broader commandment coverage) via `mcp__dpf__create_backlog_item`, linked to EP-DR-HARDENING-2026-05-23.

---

## Acceptance criteria (mirroring spec §6)

- `evaluateExecution` ≥95% branch coverage (verify via `vitest --coverage`).
- `never-wipe-db-for-code-fixes` and `destructive-actions-require-explicit-go` both have non-empty `principleRuntimeEnforcement`.
- Live test (Tasks 9.1, 9.2) passes; screenshots in PR body.
- MCP dispatcher refuse test (Task 9.3) passes; counter increment visible at `/api/metrics`.
- Per-decision Prometheus counter + tool-trace log emitted at every call site (API route + MCP dispatcher).
- Operator-facing doc landed at `docs/operations/runtime-kernel-commandments.md`.
- Static-fallback patterns refuse tier-commandment commands when the portal is unreachable (Task 5.1 fallback test).
