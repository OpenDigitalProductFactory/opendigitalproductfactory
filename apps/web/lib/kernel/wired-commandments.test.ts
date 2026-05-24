/**
 * Live-file verification that the two tier-1 commandments wired in Phase 3
 * have parseable principleRuntimeEnforcement blocks and that those blocks
 * pass the gate's pattern matchers.
 *
 * This is the bridge test between Phase 2's structural plumbing and Phase 9's
 * full live verification — proves the frontmatter + parser + gate compose
 * end-to-end with the real principle files on disk.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, type WikiPageFrontmatter } from "@dpf/db/wiki-frontmatter";
import { evaluateExecution, type EnforceablePrinciple } from "./runtime-gate";

// __dirname = apps/web/lib/kernel → 4 `..` to reach repo root.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

function loadPrinciple(slug: string): EnforceablePrinciple {
  const path = join(REPO_ROOT, "docs/founder-kernel/wiki/principles", `${slug}.md`);
  const raw = readFileSync(path, "utf8");
  const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(raw);
  const rte = frontmatter.principleRuntimeEnforcement;
  if (!rte) throw new Error(`No principleRuntimeEnforcement in ${slug}`);
  return {
    id: slug,
    slug,
    tier: frontmatter.principleTier as EnforceablePrinciple["tier"],
    runtime: {
      interactiveMode: rte.interactiveMode,
      autonomousMode: rte.autonomousMode,
      patterns: rte.patterns,
    },
  };
}

describe("Phase 3 wired commandments", () => {
  it("never-wipe-db-for-code-fixes refuses docker volume rm autonomously", () => {
    const p = loadPrinciple("never-wipe-db-for-code-fixes");
    const d = evaluateExecution(
      { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
      "autonomous",
      [p],
    );
    expect(d.verdict).toBe("refuse");
  });

  it("never-wipe-db-for-code-fixes refuses prisma migrate reset autonomously", () => {
    const p = loadPrinciple("never-wipe-db-for-code-fixes");
    const d = evaluateExecution(
      { kind: "shell", command: "prisma", args: ["migrate", "reset"] },
      "autonomous",
      [p],
    );
    expect(d.verdict).toBe("refuse");
  });

  it("never-wipe-db-for-code-fixes refuses pnpm --filter @dpf/db exec prisma migrate reset", () => {
    const p = loadPrinciple("never-wipe-db-for-code-fixes");
    const d = evaluateExecution(
      { kind: "shell", command: "pnpm", args: ["--filter", "@dpf/db", "exec", "prisma", "migrate", "reset"] },
      "autonomous",
      [p],
    );
    expect(d.verdict).toBe("refuse");
  });

  it("never-wipe-db-for-code-fixes refuses DROP DATABASE dpf (case-insensitive)", () => {
    const p = loadPrinciple("never-wipe-db-for-code-fixes");
    const d = evaluateExecution(
      { kind: "sql", statement: "drop database dpf" },
      "autonomous",
      [p],
    );
    expect(d.verdict).toBe("refuse");
  });

  it("destructive-actions-require-explicit-go refuses git push --force to main", () => {
    const p = loadPrinciple("destructive-actions-require-explicit-go");
    const d = evaluateExecution(
      { kind: "git", subcommand: "push", args: ["--force", "origin", "main"] },
      "autonomous",
      [p],
    );
    expect(d.verdict).toBe("refuse");
  });

  it("destructive-actions-require-explicit-go refuses git reset --hard", () => {
    const p = loadPrinciple("destructive-actions-require-explicit-go");
    const d = evaluateExecution(
      { kind: "shell", command: "git", args: ["reset", "--hard", "HEAD~1"] },
      "autonomous",
      [p],
    );
    expect(d.verdict).toBe("refuse");
  });

  it("benign commands are allowed", () => {
    const p1 = loadPrinciple("never-wipe-db-for-code-fixes");
    const p2 = loadPrinciple("destructive-actions-require-explicit-go");
    const d = evaluateExecution(
      { kind: "shell", command: "docker", args: ["ps"] },
      "autonomous",
      [p1, p2],
    );
    expect(d).toEqual({ verdict: "allow" });
  });

  it("interactive session gets require_confirm instead of refuse", () => {
    const p = loadPrinciple("never-wipe-db-for-code-fixes");
    const d = evaluateExecution(
      { kind: "shell", command: "docker", args: ["volume", "rm", "dpf_pgdata"] },
      "interactive",
      [p],
    );
    expect(d.verdict).toBe("require_confirm");
  });
});
