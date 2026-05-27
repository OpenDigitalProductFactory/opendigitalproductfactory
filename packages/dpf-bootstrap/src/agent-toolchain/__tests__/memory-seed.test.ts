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
          existsSync: (p: string) => p.endsWith("kernel_never-ask-user-to-run-commands.md"),
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
          existsSync: () => true,
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
});
