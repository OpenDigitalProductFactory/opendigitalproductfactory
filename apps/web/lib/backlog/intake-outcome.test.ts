import { describe, expect, it, vi } from "vitest";

import { ingestBacklogItem, type IngestBacklogStore } from "@/lib/operate/backlog-ingest";

import { composeIntakeBody, customerInquiryOutcome, outcomeIntakeAdvisory, statesOutcome } from "./intake-outcome";

// BI-B1B44777: intake captures the outcome an item delivers, on every path
// through the shared ingest front door, and only prompts — never refuses —
// when none is stated.

describe("the outcome statement", () => {
  it("is recognised as an Outcome heading or an Outcome: line, not as prose", () => {
    expect(statesOutcome("## Outcome\nOperators see their queue.")).toBe(true);
    expect(statesOutcome("### Expected outcome\nX")).toBe(true);
    expect(statesOutcome("Outcome: invoices send on time")).toBe(true);
    expect(statesOutcome("- **Outcome:** invoices send on time")).toBe(true);
    expect(statesOutcome("We discussed outcomes at length.")).toBe(false);
    expect(statesOutcome(null)).toBe(false);
  });

  it("is written first, with how-we'll-know only when given, and the filer's text kept", () => {
    expect(composeIntakeBody({ body: "Context.", outcome: "Owners see overdue invoices." }))
      .toBe("## Outcome\nOwners see overdue invoices.\n\nContext.");
    expect(composeIntakeBody({ outcome: "A", howWeKnow: "The weekly count drops." }))
      .toBe("## Outcome\nA\n\n## How we'll know\nThe weekly count drops.");
    expect(composeIntakeBody({ body: "  Only notes. " })).toBe("  Only notes. ");
    expect(composeIntakeBody({ outcome: "  " })).toBeNull();
  });

  it("prompts softly when missing and stays quiet when stated", () => {
    expect(outcomeIntakeAdvisory("Just a title-ish note")).toContain("No outcome stated");
    expect(outcomeIntakeAdvisory("## Outcome\nDone means X.")).toBeNull();
  });
});

describe("customer inquiry intake (storefront)", () => {
  it("states the outcome the customer is owed", () => {
    expect(customerInquiryOutcome({ customerName: "Ana Client", inquiryRef: "INQ-4004", itemLabel: "Boiler Service" }))
      .toBe("Ana Client gets what they asked about Boiler Service, or a clear answer (INQ-4004).");
    expect(customerInquiryOutcome({ customerName: null, inquiryRef: "INQ-5" }))
      .toBe("The customer gets what they asked for, or a clear answer (INQ-5).");
  });
});

describe("the shared ingest front door captures the outcome (every path that files through it)", () => {
  function store() {
    const create = vi.fn(async (args: { data: { itemId: string } }) => ({ id: "row-1", itemId: args.data.itemId }));
    const fake: IngestBacklogStore = {
      backlogItem: { findFirst: vi.fn(async () => null), update: vi.fn(), create: create as never, findMany: vi.fn(async () => []) },
      backlogItemActivity: { create: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
      epic: { findFirst: vi.fn(async () => null) },
    };
    return { fake, create };
  }
  const deps = (fake: IngestBacklogStore) => ({
    store: fake, indexKnowledge: () => {}, listRepoFiles: async () => [],
    searchSimilarItems: async () => ({ status: "ok", results: [] }),
  });

  it("stores the outcome in the body and reports it stated", async () => {
    const { fake, create } = store();
    const result = await ingestBacklogItem({
      title: "Overdue invoices view", workType: "feature", source: "user-request",
      body: "Asked for by finance.", outcome: "Finance sees every overdue invoice in one list.",
      howWeKnow: "Finance stops exporting to a spreadsheet.",
    }, deps(fake));
    const body = (create.mock.calls[0]![0] as unknown as { data: { body: string } }).data.body;
    expect(body.startsWith("## Outcome\nFinance sees every overdue invoice in one list.")).toBe(true);
    expect(body).toContain("## How we'll know\nFinance stops exporting to a spreadsheet.");
    expect(body).toContain("Asked for by finance.");
    expect(result.outcomeStated).toBe(true);
  });

  it("files an item with no outcome and reports it unstated rather than refusing", async () => {
    const { fake, create } = store();
    const result = await ingestBacklogItem({ title: "Something", workType: "bug", source: "user-request", body: "Broken." }, deps(fake));
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.outcomeStated).toBe(false);
  });
});
