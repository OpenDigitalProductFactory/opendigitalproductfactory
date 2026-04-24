import { z } from "zod";

export const TAX_SETUP_MODES = ["unknown", "existing", "new_business"] as const;
export const TAX_SETUP_STATUSES = ["draft", "in_review", "active", "blocked"] as const;
export const TAX_MODELS = ["simple_manual", "externally_calculated", "hybrid"] as const;
export const TAX_TYPES = ["sales_tax", "vat", "gst"] as const;
export const TAX_REGISTRATION_STATUSES = ["draft", "active", "inactive", "pending"] as const;
export const TAX_FILING_FREQUENCIES = [
  "monthly",
  "quarterly",
  "annual",
  "bi_monthly",
  "half_yearly",
  "custom",
] as const;
export const TAX_FILING_BASES = ["accrual", "cash", "mixed"] as const;
export const TAX_REMITTER_ROLES = ["business", "accountant", "partner"] as const;
export const TAX_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export const updateOrganizationTaxProfileSchema = z.object({
  setupMode: z.enum(TAX_SETUP_MODES),
  setupStatus: z.enum(TAX_SETUP_STATUSES),
  homeCountryCode: z.string().trim().max(2).optional().nullable(),
  primaryRegionCode: z.string().trim().max(12).optional().nullable(),
  taxModel: z.enum(TAX_MODELS),
  externalSystem: z.string().trim().max(80).optional().nullable(),
  footprintSummary: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const createTaxRegistrationSchema = z.object({
  jurisdictionReferenceId: z.string().min(1),
  taxType: z.enum(TAX_TYPES),
  registrationStatus: z.enum(TAX_REGISTRATION_STATUSES),
  registrationNumber: z.string().trim().max(120).optional().nullable(),
  filingFrequency: z.enum(TAX_FILING_FREQUENCIES),
  filingBasis: z.enum(TAX_FILING_BASES).optional().nullable(),
  remitterRole: z.enum(TAX_REMITTER_ROLES),
  effectiveFrom: z.string().min(1),
  portalAccountNotes: z.string().trim().max(500).optional().nullable(),
});

export const verifyTaxRegistrationSchema = z.object({
  registrationId: z.string().min(1),
  verifiedFromSourceUrl: z.url().trim().max(500),
  portalAccountNotes: z.string().trim().max(500).optional().nullable(),
  confidence: z.enum(TAX_CONFIDENCE_LEVELS).default("high"),
});

export type UpdateOrganizationTaxProfileInput = z.infer<typeof updateOrganizationTaxProfileSchema>;
export type CreateTaxRegistrationInput = z.infer<typeof createTaxRegistrationSchema>;
export type VerifyTaxRegistrationInput = z.infer<typeof verifyTaxRegistrationSchema>;
