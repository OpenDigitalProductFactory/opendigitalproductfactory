import { z } from "zod";

// --- Engagement ---

export const ENGAGEMENT_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "unqualified",
  "converted",
] as const;

export const ENGAGEMENT_SOURCES = [
  "web_inquiry",
  "manual",
  "referral",
  "import",
] as const;

export const createEngagementSchema = z.object({
  title: z.string().min(1).max(500),
  contactId: z.string().min(1),
  accountId: z.string().optional(),
  source: z.enum(ENGAGEMENT_SOURCES).optional(),
  sourceRefId: z.string().optional(),
  assignedToId: z.string().optional(),
  notes: z.string().max(5000).optional(),
});

export type CreateEngagementInput = z.infer<typeof createEngagementSchema>;

export const updateEngagementSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  status: z.enum(ENGAGEMENT_STATUSES).optional(),
  assignedToId: z.string().optional().nullable(),
  notes: z.string().max(5000).optional(),
});

export type UpdateEngagementInput = z.infer<typeof updateEngagementSchema>;

// --- Opportunity ---

export const OPPORTUNITY_STAGES = [
  "qualification",
  "discovery",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
] as const;

export const STAGE_DEFAULT_PROBABILITY: Record<string, number> = {
  qualification: 10,
  discovery: 20,
  proposal: 40,
  negotiation: 60,
  closed_won: 100,
  closed_lost: 0,
};

export const createOpportunitySchema = z.object({
  title: z.string().min(1).max(500),
  accountId: z.string().min(1),
  contactId: z.string().optional(),
  stage: z.enum(OPPORTUNITY_STAGES).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedValue: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  expectedClose: z.string().datetime().optional(),
  assignedToId: z.string().optional(),
  engagementId: z.string().optional(),
  notes: z.string().max(5000).optional(),
});

export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;

export const updateOpportunitySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  stage: z.enum(OPPORTUNITY_STAGES).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedValue: z.number().min(0).optional().nullable(),
  currency: z.string().length(3).optional(),
  expectedClose: z.string().datetime().optional().nullable(),
  assignedToId: z.string().optional().nullable(),
  lostReason: z.string().max(1000).optional(),
  notes: z.string().max(5000).optional(),
});

export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;

// --- Activity ---

export const ACTIVITY_TYPES = [
  "note",
  "call",
  "email",
  "meeting",
  "task",
  "status_change",
  "quote_event",
  "system",
] as const;

export const createActivitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  subject: z.string().min(1).max(500),
  body: z.string().max(10000).optional(),
  scheduledAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  accountId: z.string().optional(),
  contactId: z.string().optional(),
  opportunityId: z.string().optional(),
});

export type CreateActivityInput = z.infer<typeof createActivitySchema>;

// --- Quote ---

export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "superseded",
] as const;

const quoteLineItemSchema = z.object({
  productId: z.string().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().int().min(1),
  unitPrice: z.number().min(0),
  discountPercent: z.number().min(0).max(100).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const createQuoteSchema = z.object({
  opportunityId: z.string().min(1),
  validUntil: z.string().datetime(),
  lineItems: z.array(quoteLineItemSchema).min(1),
  discountType: z.enum(["percentage", "fixed"]).optional(),
  discountValue: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  terms: z.string().max(10000).optional(),
  notes: z.string().max(5000).optional(),
});

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

// --- Sales Order ---

export const SALES_ORDER_STATUSES = [
  "confirmed",
  "in_progress",
  "fulfilled",
  "cancelled",
] as const;

export const updateSalesOrderSchema = z.object({
  status: z.enum(SALES_ORDER_STATUSES).optional(),
  notes: z.string().max(5000).optional(),
});

export type UpdateSalesOrderInput = z.infer<typeof updateSalesOrderSchema>;
