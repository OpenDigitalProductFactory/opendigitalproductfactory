# Prompt State-Leakage Lint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Land the prompt state-leakage lint per [the spec](../specs/2026-04-30-prompt-state-leakage-lint-design.md) — TypeScript audit script + GitHub workflow + tracked baseline — so any new occurrence of stale runtime-state language in `prompts/route-persona/**/*.prompt.md` or `prompts/specialist/**/*.prompt.md` fails CI on the introducing PR.

**Architecture:** A static, repo-only audit. The script reads prompt files, runs four rule families (PSL-001 forbidden phrases / PSL-002 unsourced grant enumeration / PSL-003 current-state snapshots / PSL-004 runtime-disabling instruction, warn-only), emits a stable JSON `Report`, and compares against a committed baseline. New error-level findings → exit 1. The shrink-only baseline guard prevents a PR from silencing new violations by adding to the baseline. Mirrors the existing `audit-coworker-personas.ts` pattern.

**Tech Stack:** TypeScript, tsx (no compile step), Vitest, GitHub Actions, pnpm workspaces. No new runtime dependencies.

**Critical context for implementer (no codebase familiarity assumed):**

- **Spec:** Read `docs/superpowers/specs/2026-04-30-prompt-state-leakage-lint-design.md` end-to-end before starting. §6 is the rule definitions; §7 is the architecture; §10 is the verification plan; §9 is the acceptance criteria.
- **Reference script — copy its shape, do not import from it:** [`apps/web/scripts/audit-coworker-personas.ts`](../../../apps/web/scripts/audit-coworker-personas.ts). Read it once for the conventions: `repoRoot()` walks up to find `pnpm-workspace.yaml`, `loadPersona()` parses YAML frontmatter without a YAML dependency, baseline diff logic at `diffAgainstBaseline()`, main entry parses `--baseline` and `--json-out`.
- **Reference workflow — copy and adapt:** [`.github/workflows/audit-coworker-personas.yml`](../../../.github/workflows/audit-coworker-personas.yml). Same Node 24 + pnpm 10.33.2 setup, same `pnpm --filter web exec tsx` command, same artifact upload.
- **Worktree state:** Branch `feat/prompt-state-leakage-lint` is created from main. Spec is committed (`0f551a24`). All files in this plan are committed on this branch and pushed to a new PR against main.
- **AGENTS.md must-reads:** §3 (rule IDs are kebab-case-lowercase but invariant IDs in code are `"PSL-001"` etc. matching the existing persona audit's `"PERSONA-001"` style — uppercase + hyphens. The lowercase rule is for DB enums, not invariant identifiers); §4 (DCO `git commit -s`, branch from main — done, no `--no-verify`); §5 (Build gate: vitest + production build — script-only PR but run the build because the script lives in the `apps/web` TS project); §6 (one concern per PR — this is its own PR).
- **Tooling pin:** use `pnpm --filter web exec tsx` and `pnpm --filter web typecheck`, never `npx`.
- **No DB access:** the spec is explicit (§5 non-goal #4). The script reads `.prompt.md` files only.

---

## Task 1: Skeleton script + CLI wiring

**Why:** Get a runnable scaffold first so subsequent rule additions are pure inserts. Establishes the file shape, CLI args, and Report output.

**Files:**
- Create: `apps/web/scripts/audit-prompt-state-leakage.ts`

**Steps:**

- [ ] **Step 1: Create the script file with the imports, types, and a placeholder `main()` that emits an empty Report.**

  Use [`apps/web/scripts/audit-coworker-personas.ts:30-77`](../../../apps/web/scripts/audit-coworker-personas.ts#L30-L77) as the model for the `repoRoot()` helper, the imports, and the file header comment block.

  Initial file content:

  ```ts
  /**
   * Prompt state-leakage audit
   * (docs/superpowers/specs/2026-04-30-prompt-state-leakage-lint-design.md).
   *
   * Walks every persona file under prompts/route-persona/ and prompts/specialist/
   * and runs the spec's §6 rules (PSL-001 through PSL-004). Static — no DB.
   * Read-only — no edits.
   *
   * Usage (local):
   *   pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts
   *
   * Usage (CI): wired into .github/workflows/audit-prompt-state-leakage.yml
   *
   * Output: JSON report on stdout. Exit code 0 if no findings, 1 if any error-level.
   *   --baseline <path>                       compare against a prior report; exit 1
   *                                            only if NEW error-level findings appear.
   *   --baseline-may-only-shrink-from <path>  fail if the current baseline added any
   *                                            keys vs. the path argument's baseline
   *                                            (shrink-only guard for PR review).
   *   --json-out <path>                       write report to file in addition to stdout.
   *   --help                                   print usage.
   */

  import { readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
  import { join, resolve } from "node:path";

  type Severity = "error" | "warn";
  type InvariantId = "PSL-001" | "PSL-002" | "PSL-003" | "PSL-004";

  interface Finding {
    invariantId: InvariantId;
    severity: Severity;
    file: string;        // repo-relative, forward slashes
    line: number;        // 1-based; display only, not part of finding identity
    column: number;      // 1-based; display only
    match: string;       // the matched substring (normalized)
    summary: string;
    detail: string;
  }

  interface Report {
    generatedAt: string;
    spec: string;
    rulesChecked: number;
    errorCount: number;
    warnCount: number;
    findings: Finding[];
  }

  const findings: Finding[] = [];

  function repoRoot(): string {
    // walk up until pnpm-workspace.yaml found
    let dir = process.cwd();
    while (dir !== "/" && dir !== resolve(dir, "..")) {
      if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
      dir = resolve(dir, "..");
    }
    return process.cwd();
  }

  const ROOT = repoRoot();

  function normalizeMatch(s: string): string {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
  }

  function findingKey(f: Finding): string {
    return `${f.invariantId}::${f.file}::${normalizeMatch(f.match)}`;
  }

  // ─── Prompt enumeration ────────────────────────────────────────────────────

  function listPromptFiles(): string[] {
    const out: string[] = [];
    for (const cat of ["route-persona", "specialist"] as const) {
      const dir = join(ROOT, "prompts", cat);
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith(".prompt.md")) continue;
        out.push(`prompts/${cat}/${entry}`);
      }
    }
    return out.sort();
  }

  // ─── Rule implementations (added in Tasks 2–5) ────────────────────────────

  // checkPsl001, checkPsl002, checkPsl003, checkPsl004 — added in subsequent tasks

  // ─── Baseline diff (added in Task 6) ──────────────────────────────────────

  // ─── Shrink-only guard (added in Task 7) ──────────────────────────────────

  // ─── Main ──────────────────────────────────────────────────────────────────

  function printHelp(): void {
    console.log(
      `prompt state-leakage audit\n\n` +
      `Usage:\n` +
      `  pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts [options]\n\n` +
      `Options:\n` +
      `  --baseline <path>                       compare against prior report\n` +
      `  --baseline-may-only-shrink-from <path>  shrink-only guard\n` +
      `  --json-out <path>                       also write report to file\n` +
      `  --help                                   print this message\n`,
    );
  }

  function main(): void {
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-h")) {
      printHelp();
      process.exit(0);
    }

    let baselinePath: string | null = null;
    let shrinkFromPath: string | null = null;
    let jsonOutPath: string | null = null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--baseline" && args[i + 1]) { baselinePath = args[i + 1]; i++; }
      else if (args[i] === "--baseline-may-only-shrink-from" && args[i + 1]) { shrinkFromPath = args[i + 1]; i++; }
      else if (args[i] === "--json-out" && args[i + 1]) { jsonOutPath = args[i + 1]; i++; }
    }

    const absolutize = (p: string | null): string | null =>
      p && !p.match(/^([a-zA-Z]:[\\/]|\/)/) ? join(ROOT, p) : p;
    baselinePath = absolutize(baselinePath);
    shrinkFromPath = absolutize(shrinkFromPath);
    jsonOutPath = absolutize(jsonOutPath);

    // Run rule checks (no-op until Tasks 2–5 add them)
    const promptFiles = listPromptFiles();
    void promptFiles;

    const errorCount = findings.filter((f) => f.severity === "error").length;
    const warnCount = findings.filter((f) => f.severity === "warn").length;

    const report: Report = {
      generatedAt: new Date().toISOString(),
      spec: "docs/superpowers/specs/2026-04-30-prompt-state-leakage-lint-design.md",
      rulesChecked: 4,
      errorCount,
      warnCount,
      findings: [...findings].sort((a, b) => findingKey(a).localeCompare(findingKey(b))),
    };

    console.log(JSON.stringify(report, null, 2));

    if (jsonOutPath) {
      writeFileSync(jsonOutPath, JSON.stringify(report, null, 2) + "\n", "utf8");
      console.error(`[audit] wrote ${jsonOutPath}`);
    }

    let exitCode = 0;
    // Baseline diff and shrink-only guard wired in Tasks 6–7
    if (errorCount > 0 && !baselinePath) exitCode = 1;
    void baselinePath;
    void shrinkFromPath;

    process.exit(exitCode);
  }

  main();
  ```

- [ ] **Step 2: Run `--help` and confirm it prints usage.**
  ```bash
  pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts --help
  ```
  Expected: usage message, exit 0.

- [ ] **Step 3: Run with no args; confirm an empty Report is printed.**
  ```bash
  pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts
  ```
  Expected: `{"generatedAt":...,"spec":"...","rulesChecked":4,"errorCount":0,"warnCount":0,"findings":[]}`, exit 0.

- [ ] **Step 4: Typecheck.**
  ```bash
  pnpm --filter web typecheck
  ```
  Expected: zero errors.

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/web/scripts/audit-prompt-state-leakage.ts
  git commit -s -m "feat(audit): scaffold prompt state-leakage audit script"
  ```

---

## Task 2: PSL-001 forbidden-phrase rule

**Why:** This is the rule that catches today's exact failure mode (`currently []`, `pending follow-on assignment`). Land first because it's the simplest and unblocks the rest.

**Files:**
- Modify: `apps/web/scripts/audit-prompt-state-leakage.ts`
- Create: `apps/web/scripts/audit-prompt-state-leakage.test.ts`

**Steps:**

- [ ] **Step 0: Verify Vitest picks up `scripts/**/*.test.ts`.**

  Vitest config sometimes globs only `src/`/`app/`/`lib/`. Confirm the test will run in the full suite, not just when invoked by direct path:

  ```bash
  pnpm --filter web exec vitest run --reporter=basic 2>&1 | grep -E "(scripts|audit-prompt)"
  ```

  If the test isn't picked up, check `apps/web/vitest.config.ts` (or `vitest.config.mts`) and either:
  - extend the `test.include` array to add `"scripts/**/*.test.ts"`, OR
  - move the test file to a known-globbed location (e.g. `apps/web/lib/__tests__/audit-prompt-state-leakage.test.ts`) and adjust the import path.

  Pick the option that requires the smaller config change and keeps the test colocated with what it tests.

- [ ] **Step 1: Write the failing test first.**

  Create `apps/web/scripts/audit-prompt-state-leakage.test.ts` (or the relocated path from Step 0):

  ```ts
  import { describe, it, expect } from "vitest";
  import { matchPsl001 } from "./audit-prompt-state-leakage";

  describe("PSL-001 forbidden phrases", () => {
    it("matches `currently []`", () => {
      const out = matchPsl001("the grants are currently [] (empty)", "x.md");
      expect(out).toHaveLength(1);
      expect(out[0]!.match.toLowerCase()).toContain("currently");
    });

    it("matches `pending follow-on assignment`", () => {
      const out = matchPsl001("pending follow-on assignment per the plan", "x.md");
      expect(out).toHaveLength(1);
    });

    it("matches `once the per-agent grant`", () => {
      const out = matchPsl001("once the per-agent grant PR ships", "x.md");
      expect(out).toHaveLength(1);
    });

    it("matches `will hold a curated set`", () => {
      const out = matchPsl001("This persona will hold a curated set of grants", "x.md");
      expect(out).toHaveLength(1);
    });

    it("matches `tools the role expects to hold once granted`", () => {
      const out = matchPsl001("Tools the role expects to hold once granted: ...", "x.md");
      expect(out).toHaveLength(1);
    });

    it("does not match unrelated text", () => {
      const out = matchPsl001("This persona uses backlog_read and backlog_write tools.", "x.md");
      expect(out).toHaveLength(0);
    });

    // Near-miss negatives — guard against future loosening of the regex
    it("does not match `currently empty` without brackets", () => {
      expect(matchPsl001("the list is currently empty", "x.md")).toHaveLength(0);
    });
    it("does not match `pending assignment` (missing `follow-on`)", () => {
      expect(matchPsl001("the work is pending assignment", "x.md")).toHaveLength(0);
    });
    it("does not match `the per-agent grant` without `once`", () => {
      expect(matchPsl001("the per-agent grant model is...", "x.md")).toHaveLength(0);
    });
    it("does not match `will hold a list` (different framing)", () => {
      expect(matchPsl001("this persona will hold a list of", "x.md")).toHaveLength(0);
    });
    it("does not match `the role expects to hold tools` (missing `once granted`)", () => {
      expect(matchPsl001("the role expects to hold these tools", "x.md")).toHaveLength(0);
    });

    it("reports correct 1-based line number", () => {
      const text = "line one\nline two\ncurrently [] line three\nline four";
      const out = matchPsl001(text, "x.md");
      expect(out[0]!.line).toBe(3);
    });
  });
  ```

- [ ] **Step 2: Run the test; verify it fails (function does not exist).**
  ```bash
  pnpm --filter web exec vitest run apps/web/scripts/audit-prompt-state-leakage.test.ts
  ```
  Expected: import error or "matchPsl001 is not a function".

- [ ] **Step 3: Implement `matchPsl001` in the script.**

  Add to `apps/web/scripts/audit-prompt-state-leakage.ts` (after the `listPromptFiles()` function, before the `// ─── Main ───` comment):

  ```ts
  // ─── PSL-001: stale future-state grant phrases ─────────────────────────────

  const PSL_001_PATTERNS: Array<{ regex: RegExp; phrase: string }> = [
    { regex: /currently\s+\[\]/i, phrase: "currently []" },
    { regex: /pending follow-on assignment/i, phrase: "pending follow-on assignment" },
    { regex: /once the per-agent grant/i, phrase: "once the per-agent grant" },
    { regex: /will hold a curated set/i, phrase: "will hold a curated set" },
    { regex: /tools? the role expects to hold once granted/i, phrase: "tools the role expects to hold once granted" },
  ];

  export function matchPsl001(body: string, file: string): Finding[] {
    const out: Finding[] = [];
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const { regex, phrase } of PSL_001_PATTERNS) {
        const m = line.match(regex);
        if (m && typeof m.index === "number") {
          out.push({
            invariantId: "PSL-001",
            severity: "error",
            file,
            line: i + 1,
            column: m.index + 1,
            match: m[0],
            summary: `[PSL-001] forbidden state phrase: "${phrase}"`,
            detail:
              `The phrase "${phrase}" tells the model that runtime grants are not yet available, even when the runtime delivers them. Remove this language. The runtime tool list is authoritative — describe behavior in the prompt, not state.\n\nSee docs/superpowers/specs/2026-04-30-prompt-state-leakage-lint-design.md §6 PSL-001.`,
          });
        }
      }
    }
    return out;
  }

  function checkPsl001(promptFiles: string[]): void {
    for (const relPath of promptFiles) {
      const abs = join(ROOT, relPath);
      const text = readFileSync(abs, "utf8");
      for (const f of matchPsl001(text, relPath)) findings.push(f);
    }
  }
  ```

  Wire into `main()` — replace `void promptFiles;` with `checkPsl001(promptFiles);`.

- [ ] **Step 4: Run the test; verify it passes.**
  ```bash
  pnpm --filter web exec vitest run apps/web/scripts/audit-prompt-state-leakage.test.ts
  ```
  Expected: all PSL-001 cases pass.

- [ ] **Step 5: Run the script against the live tree to confirm it finds existing violations.**
  ```bash
  pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts | head -80
  ```
  Expected: at least one PSL-001 finding in each of the 8 named route-persona prompts from spec §1 (admin-assistant, build-specialist, customer-advisor, ea-architect, hr-specialist, ops-coordinator, platform-engineer, portfolio-advisor). Total finding count may be higher if a single file contains multiple forbidden phrases. Exit 1.

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/web/scripts/audit-prompt-state-leakage.ts apps/web/scripts/audit-prompt-state-leakage.test.ts
  git commit -s -m "feat(audit): PSL-001 forbidden state phrases"
  ```

---

## Task 3: PSL-002 unsourced grant enumeration

**Why:** Catches the structural form of the bug — `# Tools Available` sections that enumerate grants without anchoring to the canonical source.

**Files:**
- Modify: `apps/web/scripts/audit-prompt-state-leakage.ts`
- Modify: `apps/web/scripts/audit-prompt-state-leakage.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests for PSL-002.**

  Add to the test file:

  ```ts
  import { matchPsl002 } from "./audit-prompt-state-leakage";

  describe("PSL-002 unsourced grant enumeration", () => {
    const goodSection =
      "# Tools Available\n\n" +
      "From `packages/db/data/agent_registry.json`:\n\n" +
      "- backlog_read — read backlog\n" +
      "- backlog_write — author backlog items\n";

    const badSection =
      "# Tools Available\n\n" +
      "This agent uses these grants once the PR ships:\n\n" +
      "- backlog_read — read backlog\n" +
      "- backlog_write — author backlog items\n";

    const noBulletsSection =
      "# Tools Available\n\n" +
      "Refer to the registry for the live list.\n";

    it("flags a Tools Available section with grant bullets and no source citation", () => {
      const out = matchPsl002(badSection, "x.md");
      expect(out).toHaveLength(1);
      expect(out[0]!.invariantId).toBe("PSL-002");
    });

    it("does not flag a Tools Available section that cites packages/db/data/agent_registry.json", () => {
      const out = matchPsl002(goodSection, "x.md");
      expect(out).toHaveLength(0);
    });

    it("does not flag a Tools Available section without grant-like bullets", () => {
      const out = matchPsl002(noBulletsSection, "x.md");
      expect(out).toHaveLength(0);
    });

    it("flags a Tool Use section the same way", () => {
      const text = badSection.replace("# Tools Available", "# Tool Use");
      const out = matchPsl002(text, "x.md");
      expect(out).toHaveLength(1);
    });

    it("does not accept seed.ts as the sole citation", () => {
      const text = badSection.replace(
        "This agent uses these grants once the PR ships:",
        "Mirroring `packages/db/src/seed.ts`:",
      );
      const out = matchPsl002(text, "x.md");
      expect(out).toHaveLength(1);
    });

    it("flags indented sub-bullets with grant suffixes", () => {
      const indented =
        "# Tools Available\n\n" +
        "Some narrative here:\n\n" +
        "  - backlog_read — read backlog\n" +
        "  - backlog_write — author backlog items\n";
      const out = matchPsl002(indented, "x.md");
      expect(out).toHaveLength(1);
    });
  });
  ```

- [ ] **Step 2: Run tests; verify PSL-002 cases fail.**

- [ ] **Step 3: Implement `matchPsl002`.**

  Add to the script after `matchPsl001`:

  ```ts
  // ─── PSL-002: unsourced grant enumeration ──────────────────────────────────

  const TOOLS_HEADING_RE = /^#+\s*(?:Tools Available|Tool Use)\s*$/m;
  const NEXT_HEADING_RE = /^#+\s+/m;
  const GRANT_BULLET_RE =
    /^\s*[-*]\s+`?[a-z][a-z0-9_]*(?:_(?:read|write|create|execute|publish|emit|validate|provision|trigger|promote|triage))`?\b/m;
  const REGISTRY_CITATION_RE = /packages\/db\/data\/agent_registry\.json/;

  export function matchPsl002(body: string, file: string): Finding[] {
    const out: Finding[] = [];
    const headingMatch = body.match(TOOLS_HEADING_RE);
    if (!headingMatch || typeof headingMatch.index !== "number") return out;

    const sectionStart = headingMatch.index;
    const tail = body.slice(sectionStart + headingMatch[0].length);
    const nextH = tail.match(NEXT_HEADING_RE);
    const sectionEnd = nextH && typeof nextH.index === "number"
      ? sectionStart + headingMatch[0].length + nextH.index
      : body.length;
    const section = body.slice(sectionStart, sectionEnd);

    if (!GRANT_BULLET_RE.test(section)) return out;
    if (REGISTRY_CITATION_RE.test(section)) return out;

    // Compute line of the heading
    const before = body.slice(0, sectionStart);
    const lineNo = before.split(/\r?\n/).length;

    out.push({
      invariantId: "PSL-002",
      severity: "error",
      file,
      line: lineNo,
      column: 1,
      match: headingMatch[0].trim(),
      summary: `[PSL-002] '${headingMatch[0].trim()}' enumerates grants without citing packages/db/data/agent_registry.json`,
      detail:
        `A Tools Available / Tool Use section that lists grant-like bullets must cite the canonical grant source: packages/db/data/agent_registry.json. Without that anchor, the prompt is making a state claim that will rot when the registry changes.\n\nSee docs/superpowers/specs/2026-04-30-prompt-state-leakage-lint-design.md §6 PSL-002. The marketing-specialist prompt at prompts/route-persona/marketing-specialist.prompt.md is the reference shape.`,
    });
    return out;
  }

  function checkPsl002(promptFiles: string[]): void {
    for (const relPath of promptFiles) {
      const abs = join(ROOT, relPath);
      const text = readFileSync(abs, "utf8");
      for (const f of matchPsl002(text, relPath)) findings.push(f);
    }
  }
  ```

  Wire `checkPsl002(promptFiles);` into `main()` after `checkPsl001`.

- [ ] **Step 4: Run tests; verify all PSL-002 cases pass.**

- [ ] **Step 5: Run the script against the live tree.**
  ```bash
  pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts | head -120
  ```
  Expected: a mix of PSL-001 and PSL-002 findings.

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/web/scripts/
  git commit -s -m "feat(audit): PSL-002 unsourced grant enumeration"
  ```

---

## Task 4: PSL-003 current-state grant snapshots

**Why:** Catches "you currently have X" / `currently ["..."]` / `currently holds` framings that don't get caught by PSL-001's exact-phrase list.

**Files:**
- Modify: `apps/web/scripts/audit-prompt-state-leakage.ts`
- Modify: `apps/web/scripts/audit-prompt-state-leakage.test.ts`

**Steps:**

- [ ] **Step 1: Tests.**

  ```ts
  import { matchPsl003 } from "./audit-prompt-state-leakage";

  describe("PSL-003 current-state grant snapshots", () => {
    it('matches `currently ["foo","bar"]`', () => {
      const out = matchPsl003('the grants are currently ["backlog_read","sandbox_execute"]', "x.md");
      expect(out).toHaveLength(1);
    });

    it("matches `currently holds`", () => {
      const out = matchPsl003("This agent currently holds backlog_read", "x.md");
      expect(out).toHaveLength(1);
    });

    it("matches `you currently have`", () => {
      const out = matchPsl003("You currently have these grants:", "x.md");
      expect(out).toHaveLength(1);
    });

    it("matches `grants you currently hold`", () => {
      const out = matchPsl003("List of grants you currently hold:", "x.md");
      expect(out).toHaveLength(1);
    });

    it("does not match a citation that says PAGE DATA is authoritative", () => {
      const text =
        "Tool list is delivered by the runtime via PAGE DATA. The registry path is a non-authoritative reference; you currently have whatever PAGE DATA shows.";
      const out = matchPsl003(text, "x.md");
      expect(out).toHaveLength(0);
    });
  });
  ```

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement.**

  ```ts
  // ─── PSL-003: current-state grant snapshots ────────────────────────────────

  const PSL_003_PATTERNS: Array<{ regex: RegExp; phrase: string }> = [
    { regex: /currently\s+`?\[[^\]]*"[^"]+"[^\]]*\]`?/i, phrase: "currently [\"...\"]" },
    { regex: /currently holds?\b/i, phrase: "currently holds" },
    { regex: /you currently have\b/i, phrase: "you currently have" },
    { regex: /grants you currently hold/i, phrase: "grants you currently hold" },
  ];

  // The escape clause from spec §6 PSL-003 — if the line points the model at
  // PAGE DATA / runtime as authoritative, the legacy phrasing is allowed.
  const PSL_003_AUTHORITATIVE_HINT_RE = /\b(?:PAGE DATA|runtime tool list)\b.{0,200}\b(?:authoritative|delivered|non-authoritative)\b/i;

  export function matchPsl003(body: string, file: string): Finding[] {
    const out: Finding[] = [];
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Look at a sliding window of ±1 line so we can see the "PAGE DATA is authoritative"
      // exception when it's split across the same paragraph.
      const context = [lines[i - 1] ?? "", line, lines[i + 1] ?? ""].join(" ");
      if (PSL_003_AUTHORITATIVE_HINT_RE.test(context)) continue;
      for (const { regex, phrase } of PSL_003_PATTERNS) {
        const m = line.match(regex);
        if (m && typeof m.index === "number") {
          out.push({
            invariantId: "PSL-003",
            severity: "error",
            file,
            line: i + 1,
            column: m.index + 1,
            match: m[0],
            summary: `[PSL-003] current-state grant snapshot: "${phrase}"`,
            detail:
              `The phrase "${phrase}" frames the prompt as a snapshot of current runtime grants, which rots. Either remove the snapshot, or annotate the paragraph so the runtime tool list / PAGE DATA is authoritative.\n\nSee docs/superpowers/specs/2026-04-30-prompt-state-leakage-lint-design.md §6 PSL-003.`,
          });
        }
      }
    }
    return out;
  }

  function checkPsl003(promptFiles: string[]): void {
    for (const relPath of promptFiles) {
      const abs = join(ROOT, relPath);
      const text = readFileSync(abs, "utf8");
      for (const f of matchPsl003(text, relPath)) findings.push(f);
    }
  }
  ```

  Wire `checkPsl003(promptFiles);` into `main()`.

- [ ] **Step 4: Run tests; verify pass.**

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/web/scripts/
  git commit -s -m "feat(audit): PSL-003 current-state grant snapshots"
  ```

