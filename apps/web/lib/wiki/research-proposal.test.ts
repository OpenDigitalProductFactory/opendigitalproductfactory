import { describe, expect, it, vi } from "vitest";

import {
  proposeResearch,
  approveResearch,
  declineResearch,
  type ResearchProposalClient,
  type OnApproved,
} from "./research-proposal";

type Row = Record<string, any>;
function makeFakeDb(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  let seq = 0;
  const db = {
    organization: { findFirst: vi.fn(async () => ({ id: ORG })) },
    productLine: { findFirst: vi.fn(async (args: any) => ({ id: args.where.id })) },
    product: { findFirst: vi.fn(async (args: any) => ({ id: args.where.id })) },
    digitalProduct: { findFirst: vi.fn(async (args: any) => ({ id: args.where.id })) },
    researchProposal: {
      findFirst: vi.fn(async (args: any) => {
        const w = args.where ?? {};
        return (
          rows.find(
            (r) =>
              (w.proposalId === undefined || r.proposalId === w.proposalId) &&
              (w.organizationId === undefined || r.organizationId === w.organizationId) &&
              (w.digitalProductId === undefined || r.digitalProductId === w.digitalProductId) &&
              (w.productLineId === undefined || r.productLineId === w.productLineId) &&
              (w.businessProductId === undefined || r.businessProductId === w.businessProductId) &&
              (w.topic === undefined || r.topic === w.topic) &&
              (w.status === undefined || r.status === w.status),
          ) ?? null
        );
      }),
      create: vi.fn(async (args: any) => {
        const row = {
          proposalId: `rp_${++seq}`,
          digitalProductId: null,
          productLineId: null,
          businessProductId: null,
          status: "pending",
          ...args.data,
        };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async (args: any) => {
        const r = rows.find((x) => x.proposalId === args.where.proposalId);
        if (r) Object.assign(r, args.data);
        return r;
      }),
    },
  } as unknown as ResearchProposalClient;
  return { db, rows };
}

const ORG = "org_1";

describe("proposeResearch", () => {
  it("creates a pending proposal", async () => {
    const fake = makeFakeDb();
    const res = await proposeResearch(
      { organizationId: ORG, topic: "competitive-landscape", query: "HVAC competitors" },
      { db: fake.db },
    );
    expect(res.created).toBe(true);
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0]).toMatchObject({ organizationId: ORG, topic: "competitive-landscape", status: "pending" });
  });

  it("dedups to the existing pending proposal for the same org+topic", async () => {
    const fake = makeFakeDb([
      {
        proposalId: "rp_existing",
        organizationId: ORG,
        digitalProductId: null,
        productLineId: null,
        businessProductId: null,
        topic: "competitive-landscape",
        status: "pending",
      },
    ]);
    const res = await proposeResearch(
      { organizationId: ORG, topic: "competitive-landscape", query: "again" },
      { db: fake.db },
    );
    expect(res.created).toBe(false);
    expect(res.proposalId).toBe("rp_existing");
    expect(fake.rows).toHaveLength(1);
  });

  it("keeps organization-wide and product-specific proposals distinct", async () => {
    const fake = makeFakeDb([
      {
        proposalId: "rp_org",
        organizationId: ORG,
        digitalProductId: null,
        topic: "competitive-landscape",
        status: "pending",
      },
    ]);
    const res = await proposeResearch(
      {
        organizationId: ORG,
        digitalProductId: "digital-product-1",
        topic: "competitive-landscape",
        query: "booking competitors",
      },
      { db: fake.db },
    );

    expect(res.created).toBe(true);
    expect(fake.rows[1]).toMatchObject({
      digitalProductId: "digital-product-1",
    });
  });

  it("deduplicates within the exact business-product scope", async () => {
    const fake = makeFakeDb([
      {
        proposalId: "rp_product",
        organizationId: ORG,
        productLineId: null,
        businessProductId: "product-1",
        digitalProductId: null,
        topic: "competitive-landscape",
        status: "pending",
      },
    ]);

    const res = await proposeResearch(
      {
        organizationId: ORG,
        businessProductId: "product-1",
        topic: "competitive-landscape",
        query: "salon-service competitors",
      },
      { db: fake.db },
    );

    expect(res).toEqual({ proposalId: "rp_product", created: false });
  });

  it("rejects conflicting business and digital targets before writing", async () => {
    const fake = makeFakeDb();
    await expect(
      proposeResearch(
        {
          organizationId: ORG,
          businessProductId: "product-1",
          digitalProductId: "digital-product-1",
          topic: "competitive-landscape",
          query: "ambiguous",
        },
        { db: fake.db },
      ),
    ).rejects.toMatchObject({ code: "conflicting-scope" });
    expect(fake.db.researchProposal.create).not.toHaveBeenCalled();
  });

  it("rejects an empty research question before writing", async () => {
    const fake = makeFakeDb();

    await expect(
      proposeResearch(
        {
          organizationId: ORG,
          topic: "competitive-landscape",
          query: " ",
        },
        { db: fake.db },
      ),
    ).rejects.toThrow("Research proposal query is required.");
    expect(fake.db.researchProposal.create).not.toHaveBeenCalled();
  });
});

