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
    researchProposal: {
      findFirst: vi.fn(async (args: any) => {
        const w = args.where ?? {};
        return (
          rows.find(
            (r) =>
              (w.proposalId === undefined || r.proposalId === w.proposalId) &&
              (w.organizationId === undefined || r.organizationId === w.organizationId) &&
              (w.digitalProductId === undefined || r.digitalProductId === w.digitalProductId) &&
              (w.topic === undefined || r.topic === w.topic) &&
              (w.status === undefined || r.status === w.status),
          ) ?? null
        );
      }),
      create: vi.fn(async (args: any) => {
        const row = {
          proposalId: `rp_${++seq}`,
          digitalProductId: null,
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
});

describe("approveResearch", () => {
  it("transitions pending → approved and fires the onApproved seam once", async () => {
    const fake = makeFakeDb([
      {
        proposalId: "rp_1",
        organizationId: ORG,
        digitalProductId: "digital-product-1",
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
});