---

## Task 5: PSL-004 runtime-disabling instruction (warn-only)

**Why:** Per spec §6, this rule is intentionally warn-only because many specialist prompts document `currently aspirational` grant gaps that may be true. Promoting to error needs a separate review of those prompts. Land warn-only so we have signal without blocking.

**Files:**
- Modify: `apps/web/scripts/audit-prompt-state-leakage.ts`
- Modify: `apps/web/scripts/audit-prompt-state-leakage.test.ts`

**Steps:**

- [ ] **Step 1: Tests.**

  ```ts
  import { matchPsl004 } from "./audit-prompt-state-leakage";

  describe("PSL-004 runtime-disabling instruction", () => {
    it("warns on `do not use X tools because they are pending`", () => {
      const out = matchPsl004("Do not use sandbox tools because they are pending grant assignment.", "x.md");
      expect(out).toHaveLength(1);
      expect(out[0]!.severity).toBe("warn");
    });

    it("warns on `aspirational` framing without runtime evidence pointer", () => {
      const out = matchPsl004("These tool grants are currently aspirational.", "x.md");
      expect(out).toHaveLength(1);
      expect(out[0]!.severity).toBe("warn");
    });

    it("does not warn when the line points at runtime evidence", () => {
      const out = matchPsl004(
        "These tool grants are currently aspirational; check the runtime tool list (PAGE DATA) for what is actually delivered.",
        "x.md",
      );
      expect(out).toHaveLength(0);
    });
  });
  ```

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement.**

  ```ts
  // ─── PSL-004: runtime-disabling instruction (warn-only) ───────────────────

  const PSL_004_PATTERNS: Array<{ regex: RegExp; phrase: string }> = [
    { regex: /do not use [^.]+because [^.]+(?:pending|aspirational|unavailable|unhonored)/i, phrase: "do not use ... because pending/aspirational" },
    { regex: /\bcurrently aspirational\b/i, phrase: "currently aspirational" },
    { regex: /\bgrants? are not (?:yet )?(?:live|honored)\b/i, phrase: "grants are not (yet) live/honored" },
  ];

  const PSL_004_RUNTIME_EVIDENCE_RE = /\b(?:PAGE DATA|runtime tool list|delivered tool list)\b/i;

  export function matchPsl004(body: string, file: string): Finding[] {
    const out: Finding[] = [];
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const context = [lines[i - 1] ?? "", line, lines[i + 1] ?? ""].join(" ");
      if (PSL_004_RUNTIME_EVIDENCE_RE.test(context)) continue;
      for (const { regex, phrase } of PSL_004_PATTERNS) {
        const m = line.match(regex);
        if (m && typeof m.index === "number") {
          out.push({
            invariantId: "PSL-004",
            severity: "warn",
            file,
            line: i + 1,
            column: m.index + 1,
            match: m[0],
            summary: `[PSL-004] runtime-disabling instruction: "${phrase}"`,
            detail:
              `This line tells the model that listed tools are pending/aspirational/unhonored without pointing the model at the runtime tool list as authoritative. Either remove the framing or add an explicit pointer to the runtime / PAGE DATA.\n\nSee docs/superpowers/specs/2026-04-30-prompt-state-leakage-lint-design.md §6 PSL-004 — warn-only until a separate review covers the broader 'currently aspirational' family.`,
          });
        }
      }
    }
    return out;
  }

  function checkPsl004(promptFiles: string[]): void {
    for (const relPath of promptFiles) {
      const abs = join(ROOT, relPath);
      const text = readFileSync(abs, "utf8");
      for (const f of matchPsl004(text, relPath)) findings.push(f);
    }
  }
  ```

  Wire into `main()`.

