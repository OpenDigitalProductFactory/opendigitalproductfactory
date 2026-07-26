import { z } from "zod";

export const BILL_STATUSES = ["draft", "awaiting_approval", "approved", "partially_paid", "paid", "void"] as const;
export const PO_STATUSES = ["draft", "sent", "acknowledged", "received", "cancelled"] as const;
export const SUPPLIER_STATUSES = ["active", "inactive", "blocked", "onboarding"] as const;

export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

export const createSupplierSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  taxId: z.string().optional(),
  paymentTerms: z.string().default("Net 30"),
  defaultCurrency: z.string().length(3).default("USD"),
  notes: z.string().optional(),
  category: z.string().optional(),
  preferredStatus: z.boolean().optional().default(false),
});

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  status: z.enum(SUPPLIER_STATUSES).optional(),
});

export const supplierOnboardingChecklistSchema = z.object({
  hasTaxId: z.boolean(),
  hasBankDetails: z.boolean(),
  hasSignedContract: z.boolean(),
  hasInsuranceCertificate: z.boolean(),
});

export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type SupplierOnboardingChecklist = z.infer<typeof supplierOnboardingChecklistSchema>;

const billLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  taxRate: z.number().min(0).max(100).default(0),
  accountCode: z.string().optional(),
});

export const createBillSchema = z.object({
  supplierId: z.string().min(1),
  invoiceRef: z.string().optional(),
  issueDate: z.string().min(1),
  dueDate: z.string().min(1),
  currency: z.string().length(3).default("USD"),
  purchaseOrderId: z.string().optional(),
  notes: z.string().optional(),
  lineItems: z.array(billLineItemSchema).min(1),
});

export const updateBillSchema = z.object({
  status: z.enum(BILL_STATUSES).optional(),
  notes: z.string().optional(),
});

const poLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  taxRate: z.number().min(0).max(100).default(0),
});

export const createPOSchema = z.object({
  supplierId: z.string().min(1),
  currency: z.string().length(3).default("USD"),
  deliveryDate: z.string().optional(),
  terms: z.string().optional(),
  notes: z.string().optional(),
  lineItems: z.array(poLineItemSchema).min(1),
});

export const createPaymentRunSchema = z.object({
  billIds: z.array(z.string().min(1)).min(1),
  consolidatePerSupplier: z.boolean().default(true),
});

export type CreateSupplierInput = z.input<typeof createSupplierSchema>;
export type CreateBillInput = z.input<typeof createBillSchema>;
export type UpdateBillInput = z.infer<typeof updateBillSchema>;
export type CreatePOInput = z.input<typeof createPOSchema>;
export type CreatePaymentRunInput = z.input<typeof createPaymentRunSchema>;
