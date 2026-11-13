import { describe, expect, it, vi } from "vitest";

import {
  ratifyStatutoryRule,
  recordAndRatifyStatutoryRule,
  rejectStatutoryRule,
  statutoryActorKind,
  type StatutoryRatificationDb,
  type StatutoryRuleRow,
} from "./statutory-ratification";
import { resolveStatutoryRule } from "./statutory-rules";
import { AUTOMATION_PERSONA_EMAIL } from "@/lib/govern/automation-persona-identity";

const person = { userId: "user-1", email: "owner@example.com" };
const automation = { userId: "user-auto", email: AUTOMATION_PERSONA_EMAIL };
const now = new Date("2026-11-12T12:00:00.000Z");

function row(over: Partial<StatutoryRuleRow> = {}): StatutoryRuleRow {
  return {
    id: "r1",
    payrollTaxRuleId: "PTR-1",
    jurisdictionRefId: "TAX-JUR-US-FEDERAL",
    taxType: "social_security",
    ruleKind: "rate",
    side: "employee_withheld",
    taxYear: 2026,
    value: 0.062,
    status: "proposed",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    sourceUrl: "https://www.irs.gov/publications/p15",
    ...over,
  };
}

/** An in-memory table, so ratification is exercised end to end. */
function memoryDb(initial: StatutoryRuleRow[]) {
  const rows = initial.map((r) => ({ ...r }));
  const update = vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<StatutoryRuleRow> }) => {
    const target = rows.find((r) => r.id === where.id)!;
    Object.assign(target, data);
    return target;
  });
  const create = vi.fn(async ({ data }: { data: StatutoryRuleRow }) => {
    const created = { ...data, id: `r${rows.length + 1}` };
    rows.push(created);
    return created;
  });
  const db: StatutoryRatificationDb = {
    payrollTaxRule: {
      findUnique: vi.fn(async ({ where }: { where: { payrollTaxRuleId: string } }) =>
        rows.find((r) => r.payrollTaxRuleId === where.payrollTaxRuleId) ?? null) as never,
      findMany: vi.fn(async ({ where }: { where: Partial<StatutoryRuleRow> }) =>
        rows.filter((r) =>
          r.jurisdictionRefId === where.jurisdictionRefId
          && r.taxType === where.taxType
          && r.ruleKind === where.ruleKind
          && r.side === where.side
          && r.status === where.status)) as never,
      create: create as never,
      update: update as never,
    },
    $transaction: async (fn) => fn(db),
  };
  return { db, rows, update, create };
}

describe("statutoryActorKind", () => {
  it("treats the automation persona as an agent, however it signed in", () => {
    // The persona signs a browser in with an ordinary session. Without this
    // check an agent driving the portal could ratify its own proposal.
    expect(statutoryActorKind(automation)).toBe("agent");
    expect(statutoryActorKind({ ...automation, email: ` ${AUTOMATION_PERSONA_EMAIL.toUpperCase()} ` })).toBe("agent");
    expect(statutoryActorKind(person)).toBe("human");
  });
});