- [ ] **Step 4: Run tests + script. Verify warns appear in the report under `warnCount` and `severity="warn"` findings.**

  PSL-001/002/003 are error-level and the existing violations in the live tree will keep the exit code at 1 until the baseline is generated in Task 8. PSL-004 warns are reported but never block on their own.

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/web/scripts/
  git commit -s -m "feat(audit): PSL-004 runtime-disabling instruction (warn-only)"
  ```

---

## Task 6: Baseline diff

**Why:** The 8+ existing violations need to be grandfathered. Match the persona-audit's `--baseline` semantics: existing keys tolerated, new keys block.

**Files:**
- Modify: `apps/web/scripts/audit-prompt-state-leakage.ts`
- Modify: `apps/web/scripts/audit-prompt-state-leakage.test.ts`

**Steps:**

- [ ] **Step 1: Read [`apps/web/scripts/audit-coworker-personas.ts:509-633`](../../../apps/web/scripts/audit-coworker-personas.ts#L509-L633) for the diff pattern.** Note: the persona audit's `findingKey` includes `agentId`. Ours does NOT include line; it uses `invariantId::file::normalize(match)` per spec §7.1.

- [ ] **Step 2: Tests.**

  ```ts
  import { diffAgainstBaseline } from "./audit-prompt-state-leakage";

  describe("baseline diff", () => {
    const baselineReport = {
      generatedAt: "x", spec: "x", rulesChecked: 4, errorCount: 1, warnCount: 0,
      findings: [
        { invariantId: "PSL-001" as const, severity: "error" as const, file: "a.md", line: 1, column: 1, match: "currently []", summary: "x", detail: "x" },
      ],
    };
    it("reports new findings as new", () => {
      const current = [
        ...baselineReport.findings,
        { invariantId: "PSL-001" as const, severity: "error" as const, file: "b.md", line: 1, column: 1, match: "currently []", summary: "x", detail: "x" },
      ];
      const diff = diffAgainstBaseline(current, baselineReport);
      expect(diff.newViolations).toHaveLength(1);
      expect(diff.newViolations[0]!.file).toBe("b.md");
      expect(diff.unchanged).toHaveLength(1);
    });
    it("reports resolved findings", () => {
      const diff = diffAgainstBaseline([], baselineReport);
      expect(diff.resolvedViolations).toHaveLength(1);
    });
  });
  ```

- [ ] **Step 3: Implement.**

  Add after `matchPsl004`:

  ```ts
  // ─── Baseline diff ─────────────────────────────────────────────────────────

  interface BaselineDiff {
    newViolations: Finding[];
    resolvedViolations: Finding[];
    unchanged: Finding[];
  }

  export function diffAgainstBaseline(current: Finding[], baseline: Report): BaselineDiff {
    const baselineKeys = new Set(baseline.findings.map(findingKey));
    const currentKeys = new Set(current.map(findingKey));
    return {
      newViolations: current.filter((f) => !baselineKeys.has(findingKey(f))),
      resolvedViolations: baseline.findings.filter((f) => !currentKeys.has(findingKey(f))),
      unchanged: current.filter((f) => baselineKeys.has(findingKey(f))),
    };
  }

  function loadBaseline(path: string): Report | null {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as Report;
  }
  ```

  Wire into `main()` — replace the placeholder exit logic with:

  ```ts
  let exitCode = 0;
  if (baselinePath) {
    const baseline = loadBaseline(baselinePath);
    if (baseline === null) {
      console.error(`[audit] baseline ${baselinePath} not found — treating all findings as new`);
      exitCode = errorCount > 0 ? 1 : 0;
    } else {
      const diff = diffAgainstBaseline(report.findings, baseline);
      console.error(
        `[audit] baseline diff: unchanged=${diff.unchanged.length} ` +
        `resolved=${diff.resolvedViolations.length} new=${diff.newViolations.length}`,
      );
      const newErrors = diff.newViolations.filter((f) => f.severity === "error");
      if (newErrors.length > 0) {
        console.error(`\n[audit] NEW ERROR-LEVEL VIOLATIONS BLOCK MERGE:`);
        for (const f of newErrors) console.error(`  [${f.invariantId}] ${f.file}:${f.line} ${f.match}`);
        exitCode = 1;
      }
      if (diff.resolvedViolations.length > 0) {
        console.error(`\n[audit] resolved (can be removed from baseline):`);
        for (const f of diff.resolvedViolations) console.error(`  [${f.invariantId}] ${f.file} ${f.match}`);
      }
    }
  } else {
    exitCode = errorCount > 0 ? 1 : 0;
  }
  ```

- [ ] **Step 4: Run tests; verify pass.**

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/web/scripts/
  git commit -s -m "feat(audit): baseline diff against tracked report"
  ```

