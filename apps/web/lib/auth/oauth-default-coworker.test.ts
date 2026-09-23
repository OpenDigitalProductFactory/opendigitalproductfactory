import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  agent: { findMany: vi.fn() },
  authorityBinding: { findMany: vi.fn() },
  principalAlias: { findMany: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));

import { resolveDefaultOAuthCoworker, sameRedirectFamily } from "./oauth-identity-binding";

const grants = ["backlog_read", "backlog_write", "work_room_read", "work_room_write"];
function agent(agentId: string, extra: Partial<{ grants: string[]; revoked: string[]; hitl: number }> = {}) {
  return { id: `row-${agentId}`, agentId, displayName: `${agentId} display`, hitlTierDefault: extra.hitl ?? 1,
    sensitivity: "internal", toolGrants: (extra.grants ?? grants).map((grantKey) => ({ grantKey })),
    toolGrantRevocations: (extra.revoked ?? []).map((grantKey) => ({ grantKey })) };
}
const eligible = [
  { id: "row-AGT-EXT-CLAUDE", agentId: "AGT-EXT-CLAUDE", displayName: "Claude Code (external CLI)" },
  { id: "row-AGT-EXT-CODEX", agentId: "AGT-EXT-CODEX", displayName: "Codex (external CLI)" },
  { id: "row-AGT-EXT-GROK", agentId: "AGT-EXT-GROK", displayName: "Grok (external CLI)" },
];
const client = { rowId: "client-new", clientName: "Codex", redirectUris: ["http://127.0.0.1:57642/callback/ag9HJJhIbJpx"] };
const resource = "http://127.0.0.1:3000/api/mcp/v1";

beforeEach(() => {
  vi.clearAllMocks();
  db.agent.findMany.mockResolvedValue([agent("AGT-EXT-CLAUDE"), agent("AGT-EXT-CODEX"), agent("AGT-EXT-GROK")]);
  db.principalAlias.findMany.mockResolvedValue(eligible.map((a) => ({ aliasValue: a.agentId, principal: { sensitivityClearance: ["public"] } })));
  db.authorityBinding.findMany.mockResolvedValue([]);
});

