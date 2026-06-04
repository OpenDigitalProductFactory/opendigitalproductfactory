import { describe, it, expect } from "vitest";
import { join } from "node:path";

import { planKernelMemorySeed } from "../memory-seed";

const FIXTURES_DIR = join(__dirname, "fixtures", "kernel-principles-subset");

describe("planKernelMemorySeed", () => {
  it("projects all selected principles for a fresh contributor memory dir", () => {
    const plan = planKernelMemorySeed(
      FIXTURES_DIR,
      "/tmp/contributor-memory",
      "D--DPF",
      {
        fs: {
          existsSync: () => false,
        },
      },
    );

    // 5 fixture principles, all create
    expect(plan.writes).toHaveLength(5);
    expect(plan.writes.every((w) => w.mode === "create")).toBe(true);
    expect(plan.indexEntry).not.toBeNull();
    expect(plan.indexEntry!.content).toMatch(/never-ask-user-to-run-commands/);
    expect(plan.indexEntry!.content).toMatch(/Kernel principles \(auto-seeded/);
  });

  it("restricts to commandment-tier only when flag is set", () => {
    const plan = planKernelMemorySeed(
      FIXTURES_DIR,
      "/tmp/contributor-memory",
      "D--DPF",
      {
        commandmentTierOnly: true,
        fs: { existsSync: () => false },
      },
    );

    // 3 commandment-tier fixtures: never-ask, structural-not-functional, destructive-explicit-go
    expect(plan.writes).toHaveLength(3);
    const slugs = plan.writes.map((w) => w.path).sort();
    expect(slugs[0]).toMatch(/kernel_destructive-actions-require-explicit-go\.md$/);
    expect(slugs[1]).toMatch(/kernel_never-ask-user-to-run-commands\.md$/);
    expect(slugs[2]).toMatch(/kernel_structural-verification-is-not-functional\.md$/);

    // Index includes only commandments.
    expect(plan.indexEntry!.content).toMatch(/never-ask-user-to-run-commands/);
    expect(plan.indexEntry!.content).not.toMatch(/evidence-before-diagnosis/);
    expect(plan.indexEntry!.content).not.toMatch(/design-research-required/);
  });

  it("preserves user edits when destination mtime is newer than baseline", () => {
    const baseline = "2026-05-25T00:00:00.000Z";
    const baselineMs = new Date(baseline).getTime();
    const userEditTime = new Date(baselineMs + 60_000); // 1 minute after install

    const plan = planKernelMemorySeed(
      FIXTURES_DIR,
      "/tmp/contributor-memory",
      "D--DPF",
      {
        commandmentTierOnly: true,
        installTimeBaseline: baseline,
        fs: {
          // EAFP: the implementation now reads before checking existence.
          // Provide readFileSync so the simulated-existing dest file doesn't
          // throw ENOENT (which would reset it to "create" mode).
          // We identify dest files by the contributorMemoryDir segment in their
          // path, not by a forward-slash prefix (which node/path.join converts
          // to backslashes on Windows).
          readFileSync: (p: string, e: BufferEncoding): string => {
            if (p.endsWith("kernel_never-ask-user-to-run-commands.md") &&
                p.includes("contributor-memory")) {
              // Simulate user-edited content; mtime check is what matters here.
              return "<<user-edited-content>>";
            }
            // Source principle files — delegate to real FS.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            return (require("node:fs").readFileSync as (p: string, e: BufferEncoding) => string)(p, e);
          },
          statSync: () => ({ mtime: userEditTime }),
        },
      },
    );

    // User-edited file is skipped from writes but still appears in index.
    const paths = plan.writes.map((w) => w.path);
    expect(paths.some((p) => p.endsWith("kernel_never-ask-user-to-run-commands.md"))).toBe(false);
    expect(plan.writes).toHaveLength(2);
    expect(plan.indexEntry!.content).toMatch(/user-edited, preserved/);
  });

  it("treats older-than-baseline mtime as a normal update", () => {
    const baseline = "2026-05-25T00:00:00.000Z";
    const oldEditTime = new Date(0); // epoch

    const plan = planKernelMemorySeed(
      FIXTURES_DIR,
      "/tmp/contributor-memory",
      "D--DPF",
      {
        commandmentTierOnly: true,
        installTimeBaseline: baseline,
        fs: {
          // EAFP: provide readFileSync so dest files "exist" for the read.
          // Return content that differs from what would be written so all three
          // get mode: "update" (not "skipBecauseUnchanged").
          // Identify dest files via "contributor-memory" path segment (works on
          // both Windows and POSIX since node/path.join handles the separator).
          readFileSync: (p: string, e: BufferEncoding): string => {
            if (p.includes("contributor-memory")) {
              return "<<stale-content-from-old-dpf-platform-version>>";
            }
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            return (require("node:fs").readFileSync as (p: string, e: BufferEncoding) => string)(p, e);
          },
          statSync: () => ({ mtime: oldEditTime }),
        },
      },
    );

    expect(plan.writes).toHaveLength(3);
    expect(plan.writes.every((w) => w.mode === "update")).toBe(true);
  });

  it("renders memory files with required frontmatter and source pointer", () => {
    const plan = planKernelMemorySeed(
      FIXTURES_DIR,
      "/tmp/contributor-memory",
      "D--DPF",
      { commandmentTierOnly: true, fs: { existsSync: () => false } },
    );

    const neverAsk = plan.writes.find((w) =>
      w.path.endsWith("kernel_never-ask-user-to-run-commands.md"),
    );
    expect(neverAsk).toBeDefined();
    expect(neverAsk!.content).toMatch(/^---\n/);
    expect(neverAsk!.content).toMatch(/kernel-tier: commandment/);
    expect(neverAsk!.content).toMatch(/slug: never-ask-user-to-run-commands/);
    expect(neverAsk!.content).toMatch(
      /Source: docs\/founder-kernel\/wiki\/principles\/never-ask-user-to-run-commands\.md/,
    );
    expect(neverAsk!.content).toMatch(/Do not edit here\./);
  });

  it("re-run is zero-write when destination content equals planned content (Phase 6)", () => {
    // Phase 5 observation: re-running the adapter re-applied all 17 memory
    // writes every time because the planner emitted `update` mode even when
    // the destination file content was identical to what would be written.
    // Phase 6 idempotence: when content matches, skip the write entirely.

    // First pass: collect what the planner would write so we can stub a FS
    // shim that returns that exact content on the second pass.
    const firstPass = planKernelMemorySeed(
      FIXTURES_DIR,
      "/tmp/contributor-memory",
      "D--DPF",
      {
        commandmentTierOnly: true,
        fs: { existsSync: () => false },
      },
    );
    expect(firstPass.writes.length).toBeGreaterThan(0);
    const contentByPath = new Map(firstPass.writes.map((w) => [w.path, w.content]));
    // Plus the index entry, if one was emitted.
    if (firstPass.indexEntry) {
      contentByPath.set(firstPass.indexEntry.path, firstPass.indexEntry.content);
    }

    // Second pass: every dest exists and has the exact content the planner
    // would write. Expect zero writes and no index re-emit.
    const secondPass = planKernelMemorySeed(
      FIXTURES_DIR,
      "/tmp/contributor-memory",
      "D--DPF",
      {
        commandmentTierOnly: true,
        fs: {
          existsSync: (p: string) => contentByPath.has(p),
          // For dest paths (those in contentByPath) return the stored bytes;
          // for source-principle paths (under FIXTURES_DIR) delegate to real
          // node:fs so frontmatter parsing still works.
          readFileSync: (p: string, e: BufferEncoding) =>
            contentByPath.has(p)
              ? (contentByPath.get(p) as string)
              : (require("node:fs").readFileSync(p, e) as string),
          statSync: () => ({ mtime: new Date(0) }),
        },
      },
    );

    expect(secondPass.writes).toEqual([]);
    expect(secondPass.indexEntry).toBeNull();
    expect(secondPass.rationale).toMatch(/already converged/);
  });

  it("re-emits a write when destination content drifts from planned", () => {
    // Same shape as the idempotence test, but one destination has different
    // content (representing a prior installer version or a different DPF
    // platform version). The planner should re-emit that one write.
    const firstPass = planKernelMemorySeed(
      FIXTURES_DIR,
      "/tmp/contributor-memory",
      "D--DPF",
      {
        commandmentTierOnly: true,
        fs: { existsSync: () => false },
      },
    );
    const driftedPath = firstPass.writes[0].path;
    const contentByPath = new Map(firstPass.writes.map((w) => [w.path, w.content]));
    contentByPath.set(driftedPath, "<<old-content-from-previous-dpf-platform-version>>");
    if (firstPass.indexEntry) {
      contentByPath.set(firstPass.indexEntry.path, firstPass.indexEntry.content);
    }

    const secondPass = planKernelMemorySeed(
      FIXTURES_DIR,
      "/tmp/contributor-memory",
      "D--DPF",
      {
        commandmentTierOnly: true,
        fs: {
          existsSync: (p: string) => contentByPath.has(p),
          // For dest paths (those in contentByPath) return the stored bytes;
          // for source-principle paths (under FIXTURES_DIR) delegate to real
          // node:fs so frontmatter parsing still works.
          readFileSync: (p: string, e: BufferEncoding) =>
            contentByPath.has(p)
              ? (contentByPath.get(p) as string)
              : (require("node:fs").readFileSync(p, e) as string),
          statSync: () => ({ mtime: new Date(0) }),
        },
      },
    );

    expect(secondPass.writes).toHaveLength(1);
    expect(secondPass.writes[0].path).toBe(driftedPath);
    expect(secondPass.writes[0].mode).toBe("update");
  });
});