---

## Task 7: Shrink-only baseline guard

**Why:** Spec §7.3 — a PR must not be able to silence a new violation by adding it to the baseline. Implement as `--baseline-may-only-shrink-from <path>` so local verification matches CI.

**Files:**
- Modify: `apps/web/scripts/audit-prompt-state-leakage.ts`
- Modify: `apps/web/scripts/audit-prompt-state-leakage.test.ts`

**Steps:**

- [ ] **Step 1: Tests.**

  ```ts
  import { detectBaselineGrowth } from "./audit-prompt-state-leakage";

  describe("shrink-only baseline guard", () => {
    const make = (file: string, match: string) => ({
      invariantId: "PSL-001" as const,
      severity: "error" as const,
      file, line: 1, column: 1, match, summary: "x", detail: "x",
    });
    const base: Report = {
      generatedAt: "x", spec: "x", rulesChecked: 4, errorCount: 1, warnCount: 0,
      findings: [make("a.md", "currently []")],
    };
    it("passes when current baseline is a subset of base baseline", () => {
      const current: Report = { ...base, findings: [] };
      const grew = detectBaselineGrowth(base, current);
      expect(grew).toEqual([]);
    });
    it("fails when current baseline added a key", () => {
      const current: Report = {
        ...base,
        findings: [...base.findings, make("b.md", "pending follow-on assignment")],
      };
      const grew = detectBaselineGrowth(base, current);
      expect(grew).toHaveLength(1);
      expect(grew[0]!.file).toBe("b.md");
    });
  });
  ```

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement.**

  Add:

  ```ts
  // ─── Shrink-only baseline guard ────────────────────────────────────────────

  export function detectBaselineGrowth(base: Report, current: Report): Finding[] {
    const baseKeys = new Set(base.findings.map(findingKey));
    return current.findings.filter((f) => !baseKeys.has(findingKey(f)));
  }
  ```

  In `main()`, after the baseline-diff block:

  ```ts
  if (shrinkFromPath) {
    const shrinkBase = loadBaseline(shrinkFromPath);
    const currentBaseline = baselinePath ? loadBaseline(baselinePath) : null;
    if (shrinkBase && currentBaseline) {
      const grew = detectBaselineGrowth(shrinkBase, currentBaseline);
      if (grew.length > 0) {
        console.error(`\n[audit] BASELINE GROWTH BLOCKED — these keys were added vs. ${shrinkFromPath}:`);
        for (const f of grew) console.error(`  [${f.invariantId}] ${f.file} ${f.match}`);
        exitCode = 1;
      }
    } else {
      console.error(`[audit] could not load shrink-from baseline at ${shrinkFromPath}, skipping`);
    }
  }
  ```

