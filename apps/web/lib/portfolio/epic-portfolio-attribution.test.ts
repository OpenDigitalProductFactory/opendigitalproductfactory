import { describe, expect, it } from "vitest";

import { confirmEpicPortfolios } from "./epic-portfolio-attribution";

// A fake that answers the loader's two raw queries and records every write.
function fakeDb(options: { itemPortfolioIds: Array<string | null> }) {
  const writes: Array<{ op: string; args: unknown }> = [];
  const db = {
    writes,
    $queryRaw: async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes("UNION ALL")) return [{ portfolioId: "p-sold", text: "veterinary clinic" }];
      return [{ id: "e1", epicId: "EP-1", title: "Vet clinic", description: null, status: "open", itemPortfolioIds: options.itemPortfolioIds, current: null }];
    },
    epic: { findMany: async () => [{ id: "e1", epicId: "EP-1", items: [{ id: "i1" }, { id: "i2" }] }] },
    agent: { findUnique: async (args: any) => (args.where.agentId === "external-claude-code" ? { agentId: "external-claude-code" } : null) },
    portfolio: { findMany: async (args: any) => args.where.id.in.filter((id: string) => id.startsWith("p-")).map((id: string) => ({ id })) },
    epicPortfolio: {
      deleteMany: async (args: unknown) => { writes.push({ op: "deleteMany", args }); },
      create: async (args: unknown) => { writes.push({ op: "create", args }); },
    },
    backlogItem: {
      findUnique: async () => ({ id: "i1", portfolioId: null, epic: { portfolios: [{ portfolioId: "p-sold" }] } }),
      findMany: async () => [],
      update: async (args: unknown) => { writes.push({ op: "itemUpdate", args }); },
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(db),
  };
  return db;
}

const actor = { userId: "user-1", agentId: "external-claude-code" };

describe("confirmEpicPortfolios (BI-A73A7DA3)", () => {
  it("records the actor, reason, time and proposal confidence on the EpicPortfolio row", async () => {
    const db = fakeDb({ itemPortfolioIds: ["p-sold", "p-sold", "p-sold"] });
    const result = await confirmEpicPortfolios(db as any, { confirmations: [{ epicId: "EP-1", portfolioId: "p-sold" }], reason: "items agree", actor });
    expect(result).toMatchObject({ ok: true, data: { confirmed: [{ epicId: "EP-1", proposalConfidence: "high", itemsReattributed: 2 }] } });
    const create = db.writes.find((w) => w.op === "create")!.args as { data: Record<string, unknown> };
    expect(create.data).toMatchObject({ epicId: "e1", portfolioId: "p-sold", confirmedById: "user-1", confirmedByAgentId: "external-claude-code", confirmationReason: "items agree", proposalConfidence: "high" });
    expect(create.data.confirmedAt).toBeInstanceOf(Date);
  });

  it("refuses without a reason or without a confirming person, and writes nothing", async () => {
    const db = fakeDb({ itemPortfolioIds: [] });
    expect(await confirmEpicPortfolios(db as any, { confirmations: [{ epicId: "EP-1", portfolioId: "p-sold" }], reason: "  ", actor }))
      .toMatchObject({ ok: false, error: "reason_required" });
    expect(await confirmEpicPortfolios(db as any, { confirmations: [{ epicId: "EP-1", portfolioId: "p-sold" }], reason: "r", actor: { userId: null } }))
      .toMatchObject({ ok: false, error: "actor_required" });
    expect(db.writes).toEqual([]);
  });

  it("refuses a batch that includes a proposal the server does not rate high", async () => {
    const db = fakeDb({ itemPortfolioIds: ["p-sold"] });
    const result = await confirmEpicPortfolios(db as any, { confirmations: [{ epicId: "EP-1", portfolioId: "p-sold" }], reason: "r", actor, batch: "high" });
    expect(result).toMatchObject({ ok: false, error: "not_high_confidence" });
    expect(db.writes).toEqual([]);
  });

  it("lets a person confirm a portfolio other than the proposal, recording no proposal confidence", async () => {
    const db = fakeDb({ itemPortfolioIds: ["p-sold", "p-sold", "p-sold"] });
    const result = await confirmEpicPortfolios(db as any, { confirmations: [{ epicId: "EP-1", portfolioId: "p-found" }], reason: "platform work", actor });
    expect(result).toMatchObject({ ok: true, data: { confirmed: [{ portfolioId: "p-found", proposalConfidence: null }] } });
  });

  it("refuses an unknown portfolio", async () => {
    const db = fakeDb({ itemPortfolioIds: [] });
    expect(await confirmEpicPortfolios(db as any, { confirmations: [{ epicId: "EP-1", portfolioId: "nope" }], reason: "r", actor }))
      .toMatchObject({ ok: false, error: "unknown_portfolio" });
  });

  it("records no carrying agent when the caller's agent id is not a registered agent", async () => {
    const db = fakeDb({ itemPortfolioIds: [] });
    await confirmEpicPortfolios(db as any, { confirmations: [{ epicId: "EP-1", portfolioId: "p-sold" }], reason: "r", actor: { userId: "user-1", agentId: "unknown" } });
    const create = db.writes.find((w) => w.op === "create")!.args as { data: Record<string, unknown> };
    expect(create.data).toMatchObject({ confirmedById: "user-1", confirmedByAgentId: null });
  });
});
