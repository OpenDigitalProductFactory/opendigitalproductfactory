// apps/web/lib/build/unified-wip.test.ts
import { describe, it, expect } from "vitest";
import {
  summarizeUnifiedWip,
  gatingPool,
  contendsOnBsSandbox,
  renderUnifiedWip,
  type ActiveWipItem,
} from "./unified-wip";

describe("summarizeUnifiedWip (BI-937128F6)", () => {
  it("counts total WIP across all surfaces, not just Build Studio", () => {
    const items: ActiveWipItem[] = [
      { executorKind: "build-studio" },
      { executorKind: "build-studio" },
      { executorKind: "claude-desktop" },
      { executorKind: "codex-desktop", holdsSharedLease: true },
      { executorKind: "grok-desktop" },
    ];
    const s = summarizeUnifiedWip(items);
    expect(s.total).toBe(5);
    expect(s.perSurface).toEqual({
      "build-studio": 2,
      "claude-desktop": 1,
      "codex-desktop": 1,
      "grok-desktop": 1,
    });
  });

  it("classifies each unit by the resource pool it contends on", () => {
    const items: ActiveWipItem[] = [
      { executorKind: "build-studio" }, // BS sandbox
      { executorKind: "build-studio" }, // BS sandbox
      { executorKind: "codex-desktop", holdsSharedLease: true }, // shared :3001 lease
      { executorKind: "claude-desktop" }, // host worktree only
      { executorKind: "grok-desktop" }, // host worktree only
    ];
    const s = summarizeUnifiedWip(items);
    expect(s.bsSandboxContending).toBe(2);
    expect(s.sharedLeaseContending).toBe(1);
    expect(s.hostWorktreeOnly).toBe(2);
  });

  it("only Build Studio contends on the shared BS sandbox", () => {
    expect(contendsOnBsSandbox("build-studio")).toBe(true);
    expect(contendsOnBsSandbox("claude-desktop")).toBe(false);
    expect(contendsOnBsSandbox("codex-desktop")).toBe(false);
  });

  it("gatingPool: external work is never gated by the BS sandbox", () => {
    expect(gatingPool("build-studio")).toBe("bs-sandbox");
    expect(gatingPool("claude-desktop")).toBe("host-worktree");
    expect(gatingPool("codex-desktop", true)).toBe("shared-lease");
    expect(gatingPool("human")).toBe("none");
    expect(gatingPool("git-webhook")).toBe("none");
  });

  it("handles an empty WIP set", () => {
    const s = summarizeUnifiedWip([]);
    expect(s.total).toBe(0);
    expect(s.bsSandboxContending).toBe(0);
    expect(s.perSurface).toEqual({});
  });

  it("renders an operator-readable one-liner", () => {
    const s = summarizeUnifiedWip([
      { executorKind: "build-studio" },
      { executorKind: "claude-desktop" },
    ]);
    expect(renderUnifiedWip(s)).toContain("WIP 2 across surfaces");
    expect(renderUnifiedWip(s)).toContain("build-studio=1");
    expect(renderUnifiedWip(s)).toContain("bs-sandbox 1");
  });
});