- [ ] **Step 4: Run tests; verify pass.**

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/web/scripts/
  git commit -s -m "feat(audit): shrink-only baseline guard"
  ```

---

## Task 8: Generate the initial baseline

**Why:** Existing 8+ violations need to be grandfathered so the introducing PR passes CI.

**Files:**
- Create: `docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json`

**Steps:**

- [ ] **Step 1: Generate the baseline using `--json-out`.**
  ```bash
  pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts \
    --json-out docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json
  ```
  This emits the report to stdout (pipe to /dev/null if you want) AND writes the JSON file.

  Expected: the baseline file lists all current PSL-001/002/003 errors and PSL-004 warns. Exit code 1 (because errors exist; this is OK for the generation step).

- [ ] **Step 2: Verify the baseline file contents.**

  Inspect counts and file list using node (no `jq` dependency):

  ```bash
  pnpm --filter web exec tsx -e "const r = JSON.parse(require('fs').readFileSync('docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json', 'utf8')); console.log('errorCount=' + r.errorCount, 'warnCount=' + r.warnCount, 'total=' + r.findings.length); console.log('files:'); console.log([...new Set(r.findings.map(f => f.file))].sort().join('\\n'));"
  ```

  Expected: errorCount ≥ 8 (one or more error-level finding per named route-persona prompt), total = errorCount + warnCount. The file list contains at minimum the 8 named route-persona prompts from spec §1 (admin-assistant, build-specialist, customer-advisor, ea-architect, hr-specialist, ops-coordinator, platform-engineer, portfolio-advisor). May include specialist/ entries if PSL-004 fires on them — that's expected and warn-only.

- [ ] **Step 3: Re-run the script with `--baseline` and confirm exit 0.**
  ```bash
  pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts \
    --baseline docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json
  echo "exit=$?"
  ```
  Expected: stderr says `unchanged=N resolved=0 new=0`, exit code 0.

- [ ] **Step 4: Negative-control — temporarily add a forbidden phrase to a scratch prompt and confirm exit 1.**

  Edit any persona prompt (e.g. `prompts/route-persona/build-specialist.prompt.md`) and add the line `currently [] (scratch test)` somewhere in the body. Run the script with `--baseline`:

  ```bash
  pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts \
    --baseline docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json
  echo "exit=$?"
  ```
  Expected: stderr says `new=1`, lists `[PSL-001] ... currently []`, exit code 1.

  Revert the scratch edit:
  ```bash
  git restore prompts/route-persona/build-specialist.prompt.md
  ```
  Re-run; confirm exit 0.

- [ ] **Step 5: Commit.**
  ```bash
  git add docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json
  git commit -s -m "feat(audit): initial prompt state-leakage baseline"
  ```

---

## Task 9: GitHub Actions workflow

**Why:** CI gate — without the workflow, the audit only runs locally.

**Files:**
- Create: `.github/workflows/audit-prompt-state-leakage.yml`

**Steps:**

- [ ] **Step 1: Read [`.github/workflows/audit-coworker-personas.yml`](../../../.github/workflows/audit-coworker-personas.yml) end-to-end.** Use it as a literal template; only paths and names change.

- [ ] **Step 2: Create the workflow file.**

  ```yaml
  name: Prompt State-Leakage Audit

  on:
    pull_request:
      branches: [main]
      paths:
        - "prompts/**/*.prompt.md"
        - "apps/web/scripts/audit-prompt-state-leakage.ts"
        - "apps/web/scripts/audit-prompt-state-leakage.test.ts"
        - "docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json"
        - ".github/workflows/audit-prompt-state-leakage.yml"
    push:
      branches: [main]

  concurrency:
    group: audit-prompt-state-leakage-${{ github.ref }}
    cancel-in-progress: true

  # What this guard does
  # --------------------
  # Runs apps/web/scripts/audit-prompt-state-leakage.ts against the prompt
  # library. Compares against a tracked baseline at
  # docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json
  # and fails ONLY when NEW error-level violations appear vs. the baseline.
  # Pre-existing violations are tracked as backfill items and do not block
  # merges.
  #
  # The shrink-only guard fetches the base branch's copy of the baseline
  # and refuses any PR that adds keys to the baseline (laundering protection).
  #
  # Spec: docs/superpowers/specs/2026-04-30-prompt-state-leakage-lint-design.md

  jobs:
    audit:
      name: Prompt State-Leakage Audit
      runs-on: ubuntu-latest

      steps:
        - uses: actions/checkout@v6
          with:
            fetch-depth: 0  # need base branch for shrink-only guard

        - name: Set up Node.js
          uses: actions/setup-node@v6
          with:
            node-version: 24

        - name: Install pnpm
          run: corepack enable && corepack prepare pnpm@10.33.2 --activate

        - name: Install dependencies
          run: pnpm install --frozen-lockfile

        - name: Fetch base branch baseline (for shrink-only guard)
          if: github.event_name == 'pull_request'
          run: |
            git fetch origin ${{ github.base_ref }} --depth=1
            mkdir -p /tmp/base-baseline
            git show origin/${{ github.base_ref }}:docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json \
              > /tmp/base-baseline/baseline.json 2>/dev/null || echo '{"generatedAt":"","spec":"","rulesChecked":4,"errorCount":0,"warnCount":0,"findings":[]}' > /tmp/base-baseline/baseline.json

        - name: Run prompt state-leakage audit
          run: |
            pnpm --filter web exec tsx \
              scripts/audit-prompt-state-leakage.ts \
              --baseline docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json \
              ${{ github.event_name == 'pull_request' && '--baseline-may-only-shrink-from /tmp/base-baseline/baseline.json' || '' }} \
              > audit-current.json
          continue-on-error: false

        - name: Upload audit report
          if: always()
          uses: actions/upload-artifact@v4
          with:
            name: prompt-state-leakage-audit
            path: audit-current.json
            retention-days: 14
  ```

- [ ] **Step 3: Validate YAML locally.**
  ```bash
  pnpm --filter web exec tsx -e "import {readFileSync} from 'node:fs'; import {parse} from 'yaml'; console.log(JSON.stringify(parse(readFileSync('.github/workflows/audit-prompt-state-leakage.yml','utf8')), null, 2).slice(0, 400));"
  ```
  Expected: parses to JSON, no errors. *(If `yaml` package isn't present, skip — actionlint will catch issues in CI.)*

- [ ] **Step 4: Commit.**
  ```bash
  git add .github/workflows/audit-prompt-state-leakage.yml
  git commit -s -m "feat(audit): GitHub Actions workflow for prompt state-leakage audit"
  ```

---

## Task 10: Verification & PR

**Why:** AGENTS.md §5 build gate; final clean run; PR.

**Steps:**

- [ ] **Step 1: Full vitest pass.**
  ```bash
  pnpm --filter web exec vitest run apps/web/scripts/audit-prompt-state-leakage.test.ts
  ```
  Expected: all tests pass.

- [ ] **Step 2: Typecheck.**
  ```bash
  pnpm --filter web typecheck
  ```
  Expected: zero errors.

- [ ] **Step 3: Production build (per AGENTS.md §5).**
  ```bash
  pnpm --filter web build
  ```
  Expected: build succeeds, zero errors. The script lives in the apps/web TS project so any typing issue surfaces here.

- [ ] **Step 4: Final clean run with baseline.**
  ```bash
  pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts \
    --baseline docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json
  echo "exit=$?"
  ```
  Expected: exit 0, stderr `unchanged=N resolved=0 new=0`.

- [ ] **Step 4b: End-to-end test of the shrink-only baseline guard (per spec §10 step 4).**

  Copy the committed baseline, hand-edit the copy to add a synthetic finding, and run the script with both `--baseline` and `--baseline-may-only-shrink-from`:

  ```bash
  cp docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json /tmp/base-baseline.json
  pnpm --filter web exec tsx -e "const fs=require('fs'); const p='docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json'; const r=JSON.parse(fs.readFileSync(p,'utf8')); r.findings.push({invariantId:'PSL-001',severity:'error',file:'scratch.md',line:1,column:1,match:'currently []',summary:'synthetic',detail:'synthetic'}); fs.writeFileSync(p, JSON.stringify(r,null,2)+'\\n');"
  pnpm --filter web exec tsx scripts/audit-prompt-state-leakage.ts \
    --baseline docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json \
    --baseline-may-only-shrink-from /tmp/base-baseline.json
  echo "exit=$?"
  ```

  Expected: stderr says `BASELINE GROWTH BLOCKED — these keys were added vs. /tmp/base-baseline.json` and lists the synthetic finding, exit code 1.

  Restore the committed baseline:
  ```bash
  git restore docs/superpowers/audits/2026-04-30-prompt-state-leakage-baseline.json
  rm /tmp/base-baseline.json
  ```

  Re-run Step 4 to confirm exit 0 again.

- [ ] **Step 5: Push the branch.**
  ```bash
  git push -u origin feat/prompt-state-leakage-lint
  ```

- [ ] **Step 6: Open the PR.**
  ```bash
  gh pr create --title "feat(audit): prompt state-leakage lint" --body "$(cat <<'EOF'
  ## Summary

  CI gate that prevents persona prompts from documenting runtime state — the bug class that caused the BI-E9CD1B92 lifecycle test to fail on 2026-04-30 (build-specialist quoted near-verbatim "currently `[]` (empty), pending follow-on assignment" from its own prompt and refused to call its 21 delivered tools).

  Implements [the spec](docs/superpowers/specs/2026-04-30-prompt-state-leakage-lint-design.md) and follows [the plan](docs/superpowers/plans/2026-04-30-prompt-state-leakage-lint.md).

  - Four rules: PSL-001 forbidden phrases (error), PSL-002 unsourced grant enumeration (error), PSL-003 current-state grant snapshots (error), PSL-004 runtime-disabling instruction (warn-only, pending separate review of the `currently aspirational` family).
  - Shrink-only baseline guard prevents PRs from silencing new violations by laundering them into the baseline.
  - Initial baseline grandfathers the existing violations across the prompt library; future prompt rewrites shrink the baseline as they land.

  Mirrors the existing [coworker-personas audit pattern](.github/workflows/audit-coworker-personas.yml).

  ## Test plan

  - [ ] All vitest tests pass: `pnpm --filter web exec vitest run apps/web/scripts/audit-prompt-state-leakage.test.ts`
  - [ ] Production build clean: `pnpm --filter web build`
  - [ ] Negative-control: adding a forbidden phrase to a scratch prompt makes the audit fail with the expected `[PSL-001]` finding
  - [ ] Shrink-only guard: adding a key to the baseline triggers `BASELINE GROWTH BLOCKED`
  - [ ] CI workflow runs green on this PR (existing violations grandfathered)

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

- [ ] **Step 7: Verify CI runs the new audit and passes.** Watch GitHub Actions on the PR; the new "Prompt State-Leakage Audit" workflow should appear and conclude SUCCESS.

---

## Out of scope for this plan

- Pre-commit hook integration (deferred per spec §11).
- Stale model-ID lint (separate spec, separate PR).
- Promoting PSL-004 from warn-only to error — needs a review of the `currently aspirational` family in the coworker self-assessment first.
- Rewriting any of the 8+ violating prompts. Their rewrites are sequenced via wave-2 and wave-4 prompt work and will shrink the baseline as they land.
