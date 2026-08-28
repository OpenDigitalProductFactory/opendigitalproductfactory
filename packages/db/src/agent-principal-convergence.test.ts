// BI-53C26E60 — every non-archived agent needs its own Principal, or every
// independent review lane silently attributes to the delegating human.

import { describe, expect, it } from "vitest";

import { buildPrivateAgentGaid, convergeAgentPrincipals } from "./agent-principal-convergence.js";

type Alias = { aliasType: string; aliasValue: string; principalId: string };

function fakeDb(
  agents: Array<{ agentId: string; name: string; status: string | null }>,
  aliases: Alias[] = [],
) {
  const principals: Array<{ id: string; principalId: string; kind: string; displayName: string }> = [];
  const created = [...aliases];
  let n = 0;
  return {
    principals,
    aliases: created,
    db: {
      agent: { findMany: async () => agents },
      principalAlias: {
        findMany: async (args: { where: { aliasType: { in: string[] } } }) =>
          created.filter((a) => args.where.aliasType.in.includes(a.aliasType)),
        create: async (args: { data: Alias & { issuer: string } }) => {
          const key = `${args.data.aliasType}:${args.data.aliasValue}`;
          if (created.some((a) => `${a.aliasType}:${a.aliasValue}` === key)) {
            throw new Error(`unique violation ${key}`);
          }
          created.push(args.data);
          return args.data;
        },
      },
      principal: {
        create: async (args: { data: { principalId: string; kind: string; displayName: string } }) => {
          const row = { id: `p${++n}`, ...args.data };
          principals.push(row);
          return row;
        },
      },
    },
  };
}

const ids = () => {
  let i = 0;
  return () => `PRN-test-${++i}`;
};

describe("convergeAgentPrincipals", () => {
  // The live repro: AGT-WS-REVIEW is the designated independent Change
  // Reviewer and had no Principal, so its receipts resolved to the human.
  it("gives an agent with no identity an agent alias and a private GAID", async () => {
    const { db, aliases, principals } = fakeDb([
      { agentId: "AGT-WS-REVIEW", name: "Change Reviewer", status: "active" },
    ]);

    const result = await convergeAgentPrincipals(db, ids());

    expect(result).toEqual({ examined: 1, converged: ["AGT-WS-REVIEW"] });
    expect(principals).toHaveLength(1);
    expect(principals[0]).toMatchObject({ kind: "agent", displayName: "Change Reviewer" });
    expect(aliases.map((a) => `${a.aliasType}:${a.aliasValue}`)).toEqual([
      "agent:AGT-WS-REVIEW",
      `gaid:${buildPrivateAgentGaid("AGT-WS-REVIEW")}`,
    ]);
  });

  it("leaves an agent that already has an identity untouched", async () => {
    const { db, principals } = fakeDb(
      [{ agentId: "change-reviewer", name: "Change Reviewer", status: "active" }],
      [{ aliasType: "agent", aliasValue: "change-reviewer", principalId: "p-existing" }],
    );

    const result = await convergeAgentPrincipals(db, ids());

    expect(result).toEqual({ examined: 1, converged: [] });
    expect(principals).toHaveLength(0);
  });

  it("is idempotent — a second pass converges nothing", async () => {
    const { db } = fakeDb([{ agentId: "AGT-102", name: "Portfolio Backlog Manager", status: "active" }]);

    await convergeAgentPrincipals(db, ids());
    const second = await convergeAgentPrincipals(db, ids());

    expect(second.converged).toEqual([]);
  });

  // (aliasType, aliasValue, issuer) is unique. A stranded GAID alias must not
  // make the whole reconciliation throw and leave later agents unconverged.
  it("still issues the agent alias when the private GAID is already taken", async () => {
    const { db, aliases } = fakeDb(
      [{ agentId: "AGT-WS-REVIEW", name: "Change Reviewer", status: "active" }],
      [
        {
          aliasType: "gaid",
          aliasValue: buildPrivateAgentGaid("AGT-WS-REVIEW"),
          principalId: "p-other",
        },
      ],
    );

    const result = await convergeAgentPrincipals(db, ids());

    expect(result.converged).toEqual(["AGT-WS-REVIEW"]);
    expect(aliases.some((a) => a.aliasType === "agent" && a.aliasValue === "AGT-WS-REVIEW")).toBe(true);
  });

  it("converges every agent that is missing one, not just the first", async () => {
    const { db } = fakeDb(
      [
        { agentId: "AGT-WS-REVIEW", name: "Change Reviewer", status: "active" },
        { agentId: "AGT-WS-ADMIN", name: "Platform Admin", status: "active" },
        { agentId: "AGT-102", name: "Portfolio Backlog Manager", status: null },
      ],
      [{ aliasType: "agent", aliasValue: "AGT-102", principalId: "p-existing" }],
    );

    const result = await convergeAgentPrincipals(db, ids());

    expect(result).toEqual({ examined: 3, converged: ["AGT-WS-REVIEW", "AGT-WS-ADMIN"] });
  });

  // syncAgentPrincipal normalises a new principal's clearance to the "public"
  // floor. An empty list here would look like a faithful copy and leave the
  // agent with no clearance at all.
  it("gives a new agent principal the same public clearance floor syncAgentPrincipal does", async () => {
    const { db, principals } = fakeDb([
      { agentId: "AGT-WS-REVIEW", name: "Change Reviewer", status: "active" },
    ]);

    await convergeAgentPrincipals(db, ids());

    expect((principals[0] as { sensitivityClearance?: string[] }).sensitivityClearance).toEqual(["public"]);
  });

  it("carries the agent's own status onto its principal, defaulting to active", async () => {
    const { db, principals } = fakeDb([
      { agentId: "AGT-190", name: "Security Auditor", status: "suspended" },
      { agentId: "AGT-191", name: "Nameless", status: null },
    ]);

    await convergeAgentPrincipals(db, ids());

    expect(principals.map((p) => (p as { status?: string }).status)).toEqual(["suspended", "active"]);
  });
});
