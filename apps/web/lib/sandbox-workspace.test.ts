// apps/web/lib/sandbox-workspace.test.ts
// Pure-function tests only — do NOT test Docker commands (those are integration tests)

import { describe, it, expect } from "vitest";
import { buildInstallCommands } from "./sandbox-workspace";

describe("buildInstallCommands", () => {
  it("returns an array", () => {
    expect(Array.isArray(buildInstallCommands())).toBe(true);
  });

  it("returns exactly 3 commands", () => {
    expect(buildInstallCommands()).toHaveLength(3);
  });

  it("includes pnpm install", () => {
    expect(buildInstallCommands()).toContain("pnpm install");
  });

  it("includes pnpm prisma generate", () => {
    expect(buildInstallCommands()).toContain("pnpm prisma generate");
  });

  it("includes nohup pnpm dev command for background start", () => {
    expect(buildInstallCommands()).toContain(
      "nohup pnpm dev > /tmp/dev.log 2>&1 &",
    );
  });

  it("pnpm install is first", () => {
    expect(buildInstallCommands()[0]).toBe("pnpm install");
  });

  it("pnpm prisma generate is second", () => {
    expect(buildInstallCommands()[1]).toBe("pnpm prisma generate");
  });

  it("nohup pnpm dev is third", () => {
    expect(buildInstallCommands()[2]).toBe("nohup pnpm dev > /tmp/dev.log 2>&1 &");
  });

  it("returns a fresh copy each call (not the same array reference)", () => {
    const a = buildInstallCommands();
    const b = buildInstallCommands();
    expect(a).not.toBe(b);
  });
});
