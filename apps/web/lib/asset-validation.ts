import { z } from "zod";

export const ASSET_CATEGORIES = ["equipment", "vehicle", "furniture", "IT", "property", "other"] as const;
export const DEPRECIATION_METHODS = ["straight_line", "reducing_balance"] as const;
export const ASSET_STATUSES = ["active", "disposed", "written_off"] as const;

export const createAssetSchema = z.object({
  name: z.string().min(1),
  category: z.enum(ASSET_CATEGORIES),
  purchaseDate: z.string().min(1),
  purchaseCost: z.number().positive(),
  currency: z.string().length(3).default("GBP"),
  depreciationMethod: z.enum(DEPRECIATION_METHODS).default("straight_line"),
  usefulLifeMonths: z.number().int().positive(),
  residualValue: z.number().min(0).default(0),
  location: z.string().optional(),
  serialNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const disposeAssetSchema = z.object({
  disposalAmount: z.number().min(0),
  disposedAt: z.string().optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type DisposeAssetInput = z.infer<typeof disposeAssetSchema>;
