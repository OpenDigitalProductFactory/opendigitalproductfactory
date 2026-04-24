import { z } from "zod";

export const TAX_SETUP_MODES = ["unknown", "existing", "new_business"] as const;
export const TAX_SETUP_STATUSES = ["draft", "in_review", "active", "blocked"] as const;
export const TAX_MODELS = ["simple_manual", "externally_calculated", "hybrid"] as const;
export const TAX_FILING_OWNERS = ["business", "accountant", "tax_partner", "dpf_coworker"] as const;
export const TAX_HANDOFF_MODES = [
  "dpf_readiness_only",
  "external_filing",
  "shared_handoff",
] as const;
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
export const TAX_FILING_ARTIFACT_TYPES = [
  "workpaper",
  "export",
  "confirmation",
  "supporting_note",
] as const;

const blankToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => {
    if (typeof value === "string" && value.trim().length === 0) {
      return null;
    }
    return value;
  }, schema.nullable().optional());

export const updateOrganizationTaxProfileSchema = z.object({
  setupMode: z.enum(TAX_SETUP_MODES),
  setupStatus: z.enum(TAX_SETUP_STATUSES),
  homeCountryCode: z.string().trim().max(2).optional().nullable(),
  primaryRegionCode: z.string().trim().max(12).optional().nullable(),
  taxModel: z.enum(TAX_MODELS),
  filingOwner: z.enum(TAX_FILING_OWNERS),
  handoffMode: z.enum(TAX_HANDOFF_MODES),
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

export const prepareTaxFilingPacketSchema = z.object({
  periodId: z.string().min(1),
});

export const addTaxFilingArtifactSchema = z.object({
  periodId: z.string().min(1),
  artifactType: z.enum(TAX_FILING_ARTIFACT_TYPES),
  storageKey: blankToNull(z.string().trim().max(255)),
  externalRef: blankToNull(z.string().trim().max(255)),
  sourceUrl: blankToNull(z.url().trim().max(500)),
  notes: blankToNull(z.string().trim().max(2000)),
});

export type UpdateOrganizationTaxProfileInput = z.infer<typeof updateOrganizationTaxProfileSchema>;
export type CreateTaxRegistrationInput = z.infer<typeof createTaxRegistrationSchema>;
export type VerifyTaxRegistrationInput = z.infer<typeof verifyTaxRegistrationSchema>;
export type PrepareTaxFilingPacketInput = z.infer<typeof prepareTaxFilingPacketSchema>;
export type AddTaxFilingArtifactInput = z.infer<typeof addTaxFilingArtifactSchema>;
