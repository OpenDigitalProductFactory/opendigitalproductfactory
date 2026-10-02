// BI-CEE688D6 — the scoped-test evidence states only what ran. Live 2026-10-01,
// record cmupjx12k1bvw01mqm0re8ttw (FB-8AB05E04) claimed unit tests and a
// vitest run while its output was a host-resource-runner crash and a heap OOM.
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/sandbox", () => ({ execInSandbox: vi.fn() }));

const { scopedTestsRunDescription } = await import("./run-and-record-gauntlet");

describe("scopedTestsRunDescription", () => {
  it("claims no unit tests when no test file covers the change", () => {
    const out = scopedTestsRunDescription(["apps/mobile/src/capture.ts"], { scope: "none", scopedTestsRun: 0 });
    expect(out.coverage.unitTests).toBe(false);
    expect(out.commands.join("\n")).toMatch(/no tests ran/);
    expect(out.commands.join("\n")).not.toMatch(/vitest run/);
  });

  it("does not claim a typecheck for a change outside apps/web", () => {
    const out = scopedTestsRunDescription(["apps/mobile/src/capture.ts"], { scope: "none", scopedTestsRun: 0 });
    expect(out.coverage.typecheck).toBe(false);
    expect(out.commands[0]).toMatch(/does not cover this change/);
  });

  it("claims unit tests and a typecheck only when scoped tests ran on an apps/web change", () => {
    const out = scopedTestsRunDescription(
      ["apps/web/lib/x.ts", "apps/web/lib/x.test.ts"],
      { scope: "scoped", scopedTestsRun: 1 },
    );
    expect(out.coverage).toMatchObject({ unitTests: true, typecheck: true });
    expect(out.commands[1]).toMatch(/vitest run \(1 test file/);
  });
});
