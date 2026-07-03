import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    agent: { findFirst: vi.fn() },
    agentToolGrant: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";

import {
  applyCoworkerToolGrant,
  isKnownGrantKey,
  manageCoworkerToolGrant,
  removeCoworkerToolGrant,
  resolveCoworkerAgent,
} from "./coworker-tool-grant-core";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SCOUT = { id: "cuid-scout", agentId: "AGT-WS-SCOUT", slugId: "external-catalog-scout", displayName: "External Catalog Scout" };

beforeEach(() => {
  vi.clearAllMocks();
  asMock(prisma.agentToolGrant.deleteMany).mockResolvedValue({ count: 0 });
});

describe("isKnownGrantKey", () => {
  it("accepts a real grant key and rejects a typo", () => {
    expect(isKnownGrantKey("backlog_write")).toBe(true);
    expect(isKnownGrantKey("not_a_real_grant")).toBe(false);
  });
});

describe("applyCoworkerToolGrant", () => {
  it("upserts on the agentId_grantKey compound key with grantedBy", async () => {
    const res = await applyCoworkerToolGrant("cuid-scout", "backlog_write", "user_1");
    expect(res).toEqual({ ok: true });
    expect(prisma.agentToolGrant.upsert).toHaveBeenCalledWith({
      where: { agentId_grantKey: { agentId: "cuid-scout", grantKey: "backlog_write" } },
      update: {},
      create: { agentId: "cuid-scout", grantKey: "backlog_write", grantedBy: "user_1" },
    });
  });

  it("rejects a key outside the closed vocabulary before any write", async () => {
    const res = await applyCoworkerToolGrant("cuid-scout", "not_a_real_grant", "user_1");
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/unknown grant key/i) });
    expect(prisma.agentToolGrant.upsert).not.toHaveBeenCalled();
  });
});

describe("removeCoworkerToolGrant", () => {
  it("deletes by agentId + grantKey and is no-throw when absent", async () => {
    const res = await removeCoworkerToolGrant("cuid-scout", "backlog_write");
    expect(res).toEqual({ ok: true });
    expect(prisma.agentToolGrant.deleteMany).toHaveBeenCalledWith({
      where: { agentId: "cuid-scout", grantKey: "backlog_write" },
    });
  });
});

describe("resolveCoworkerAgent", () => {
  it("resolves a direct agentId/slug hit without a registry round-trip", async () => {
    asMock(prisma.agent.findFirst).mockResolvedValueOnce(SCOUT);
    const res = await resolveCoworkerAgent("external-catalog-scout");
    expect(res).toEqual(SCOUT);
    expect(prisma.agent.findFirst).toHaveBeenCalledTimes(1);
  });

  it("canonicalises a registry alias miss through the registry then retries", async () => {
    // First DB probe (raw alias) misses; registry canonicalises the alias
    // "hive-scout" to AGT-WS-SCOUT; the retry hits.
    asMock(prisma.agent.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce(SCOUT);
    const res = await resolveCoworkerAgent("hive-scout");
    expect(res).toEqual(SCOUT);
    expect(prisma.agent.findFirst).toHaveBeenCalledTimes(2);
  });

  it("returns null for an empty ref without touching the DB", async () => {
    const res = await resolveCoworkerAgent("   ");
    expect(res).toBeNull();
    expect(prisma.agent.findFirst).not.toHaveBeenCalled();
  });
});

describe("manageCoworkerToolGrant", () => {
  it("grants a key to a resolved coworker", async () => {
    asMock(prisma.agent.findFirst).mockResolvedValueOnce(SCOUT);
    const res = await manageCoworkerToolGrant({
      coworkerRef: "external-catalog-scout",
      grantKey: "backlog_write",
      action: "grant",
      callerAgentId: "AGT-WS-PLATFORM",
      grantedBy: "user_1",
    });
    expect(res).toEqual({ ok: true, coworker: SCOUT, grantKey: "backlog_write", action: "grant" });
    expect(prisma.agentToolGrant.upsert).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid action before resolving", async () => {
    const res = await manageCoworkerToolGrant({
      coworkerRef: "external-catalog-scout",
      grantKey: "backlog_write",
      // @ts-expect-error deliberately invalid to exercise the guard
      action: "delete",
      grantedBy: "user_1",
    });
    expect(res).toMatchObject({ ok: false, code: "invalid_action" });
    expect(prisma.agent.findFirst).not.toHaveBeenCalled();
  });

  it("rejects an unknown grant key before resolving", async () => {
    const res = await manageCoworkerToolGrant({
      coworkerRef: "external-catalog-scout",
      grantKey: "not_a_real_grant",
      action: "grant",
      grantedBy: "user_1",
    });
    expect(res).toMatchObject({ ok: false, code: "unknown_grant_key" });
    expect(prisma.agent.findFirst).not.toHaveBeenCalled();
  });

  it("returns coworker_not_found when the ref resolves to nobody", async () => {
    asMock(prisma.agent.findFirst).mockResolvedValue(null);
    const res = await manageCoworkerToolGrant({
      coworkerRef: "ghost-coworker",
      grantKey: "backlog_write",
      action: "grant",
      grantedBy: "user_1",
    });
    expect(res).toMatchObject({ ok: false, code: "coworker_not_found" });
    expect(prisma.agentToolGrant.upsert).not.toHaveBeenCalled();
  });

  it("blocks a coworker changing its own authority (self-target guard)", async () => {
    asMock(prisma.agent.findFirst).mockResolvedValueOnce(SCOUT);
    const res = await manageCoworkerToolGrant({
      coworkerRef: "external-catalog-scout",
      grantKey: "backlog_write",
      action: "grant",
      callerAgentId: "AGT-WS-SCOUT", // same identity as the target
      grantedBy: "user_1",
    });
    expect(res).toMatchObject({ ok: false, code: "self_target_denied" });
    expect(prisma.agentToolGrant.upsert).not.toHaveBeenCalled();
  });
});
