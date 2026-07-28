// Inbound acquisition signals — the demand side of the marketing picture.
//
// Storefront inbox counts (bookings / inquiries / orders / donations) and the
// CRM pipeline rollup answer "is demand arriving, and where does it stall".
// They were assembled with raw prisma aggregates inside the get_marketing_summary
// tool handler, the only marketing handler that still did its own DB rollup
// rather than delegating to a marketing module. Extracted here so the tool pack
// stays a thin adapter and the counts have one definition.

import { prisma } from "@dpf/db";

export type MarketingAcquisitionSignals = {
  inbox: {
    days: number;
    bookings: number;
    inquiries: number;
    orders: number;
    donations: number;
    total: number;
  };
  pipeline: {
    engagements: Record<string, number>;
    opportunities: Record<string, number>;
  };
};

/**
 * Count inbound demand for one storefront over a lookback window, plus the
 * current CRM pipeline distribution.
 */
export async function loadAcquisitionSignals(input: {
  storefrontId: string;
  days: number;
}): Promise<MarketingAcquisitionSignals> {
  const since = new Date();
  since.setDate(since.getDate() - input.days);
  const window = { storefrontId: input.storefrontId, createdAt: { gte: since } };

  const [bookings, inquiries, orders, donations, engagements, opportunities] = await Promise.all([
    prisma.storefrontBooking.count({ where: window }),
    prisma.storefrontInquiry.count({ where: window }),
    prisma.storefrontOrder.count({ where: window }),
    prisma.storefrontDonation.count({ where: window }),
    prisma.engagement.groupBy({ by: ["status"], _count: true }),
    prisma.opportunity.groupBy({ by: ["stage"], _count: true }),
  ]);

  return {
    inbox: {
      days: input.days,
      bookings,
      inquiries,
      orders,
      donations,
      total: bookings + inquiries + orders + donations,
    },
    pipeline: {
      engagements: Object.fromEntries(
        (engagements as Array<{ status: string; _count: number }>).map((e) => [e.status, e._count]),
      ),
      opportunities: Object.fromEntries(
        (opportunities as Array<{ stage: string; _count: number }>).map((o) => [o.stage, o._count]),
      ),
    },
  };
}