describe("ratifyStatutoryRule", () => {
  it("lets a person confirm a cited proposal, after which payroll can resolve it", async () => {
    const { db, rows } = memoryDb([row()]);

    const result = await ratifyStatutoryRule(db, { payrollTaxRuleId: "PTR-1", actor: person, now });

    expect(result).toEqual({ ok: true, payrollTaxRuleId: "PTR-1", closedWindows: [] });
    expect(rows[0]).toMatchObject({ status: "ratified", ratifiedByUserId: "user-1", ratifiedAt: now });
    // The point of the whole feature: a figure that was unreachable is now live.
    const live = resolveStatutoryRule(
      rows.map((r) => ({ ...r, value: Number(r.value) })),
      new Date("2026-06-01T00:00:00.000Z"),
      { taxType: "social_security", ruleKind: "rate", side: "employee_withheld" },
    );
    expect(live?.value).toBe(0.062);
  });

  it("refuses the automation persona even through the human UI path", async () => {
    const { db, rows, update } = memoryDb([row()]);

    const result = await ratifyStatutoryRule(db, { payrollTaxRuleId: "PTR-1", actor: automation, now });

    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(rows[0]!.status).toBe("proposed");
  });

  it("refuses to ratify an uncited figure", async () => {
    const { db, update } = memoryDb([row({ sourceUrl: null })]);

    const result = await ratifyStatutoryRule(db, { payrollTaxRuleId: "PTR-1", actor: person, now });

    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  // The trap this module exists partly to avoid. resolveStatutoryRule returns
  // ratified rules only, so flipping the earlier figure to `superseded` would stop
  // it governing its own past dates and re-price every closed period that used it.
  it("keeps a superseded figure governing its own past dates", async () => {
    const earlier = row({
      id: "r-old", payrollTaxRuleId: "PTR-OLD", status: "ratified", value: 0.06,
      effectiveFrom: new Date("2025-01-01T00:00:00.000Z"), effectiveTo: null,
    });
    const incoming = row({ effectiveFrom: new Date("2026-01-01T00:00:00.000Z") });
    const { db, rows } = memoryDb([earlier, incoming]);

    const result = await ratifyStatutoryRule(db, { payrollTaxRuleId: "PTR-1", actor: person, now });

    expect(result).toMatchObject({ ok: true, closedWindows: ["r-old"] });
    const old = rows.find((r) => r.id === "r-old")!;
    expect(old.status).toBe("ratified");
    expect(old.effectiveTo).toEqual(new Date("2026-01-01T00:00:00.000Z"));

    const resolvable = rows.map((r) => ({ ...r, value: Number(r.value) }));
    const sel = { taxType: "social_security", ruleKind: "rate" as const, side: "employee_withheld" };
    expect(resolveStatutoryRule(resolvable, new Date("2025-06-01T00:00:00.000Z"), sel)?.value).toBe(0.06);
    expect(resolveStatutoryRule(resolvable, new Date("2026-06-01T00:00:00.000Z"), sel)?.value).toBe(0.062);
  });

  it("never widens a window that already ended before the new figure starts", async () => {
    const closedEarly = row({
      id: "r-old", payrollTaxRuleId: "PTR-OLD", status: "ratified",
      effectiveFrom: new Date("2024-01-01T00:00:00.000Z"),
      effectiveTo: new Date("2025-01-01T00:00:00.000Z"),
    });
    const { db, rows } = memoryDb([closedEarly, row()]);

    await ratifyStatutoryRule(db, { payrollTaxRuleId: "PTR-1", actor: person, now });

    expect(rows.find((r) => r.id === "r-old")!.effectiveTo).toEqual(new Date("2025-01-01T00:00:00.000Z"));
  });
});

describe("rejectStatutoryRule", () => {
  it("requires a reason", async () => {
    const { db, update } = memoryDb([row()]);

    const result = await rejectStatutoryRule(db, { payrollTaxRuleId: "PTR-1", actor: person, reason: "   ", now });

    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("records the reason, and refuses the automation persona", async () => {
    const { db, rows } = memoryDb([row()]);

    expect((await rejectStatutoryRule(db, {
      payrollTaxRuleId: "PTR-1", actor: automation, reason: "wrong year", now,
    })).ok).toBe(false);

    const result = await rejectStatutoryRule(db, {
      payrollTaxRuleId: "PTR-1", actor: person, reason: "That page is the 2025 table.", now,
    });
    expect(result.ok).toBe(true);
    expect(rows[0]).toMatchObject({ status: "rejected", rejectedReason: "That page is the 2025 table." });
  });
});

describe("recordAndRatifyStatutoryRule", () => {
  const proposal = {
    jurisdictionRefId: "TAX-JUR-US-FEDERAL",
    taxType: "social_security",
    ruleKind: "wage_base" as const,
    side: null,
    taxYear: 2026,
    value: 176_100,
    currency: "USD",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    sourceUrl: "https://www.ssa.gov/oact/cola/cbb.html",
    sourceExcerpt: "the maximum amount of taxable earnings ... ",
    retrievedAt: now,
  };

  it("records and confirms a figure the operator read, at the same citation bar a coworker faces", async () => {
    const { db, rows } = memoryDb([]);

    const result = await recordAndRatifyStatutoryRule(db, {
      proposal, actor: person, payrollTaxRuleId: "PTR-NEW", now,
    });

    expect(result.ok).toBe(true);
    expect(rows[0]).toMatchObject({
      status: "ratified", proposedByAgentId: null, ratifiedByUserId: "user-1",
      sourceUrl: proposal.sourceUrl,
    });
  });

  it("refuses an entry with no citation — the operator path is shorter, not lower", async () => {
    const { db, create } = memoryDb([]);

    const result = await recordAndRatifyStatutoryRule(db, {
      proposal: { ...proposal, sourceUrl: "" }, actor: person, payrollTaxRuleId: "PTR-NEW", now,
    });

    expect(result.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("requires the quoted passage, because the author and reviewer are the same person", async () => {
    const { db, create } = memoryDb([]);

    const result = await recordAndRatifyStatutoryRule(db, {
      proposal: { ...proposal, sourceExcerpt: "  " }, actor: person, payrollTaxRuleId: "PTR-NEW", now,
    });

    expect(result.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses the automation persona outright", async () => {
    const { db, create } = memoryDb([]);

    const result = await recordAndRatifyStatutoryRule(db, {
      proposal, actor: automation, payrollTaxRuleId: "PTR-NEW", now,
    });

    expect(result.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
