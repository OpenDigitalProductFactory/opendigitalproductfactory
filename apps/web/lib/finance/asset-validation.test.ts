import { describe, expect, it } from "vitest";
import {
  createAssetSchema,
  disposeAssetSchema,
  ASSET_CATEGORIES,
  DEPRECIATION_METHODS,
} from "./asset-validation";

const validInput = {
  name: "Dell Laptop",
  category: "IT" as const,
  purchaseDate: "2026-01-15",
  purchaseCost: 1200,
  currency: "GBP",
  depreciationMethod: "straight_line" as const,
  usefulLifeMonths: 36,
  residualValue: 200,
};

// ─── createAssetSchema ─────────────────────────────────────────────────────────

describe("createAssetSchema", () => {
  it("accepts valid input", () => {
    const result = createAssetSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createAssetSchema.safeParse({ ...validInput, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid category", () => {
    const result = createAssetSchema.safeParse({ ...validInput, category: "gadget" });
    expect(result.success).toBe(false);
  });

  it("rejects negative purchaseCost", () => {
    const result = createAssetSchema.safeParse({ ...validInput, purchaseCost: -500 });
    expect(result.success).toBe(false);
  });

  it("rejects zero purchaseCost", () => {
    const result = createAssetSchema.safeParse({ ...validInput, purchaseCost: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects zero usefulLifeMonths", () => {
    const result = createAssetSchema.safeParse({ ...validInput, usefulLifeMonths: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative usefulLifeMonths", () => {
    const result = createAssetSchema.safeParse({ ...validInput, usefulLifeMonths: -12 });
    expect(result.success).toBe(false);
  });

  it("accepts all valid ASSET_CATEGORIES", () => {
    for (const category of ASSET_CATEGORIES) {
      const result = createAssetSchema.safeParse({ ...validInput, category });
      expect(result.success).toBe(true);
    }
  });

  it("accepts all valid DEPRECIATION_METHODS", () => {
    for (const depreciationMethod of DEPRECIATION_METHODS) {
      const result = createAssetSchema.safeParse({ ...validInput, depreciationMethod });
      expect(result.success).toBe(true);
    }
  });

  it("defaults currency to GBP when omitted", () => {
    const { currency: _, ...withoutCurrency } = validInput;
    const result = createAssetSchema.safeParse(withoutCurrency);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("GBP");
    }
  });

  it("defaults depreciationMethod to straight_line when omitted", () => {
    const { depreciationMethod: _, ...withoutMethod } = validInput;
    const result = createAssetSchema.safeParse(withoutMethod);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.depreciationMethod).toBe("straight_line");
    }
  });

  it("defaults residualValue to 0 when omitted", () => {
    const { residualValue: _, ...withoutResidual } = validInput;
    const result = createAssetSchema.safeParse(withoutResidual);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.residualValue).toBe(0);
    }
  });

  it("accepts optional location, serialNumber, notes", () => {
    const result = createAssetSchema.safeParse({
      ...validInput,
      location: "Office 3B",
      serialNumber: "SN-12345",
      notes: "Purchased for dev team",
    });
    expect(result.success).toBe(true);
  });
});

// ─── disposeAssetSchema ────────────────────────────────────────────────────────

describe("disposeAssetSchema", () => {
  it("accepts valid input with disposalAmount", () => {
    const result = disposeAssetSchema.safeParse({ disposalAmount: 500 });
    expect(result.success).toBe(true);
  });

  it("accepts zero disposalAmount (written off for nothing)", () => {
    const result = disposeAssetSchema.safeParse({ disposalAmount: 0 });
    expect(result.success).toBe(true);
  });

  it("rejects negative disposalAmount", () => {
    const result = disposeAssetSchema.safeParse({ disposalAmount: -100 });
    expect(result.success).toBe(false);
  });

  it("accepts optional disposedAt date", () => {
    const result = disposeAssetSchema.safeParse({
      disposalAmount: 300,
      disposedAt: "2026-03-15",
    });
    expect(result.success).toBe(true);
  });

  it("accepts input without disposedAt", () => {
    const result = disposeAssetSchema.safeParse({ disposalAmount: 150 });
    expect(result.success).toBe(true);
  });
});