describe("approveResearch", () => {
  it("transitions pending → approved and fires the onApproved seam once", async () => {
    const fake = makeFakeDb([
      {
        proposalId: "rp_1",
        organizationId: ORG,
        digitalProductId: "digital-product-1",
        productLineId: null,
        businessProductId: null,
        topic: "t",
        query: "q",
        status: "pending",
      },
    ]);
    const onApproved: OnApproved = vi.fn(async () => {});
    const res = await approveResearch({ proposalId: "rp_1", decidedByUserId: "u1" }, { db: fake.db, onApproved });

    expect(res.approved).toBe(true);
    expect(fake.rows[0]).toMatchObject({ status: "approved", decidedByUserId: "u1" });
    expect(fake.rows[0].decidedAt).toBeTruthy();
    expect(onApproved).toHaveBeenCalledTimes(1);
    expect((onApproved as any).mock.calls[0][0]).toMatchObject({
      proposalId: "rp_1",
      digitalProductId: "digital-product-1",
      productLineId: null,
      businessProductId: null,
      query: "q",
    });
  });

  it("is idempotent — approving a non-pending proposal does not re-fire execution", async () => {
    const fake = makeFakeDb([
      {
        proposalId: "rp_1",
        organizationId: ORG,
        digitalProductId: null,
        topic: "t",
        query: "q",
        status: "approved",
      },
    ]);
    const onApproved: OnApproved = vi.fn(async () => {});
    const res = await approveResearch({ proposalId: "rp_1", decidedByUserId: "u1" }, { db: fake.db, onApproved });

    expect(res.approved).toBe(false);
    expect(onApproved).not.toHaveBeenCalled();
  });

  it("returns approved=false for an unknown proposal", async () => {
    const fake = makeFakeDb();
    const res = await approveResearch({ proposalId: "missing", decidedByUserId: "u1" }, { db: fake.db });
    expect(res.approved).toBe(false);
  });

  it("does not approve a proposal outside the authenticated organization", async () => {
    const fake = makeFakeDb([
      {
        proposalId: "rp_other",
        organizationId: "org_other",
        digitalProductId: null,
        productLineId: null,
        businessProductId: null,
        topic: "t",
        query: "q",
        status: "pending",
      },
    ]);
    const onApproved: OnApproved = vi.fn(async () => {});

    const res = await approveResearch(
      {
        proposalId: "rp_other",
        organizationId: ORG,
        decidedByUserId: "u1",
      },
      { db: fake.db, onApproved },
    );

    expect(res.approved).toBe(false);
    expect(onApproved).not.toHaveBeenCalled();
    expect(fake.rows[0].status).toBe("pending");
  });
});

describe("declineResearch", () => {
  it("transitions pending → declined and never fires execution", async () => {
    const fake = makeFakeDb([
      {
        proposalId: "rp_1",
        organizationId: ORG,
        digitalProductId: null,
        topic: "t",
        query: "q",
        status: "pending",
      },
    ]);
    const res = await declineResearch({ proposalId: "rp_1", decidedByUserId: "u1" }, { db: fake.db });
    expect(res.declined).toBe(true);
    expect(fake.rows[0]).toMatchObject({ status: "declined", decidedByUserId: "u1" });
  });

  it("guards against declining a non-pending proposal", async () => {
    const fake = makeFakeDb([
      {
        proposalId: "rp_1",
        organizationId: ORG,
        digitalProductId: null,
        topic: "t",
        query: "q",
        status: "executed",
      },
    ]);
    const res = await declineResearch({ proposalId: "rp_1", decidedByUserId: "u1" }, { db: fake.db });
    expect(res.declined).toBe(false);
  });

  it("does not decline a proposal outside the authenticated organization", async () => {
    const fake = makeFakeDb([
      {
        proposalId: "rp_other",
        organizationId: "org_other",
        digitalProductId: null,
        topic: "t",
        query: "q",
        status: "pending",
      },
    ]);

    const res = await declineResearch({
      proposalId: "rp_other",
      organizationId: ORG,
      decidedByUserId: "u1",
    }, { db: fake.db });

    expect(res.declined).toBe(false);
    expect(fake.rows[0].status).toBe("pending");
  });
});
