import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    address: {
      create: vi.fn(),
      update: vi.fn(),
    },
    employeeAddress: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  createEmployeeAddress,
  updateAddress,
  deleteEmployeeAddress,
  setPrimaryAddress,
} from "./address";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// createEmployeeAddress
// ---------------------------------------------------------------------------
describe("createEmployeeAddress", () => {
  const validInput = {
    employeeProfileId: "emp-1",
    label: "home",
    addressLine1: "123 Main St",
    addressLine2: null,
    cityId: "city-1",
    postalCode: "2000",
    isPrimary: false,
  };

  it("rejects invalid label", async () => {
    const result = await createEmployeeAddress({ ...validInput, label: "vacation" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/label/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects empty addressLine1", async () => {
    const result = await createEmployeeAddress({ ...validInput, addressLine1: "   " });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/address line/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects empty postalCode", async () => {
    const result = await createEmployeeAddress({ ...validInput, postalCode: "" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/postal/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects empty cityId", async () => {
    const result = await createEmployeeAddress({ ...validInput, cityId: "" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/city/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates address and link in a transaction", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        employeeAddress: {
          updateMany: vi.fn(),
        },
        address: {
          create: vi.fn().mockResolvedValue({ id: "addr-1" }),
        },
        employeeAddress2: {
          create: vi.fn().mockResolvedValue({ id: "ea-1" }),
        },
      };
      // The function receives a tx object with the same shape as prisma
      const txProxy = {
        employeeAddress: {
          updateMany: tx.employeeAddress.updateMany,
          create: tx.employeeAddress2.create,
        },
        address: tx.address,
      };
      return fn(txProxy);
    });

    const result = await createEmployeeAddress(validInput);

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/created/i);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/employee");
  });

  it("unsets existing primary when isPrimary is true", async () => {
    const updateManyMock = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const txProxy = {
        employeeAddress: {
          updateMany: updateManyMock,
          create: vi.fn().mockResolvedValue({ id: "ea-1" }),
        },
        address: {
          create: vi.fn().mockResolvedValue({ id: "addr-1" }),
        },
      };
      return fn(txProxy);
    });

    await createEmployeeAddress({ ...validInput, isPrimary: true });

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { employeeProfileId: "emp-1", isPrimary: true },
      data: { isPrimary: false },
    });
  });
});

// ---------------------------------------------------------------------------
// updateAddress
// ---------------------------------------------------------------------------
describe("updateAddress", () => {
  it("rejects invalid label if provided", async () => {
    const result = await updateAddress("addr-1", { label: "beach" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/label/i);
    expect(prisma.address.update).not.toHaveBeenCalled();
  });

  it("updates address fields", async () => {
    vi.mocked(prisma.address.update).mockResolvedValue({} as any);
    const result = await updateAddress("addr-1", { addressLine1: "456 New St" });
    expect(result.ok).toBe(true);
    expect(prisma.address.update).toHaveBeenCalledWith({
      where: { id: "addr-1" },
      data: { addressLine1: "456 New St" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/employee");
  });

  it("accepts valid label values", async () => {
    vi.mocked(prisma.address.update).mockResolvedValue({} as any);
    const result = await updateAddress("addr-1", { label: "work" });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteEmployeeAddress
// ---------------------------------------------------------------------------
describe("deleteEmployeeAddress", () => {
  it("soft-deletes the address and removes the join row", async () => {
    vi.mocked(prisma.employeeAddress.findUnique).mockResolvedValue({
      id: "ea-1",
      addressId: "addr-1",
      employeeProfileId: "emp-1",
      isPrimary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.employeeAddress.delete).mockResolvedValue({} as any);
    vi.mocked(prisma.address.update).mockResolvedValue({} as any);

    const result = await deleteEmployeeAddress("ea-1");

    expect(result.ok).toBe(true);
    expect(prisma.employeeAddress.delete).toHaveBeenCalledWith({
      where: { id: "ea-1" },
    });
    expect(prisma.address.update).toHaveBeenCalledWith({
      where: { id: "addr-1" },
      data: { status: "inactive" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/employee");
  });

  it("returns error when link not found", async () => {
    vi.mocked(prisma.employeeAddress.findUnique).mockResolvedValue(null);

    const result = await deleteEmployeeAddress("ea-missing");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// setPrimaryAddress
// ---------------------------------------------------------------------------
describe("setPrimaryAddress", () => {
  it("unsets previous primary and sets new one atomically", async () => {
    vi.mocked(prisma.employeeAddress.findUnique).mockResolvedValue({
      id: "ea-2",
      addressId: "addr-2",
      employeeProfileId: "emp-1",
      isPrimary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const updateManyMock = vi.fn();
    const updateMock = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const txProxy = {
        employeeAddress: {
          updateMany: updateManyMock,
          update: updateMock,
        },
      };
      return fn(txProxy);
    });

    const result = await setPrimaryAddress("ea-2");

    expect(result.ok).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { employeeProfileId: "emp-1", isPrimary: true },
      data: { isPrimary: false },
    });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "ea-2" },
      data: { isPrimary: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/employee");
  });

  it("returns error when link not found", async () => {
    vi.mocked(prisma.employeeAddress.findUnique).mockResolvedValue(null);

    const result = await setPrimaryAddress("ea-missing");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not found/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