describe("server-resolved default assistant (BI-05E0EA33)", () => {
  it("returns the only eligible coworker as single", async () => {
    const out = await resolveDefaultOAuthCoworker({ userId: "human", client, resource, eligible: [eligible[1]] });
    expect(out).toMatchObject({ kind: "single", selected: { agentId: "AGT-EXT-CODEX" } });
  });

  it("picks the alias match when every eligible coworker has the same authority signature", async () => {
    const out = await resolveDefaultOAuthCoworker({ userId: "human", client, resource, eligible });
    expect(out).toMatchObject({ kind: "resolved", reason: "alias", selected: { agentId: "AGT-EXT-CODEX" } });
  });

  it("prefers this human's prior consent for the same self-asserted name and redirect family", async () => {
    db.authorityBinding.findMany.mockResolvedValue([{ appliedAgentId: "row-AGT-EXT-GROK",
      oauthClient: { clientName: "codex", redirectUris: ["http://127.0.0.1:61733/callback/ag9HJJhIbJpx"] } }]);
    const out = await resolveDefaultOAuthCoworker({ userId: "human", client, resource, eligible });
    expect(out).toMatchObject({ kind: "resolved", reason: "prior_consent", selected: { agentId: "AGT-EXT-GROK" } });
  });

  it("ignores a prior consent from a different redirect family", async () => {
    db.authorityBinding.findMany.mockResolvedValue([{ appliedAgentId: "row-AGT-EXT-GROK",
      oauthClient: { clientName: "Codex", redirectUris: ["claude://claude.ai/mcp-auth-callback/sdk"] } }]);
    const out = await resolveDefaultOAuthCoworker({ userId: "human", client, resource, eligible });
    expect(out).toMatchObject({ kind: "resolved", reason: "alias", selected: { agentId: "AGT-EXT-CODEX" } });
  });

  it("falls back to the first eligible coworker deterministically when nothing matches", async () => {
    const out = await resolveDefaultOAuthCoworker({ userId: "human", client: { ...client, clientName: "Unnamed MCP client" }, resource, eligible });
    expect(out).toMatchObject({ kind: "resolved", reason: "first", selected: { agentId: "AGT-EXT-CLAUDE" } });
  });

  it("presents a choice, least authority first, when signatures differ", async () => {
    db.agent.findMany.mockResolvedValue([agent("AGT-EXT-CLAUDE"), agent("AGT-EXT-CODEX", { grants: [...grants, "admin_read"] }), agent("AGT-EXT-GROK")]);
    const out = await resolveDefaultOAuthCoworker({ userId: "human", client, resource, eligible });
    expect(out.kind).toBe("choice");
    if (out.kind !== "choice") return;
    expect(out.selected.agentId).not.toBe("AGT-EXT-CODEX");
    expect(out.candidates[0].agentId).toBe(out.selected.agentId);
    expect(out.candidates.map((c) => c.agentId)).toContain("AGT-EXT-CODEX");
    expect(out.candidates.every((c) => typeof c.detail === "string" && c.detail.length > 0)).toBe(true);
  });

  it("treats a revoked grant and a different clearance as a signature difference", async () => {
    db.agent.findMany.mockResolvedValue([agent("AGT-EXT-CLAUDE"), agent("AGT-EXT-CODEX", { revoked: ["backlog_write"] }), agent("AGT-EXT-GROK")]);
    expect((await resolveDefaultOAuthCoworker({ userId: "human", client, resource, eligible })).kind).toBe("choice");
    db.agent.findMany.mockResolvedValue([agent("AGT-EXT-CLAUDE"), agent("AGT-EXT-CODEX"), agent("AGT-EXT-GROK")]);
    db.principalAlias.findMany.mockResolvedValue(eligible.map((a) => ({ aliasValue: a.agentId,
      principal: { sensitivityClearance: a.agentId === "AGT-EXT-GROK" ? ["public", "internal"] : ["public"] } })));
    expect((await resolveDefaultOAuthCoworker({ userId: "human", client, resource, eligible })).kind).toBe("choice");
  });

  it("honours this human's prior consent before the authority-signature check (administrator's mixed set)", async () => {
    // AC-OC-7 live finding: an administrator's eligible set spans every
    // room-write coworker, so signatures differ. A recorded prior consent is
    // the human's own decision and must still land on the same assistant.
    const mailroom = { id: "row-AGT-WS-MAILROOM", agentId: "AGT-WS-MAILROOM", displayName: "Mailroom coordinator" };
    db.agent.findMany.mockResolvedValue([agent("AGT-EXT-CLAUDE"), agent("AGT-EXT-CODEX"), agent("AGT-EXT-GROK"),
      agent("AGT-WS-MAILROOM", { grants: ["work_room_read", "work_room_write", "mailroom_read"] })]);
    db.principalAlias.findMany.mockResolvedValue([...eligible, mailroom].map((a) => ({ aliasValue: a.agentId, principal: { sensitivityClearance: ["public"] } })));
    db.authorityBinding.findMany.mockResolvedValue([{ appliedAgentId: "row-AGT-EXT-CODEX",
      oauthClient: { clientName: "Codex", redirectUris: ["http://127.0.0.1:61733/callback/ag9HJJhIbJpx"] } }]);
    const out = await resolveDefaultOAuthCoworker({ userId: "human", client, resource, eligible: [...eligible, mailroom] });
    expect(out).toMatchObject({ kind: "resolved", reason: "prior_consent", selected: { agentId: "AGT-EXT-CODEX" } });
    expect(out.candidates.every((c) => typeof c.detail === "string")).toBe(true);
  });

  it("still presents a choice for a mixed set when this human has no prior consent", async () => {
    const mailroom = { id: "row-AGT-WS-MAILROOM", agentId: "AGT-WS-MAILROOM", displayName: "Mailroom coordinator" };
    db.agent.findMany.mockResolvedValue([agent("AGT-EXT-CLAUDE"), agent("AGT-EXT-CODEX"), agent("AGT-EXT-GROK"),
      agent("AGT-WS-MAILROOM", { grants: ["work_room_read", "work_room_write", "mailroom_read"] })]);
    db.principalAlias.findMany.mockResolvedValue([...eligible, mailroom].map((a) => ({ aliasValue: a.agentId, principal: { sensitivityClearance: ["public"] } })));
    const out = await resolveDefaultOAuthCoworker({ userId: "human", client, resource, eligible: [...eligible, mailroom] });
    expect(out).toMatchObject({ kind: "choice", selected: { agentId: "AGT-WS-MAILROOM" } });
  });

  it("never lets a name match reach outside the eligible set", async () => {
    const out = await resolveDefaultOAuthCoworker({ userId: "human", client: { ...client, clientName: "Codex" }, resource, eligible: [eligible[0], eligible[2]] });
    expect(out.kind).toBe("resolved");
    expect(out.selected.agentId).not.toBe("AGT-EXT-CODEX");
  });
});

describe("redirect family", () => {
  it("ignores the loopback port and compares scheme, host and path", () => {
    expect(sameRedirectFamily(["http://127.0.0.1:1/callback/x"], ["http://127.0.0.1:2/callback/x"])).toBe(true);
    expect(sameRedirectFamily(["http://127.0.0.1:1/callback/x"], ["http://127.0.0.1:1/callback/y"])).toBe(false);
    expect(sameRedirectFamily(["claude://claude.ai/mcp-auth-callback/sdk"], ["claude://claude.ai/mcp-auth-callback/sdk"])).toBe(true);
    expect(sameRedirectFamily(["https://a.example:8443/cb"], ["https://a.example:9443/cb"])).toBe(false);
  });
});
