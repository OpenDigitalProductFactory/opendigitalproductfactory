import { z } from "zod";

export const updateCustomerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  industry: z.string().max(100).optional(),
  notes: z.string().max(5000).optional(),
  website: z.string().url().max(500).optional().or(z.literal("")),
  employeeCount: z.number().int().min(0).optional(),
  annualRevenue: z.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  status: z
    .enum([
      "prospect",
      "qualified",
      "onboarding",
      "active",
      "at_risk",
      "suspended",
      "closed",
    ])
    .optional(),
  parentAccountId: z.string().optional().nullable(),
  sourceSystem: z.string().max(100).optional(),
  sourceId: z.string().max(200).optional(),
});

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const createContactSchema = z.object({
  email: z.string().email().max(320),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
  jobTitle: z.string().max(200).optional(),
  linkedinUrl: z.string().url().max(500).optional().or(z.literal("")),
  source: z.enum(["web", "referral", "import", "manual"]).optional(),
  accountId: z.string(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
  jobTitle: z.string().max(200).optional(),
  linkedinUrl: z.string().url().max(500).optional().or(z.literal("")),
  doNotContact: z.boolean().optional(),
  avatarUrl: z.string().url().max(500).optional().or(z.literal("")),
  isActive: z.boolean().optional(),
});

export type UpdateContactInput = z.infer<typeof updateContactSchema>;
