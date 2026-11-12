import { describe, expect, it, vi } from "vitest";
import {
  NONPROD_ENVIRONMENT_KEYS, NONPROD_TERMINAL_LEASE_STATUSES, isNonprodEnvironmentKey,
  isTerminalLeaseStatus, lockAllNonprodEnvironments, lockNonprodEnvironment,
} from "./environment-lease-lock";

// A single closed registry serves lease writers, MCP validation and handoff locks.
describe("nonproduction environment serialization", () => {
  it("locks every canonical environment in sorted order using the existing advisory key", async () => {
    const execute = vi.fn(async (..._args: unknown[]) => 1);
    await lockAllNonprodEnvironments({ $executeRaw: execute });
    expect(execute.mock.calls.map((call) => call[1])).toEqual([...NONPROD_ENVIRONMENT_KEYS].sort()
      .map((key) => `dpf:nonprod-environment:${key}`));
    expect(execute.mock.calls.every((call) => (call[0] as TemplateStringsArray).join("").includes("pg_advisory_xact_lock"))).toBe(true);
  });
  it("refuses unknown environments before executing any lock", async () => {
    const execute = vi.fn(async () => 1);
    await expect(lockNonprodEnvironment({ $executeRaw: execute }, "unknown-environment")).rejects.toThrow(/unknown/i);
    expect(execute).not.toHaveBeenCalled();
    expect(isNonprodEnvironmentKey("unknown-environment")).toBe(false);
  });
  it("cannot claim all environment locks without the transaction raw port", async () => {
    await expect(lockAllNonprodEnvironments({})).rejects.toThrow(/executeRaw/);
  });
  it("keeps queued and expired-but-nonterminal rows as dependencies", () => {
    expect(NONPROD_TERMINAL_LEASE_STATUSES).toEqual(["released", "expired", "cancelled"]);
    expect(isTerminalLeaseStatus("queued")).toBe(false);
    expect(isTerminalLeaseStatus("active")).toBe(false);
    expect(isTerminalLeaseStatus("future-status")).toBe(false);
    for (const status of NONPROD_TERMINAL_LEASE_STATUSES) expect(isTerminalLeaseStatus(status)).toBe(true);
  });
});
