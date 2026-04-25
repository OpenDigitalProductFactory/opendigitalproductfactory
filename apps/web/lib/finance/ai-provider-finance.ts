import { nanoid } from "nanoid";
import { prisma, type Prisma } from "@dpf/db";
import type {
  ActivateAiProviderContractInput,
  CreateContractUsageSnapshotInput,
  CreateFinanceWorkItemInput,
  SeedAiProviderFinanceBridgeInput,
} from "./ai-provider-finance-validation";

function decimal(value: number | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  return value;
}

function toJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function firstDayOfMonth(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), 1));
}

function lastDayOfMonth(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth() + 1, 0));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function ensureSupplier(input: SeedAiProviderFinanceBridgeInput) {
  const supplierName = input.supplierName ?? input.providerName;
  const existing = await prisma.supplier.findFirst({
    where: { name: supplierName },
    select: { id: true, supplierId: true },
  });

  if (existing) return existing;

  return prisma.supplier.create({
    data: {
      supplierId: `SUP-${nanoid(8)}`,
      name: supplierName,
      paymentTerms: "Net 30",
      defaultCurrency: input.currency ?? "USD",
      notes: `AI provider supplier bridge for ${input.providerId}.`,
      status: "active",
    },
    select: { id: true, supplierId: true },
  });
}

async function createFinanceWorkItem(input: CreateFinanceWorkItemInput) {
  return prisma.financeWorkItem.create({
    data: {
      workItemId: `FWI-${nanoid(8)}`,
      profileId: input.profileId ?? null,
      contractId: input.contractId ?? null,
      supplierId: input.supplierId ?? null,
      ownerEmployeeId: input.ownerEmployeeId ?? null,
      type: input.type,
      status: input.status ?? "open",
      severity: input.severity ?? "medium",
      title: input.title,
      description: input.description ?? null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      metadata: toJson(input.metadata),
    },
    select: { id: true, workItemId: true },
  });
}

export async function seedAiProviderFinanceBridge(input: SeedAiProviderFinanceBridgeInput) {
  const supplier = await ensureSupplier(input);

  const profile = await prisma.aiProviderFinanceProfile.upsert({
    where: { providerId: input.providerId },
    create: {
      providerId: input.providerId,
      supplierId: supplier.id,
      status: "seeded",
      reconciliationStrategy: input.reconciliationStrategy,
      valuationMethod: input.valuationMethod,
      planCurrency: input.currency ?? "USD",
      billingUrl: input.billingUrl ?? null,
      usageUrl: input.usageUrl ?? null,
      monthlyBudget: decimal(input.budgetAmount),
    },
    update: {
      supplierId: supplier.id,
      reconciliationStrategy: input.reconciliationStrategy,
      valuationMethod: input.valuationMethod,
      planCurrency: input.currency ?? "USD",
      billingUrl: input.billingUrl ?? null,
      usageUrl: input.usageUrl ?? null,
      monthlyBudget: decimal(input.budgetAmount),
    },
    select: { id: true, supplierId: true },
  });

  const existingContract = await prisma.supplierContract.findFirst({
    where: { profileId: profile.id, status: { in: ["draft", "active"] } },
    select: { id: true, contractId: true },
    orderBy: { createdAt: "desc" },
  });

  const contract = existingContract ?? await prisma.supplierContract.create({
    data: {
      contractId: `AIC-${nanoid(8)}`,
      profileId: profile.id,
      supplierId: supplier.id,
      accountableEmployeeId: input.accountableEmployeeId ?? null,
      status: "draft",
      contractType: "subscription",
      billingCadence: "monthly",
      currency: input.currency ?? "USD",
      monthlyCommittedAmount: decimal(input.monthlyCommittedAmount),
      budgetAmount: decimal(input.budgetAmount),
      budgetWindow: "monthly",
      usageUnit: input.usageUnit ?? null,
      billingUrl: input.billingUrl ?? null,
      usageUrl: input.usageUrl ?? null,
      allowsOverage: false,
    },
    select: { id: true, contractId: true },
  });

  const missingPlanDetails =
    input.monthlyCommittedAmount === undefined ||
    input.includedQuantity === undefined ||
    !input.usageUnit;

  const workItem = missingPlanDetails
    ? await createFinanceWorkItem({
        profileId: profile.id,
        contractId: contract.id,
        supplierId: supplier.id,
        ownerEmployeeId: input.accountableEmployeeId,
        type: "plan_details_needed",
        status: "open",
        title: `Complete AI plan details for ${input.providerName}`,
        description: "Capture commitment, included allowance, and billing source details for finance ownership.",
        severity: "medium",
      })
    : null;

  return {
    supplierId: supplier.id,
    profileId: profile.id,
    contractId: contract.id,
    workItemId: workItem?.id ?? null,
  };
}

export async function activateAiProviderContract(input: ActivateAiProviderContractInput) {
  const contract = await prisma.supplierContract.update({
    where: { id: input.contractId },
    data: {
      status: "active",
      accountableEmployeeId: input.accountableEmployeeId,
      currency: input.currency,
      monthlyCommittedAmount: decimal(input.monthlyCommittedAmount),
      billingCadence: input.billingCadence,
      budgetAmount: decimal(input.budgetAmount),
      allowsOverage: input.allowsOverage ?? false,
      billingUrl: input.billingUrl ?? null,
      usageUrl: input.usageUrl ?? null,
    },
    select: { id: true, status: true },
  });

  await prisma.contractAllowance.deleteMany({
    where: { contractId: input.contractId },
  });

  await prisma.contractAllowance.createMany({
    data: input.allowances.map((allowance, index) => ({
      contractId: input.contractId,
      allowanceName: allowance.allowanceName,
      usageUnit: allowance.usageUnit,
      includedQuantity: decimal(allowance.includedQuantity)!,
      overageUnitCost: decimal(allowance.overageUnitCost),
      valuationMethod: allowance.valuationMethod,
      sortOrder: index,
    })),
  });

  await prisma.financeWorkItem.updateMany({
    where: {
      contractId: input.contractId,
      type: "plan_details_needed",
      status: { in: ["open", "in_progress"] },
    },
    data: {
      status: "done",
      resolvedAt: new Date(),
    },
  });

  return contract;
}

export function evaluateAiProviderUtilization(input: {
  includedQuantity: number;
  consumedQuantity: number;
  monthlyCommittedAmount: number;
  dayOfMonth: number;
  daysInMonth: number;
}) {
  const utilizationPct = input.includedQuantity > 0
    ? round2((input.consumedQuantity / input.includedQuantity) * 100)
    : 0;
  const projectedMonthEndQuantity = input.dayOfMonth > 0
    ? round2((input.consumedQuantity / input.dayOfMonth) * input.daysInMonth)
    : input.consumedQuantity;
  const remainingQuantity = round2(input.includedQuantity - input.consumedQuantity);
  const unusedQuantity = Math.max(input.includedQuantity - projectedMonthEndQuantity, 0);
  const projectedUnusedValue = input.includedQuantity > 0
    ? round2((unusedQuantity / input.includedQuantity) * input.monthlyCommittedAmount)
    : 0;
  const projectedOverageCost = projectedMonthEndQuantity > input.includedQuantity
    ? round2(projectedMonthEndQuantity - input.includedQuantity)
    : 0;

  const flags: string[] = [];
  if (remainingQuantity / input.includedQuantity <= 0.1) flags.push("critical_low_allowance");
  if (projectedUnusedValue > 0) flags.push("underused_commitment");
  if (projectedMonthEndQuantity > input.includedQuantity) flags.push("overage_risk");

  return {
    utilizationPct,
    projectedMonthEndQuantity,
    remainingQuantity,
    projectedUnusedValue,
    projectedOverageCost,
    flags,
  };
}

export async function createContractUsageSnapshot(input: CreateContractUsageSnapshotInput) {
  return prisma.contractUsageSnapshot.create({
    data: {
      contractId: input.contractId,
      snapshotDate: new Date(input.snapshotDate),
      sourceType: input.sourceType,
      confidence: input.confidence ?? "medium",
      consumedQuantity: decimal(input.consumedQuantity)!,
      includedQuantity: decimal(input.includedQuantity),
      remainingQuantity: decimal(input.remainingQuantity),
      utilizationPct: input.utilizationPct ?? null,
      projectedMonthEndQuantity: decimal(input.projectedMonthEndQuantity),
      projectedUnusedValue: decimal(input.projectedUnusedValue),
      projectedOverageCost: decimal(input.projectedOverageCost),
      metadata: toJson(input.metadata),
    },
  });
}

export async function getAiSpendOverview() {
  const [profiles, contracts, workItems, snapshots] = await Promise.all([
    prisma.aiProviderFinanceProfile.count(),
    prisma.supplierContract.findMany({
      where: { status: { in: ["draft", "active"] } },
      select: {
        id: true,
        status: true,
        monthlyCommittedAmount: true,
      },
    }),
    prisma.financeWorkItem.count({
      where: { status: { in: ["open", "in_progress"] } },
    }),
    prisma.contractUsageSnapshot.findMany({
      orderBy: { snapshotDate: "desc" },
      take: 20,
      select: { projectedUnusedValue: true },
    }),
  ]);

  const committedSpend = contracts.reduce((sum, contract) => sum + Number(contract.monthlyCommittedAmount ?? 0), 0);
  const contractsNeedingSetup = contracts.filter((contract) => contract.status === "draft").length;
  const projectedUnusedCommitment = snapshots.reduce((sum, snapshot) => sum + Number(snapshot.projectedUnusedValue ?? 0), 0);

  return {
    supplierCount: profiles,
    committedSpend,
    contractsNeedingSetup,
    openWorkItems: workItems,
    projectedUnusedCommitment,
  };
}

export async function listAiProviderFinanceProfiles() {
  return prisma.aiProviderFinanceProfile.findMany({
    include: {
      provider: {
        select: {
          providerId: true,
          name: true,
          status: true,
        },
      },
      supplier: {
        select: {
          id: true,
          supplierId: true,
          name: true,
        },
      },
      supplierContracts: {
        include: {
          allowances: {
            orderBy: { sortOrder: "asc" },
          },
          usageSnapshots: {
            orderBy: { snapshotDate: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
      },
      financeWorkItems: {
        where: { status: { in: ["open", "in_progress"] } },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getAiProviderFinanceDetail(providerId: string) {
  return prisma.aiProviderFinanceProfile.findUnique({
    where: { providerId },
    include: {
      supplier: true,
      supplierContracts: {
        include: {
          allowances: true,
          usageSnapshots: {
            orderBy: { snapshotDate: "desc" },
            take: 10,
          },
        },
        orderBy: { createdAt: "desc" },
      },
      financeWorkItems: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
}

export async function getAiSupplierFinanceDetail(supplierId: string) {
  return prisma.supplier.findUnique({
    where: { id: supplierId },
    include: {
      aiProviderProfiles: {
        include: {
          provider: true,
          supplierContracts: {
            include: {
              allowances: true,
              usageSnapshots: {
                orderBy: { snapshotDate: "desc" },
                take: 5,
              },
            },
            orderBy: { createdAt: "desc" },
          },
          financeWorkItems: {
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
      },
    },
  });
}

export async function maybeRunAiProviderFinanceDailyEvaluation(now = new Date()) {
  const contracts = await prisma.supplierContract.findMany({
    where: { status: "active" },
    include: {
      allowances: {
        orderBy: { sortOrder: "asc" },
        take: 1,
      },
      profile: {
        select: {
          providerId: true,
          planCurrency: true,
        },
      },
      usageSnapshots: {
        where: {
          snapshotDate: {
            gte: firstDayOfMonth(now),
            lte: lastDayOfMonth(now),
          },
        },
        orderBy: { snapshotDate: "desc" },
      },
    },
  });

  return Promise.all(contracts.map(async (contract) => {
    const allowance = contract.allowances[0];
    if (!allowance) {
      return createFinanceWorkItem({
        contractId: contract.id,
        supplierId: contract.supplierId,
        ownerEmployeeId: contract.accountableEmployeeId ?? undefined,
        type: "missing_usage_source",
        status: "open",
        severity: "high",
        title: `Add allowance details for ${contract.contractId}`,
      });
    }

    const consumedQuantity = contract.usageSnapshots.reduce(
      (sum, snapshot) => sum + Number(snapshot.consumedQuantity),
      0,
    );
    const utilization = evaluateAiProviderUtilization({
      includedQuantity: Number(allowance.includedQuantity),
      consumedQuantity,
      monthlyCommittedAmount: Number(contract.monthlyCommittedAmount ?? 0),
      dayOfMonth: now.getUTCDate(),
      daysInMonth: lastDayOfMonth(now).getUTCDate(),
    });

    if (utilization.flags.includes("underused_commitment")) {
      await createFinanceWorkItem({
        contractId: contract.id,
        supplierId: contract.supplierId,
        ownerEmployeeId: contract.accountableEmployeeId ?? undefined,
        type: "underused_commitment",
        status: "open",
        severity: "medium",
        title: `Usage is tracking behind plan for ${contract.contractId}`,
        description: "Committed AI spend may go unused this cycle unless usage improves.",
      });
    }

    if (utilization.flags.includes("critical_low_allowance")) {
      await createFinanceWorkItem({
        contractId: contract.id,
        supplierId: contract.supplierId,
        ownerEmployeeId: contract.accountableEmployeeId ?? undefined,
        type: "critical_low_allowance",
        status: "open",
        severity: "critical",
        title: `Allowance is nearly exhausted for ${contract.contractId}`,
      });
    }

    return utilization;
  }));
}

export async function generateDraftBillForAiContract(input: {
  contract: {
    id: string;
    contractId: string;
    supplierId: string;
    currency: string;
    monthlyCommittedAmount: number | Prisma.Decimal | null;
    billingCadence: string;
  };
  cycleDate?: Date;
}) {
  const cycleDate = input.cycleDate ?? new Date();
  const periodKey = cycleDate.toISOString().slice(0, 7);

  const existing = await prisma.bill.findFirst({
    where: {
      supplierId: input.contract.supplierId,
      status: "draft",
      invoiceRef: `${input.contract.contractId}-${periodKey}`,
    },
    select: { id: true, billRef: true },
  });
  if (existing) return existing;

  const totalAmount = Number(input.contract.monthlyCommittedAmount ?? 0);
  const bill = await prisma.bill.create({
    data: {
      billRef: `BILL-${new Date().getUTCFullYear()}-${nanoid(6).toUpperCase()}`,
      supplierId: input.contract.supplierId,
      status: "draft",
      invoiceRef: `${input.contract.contractId}-${periodKey}`,
      issueDate: cycleDate,
      dueDate: new Date(cycleDate.getTime() + 30 * 86400000),
      currency: input.contract.currency,
      subtotal: totalAmount,
      taxAmount: 0,
      totalAmount,
      amountPaid: 0,
      amountDue: totalAmount,
      notes: `Auto-generated from AI supplier contract ${input.contract.contractId}.`,
    },
    select: { id: true, billRef: true },
  });

  await prisma.billLineItem.createMany({
    data: [
      {
        billId: bill.id,
        description: "AI provider monthly commitment",
        quantity: 1,
        unitPrice: totalAmount,
        taxRate: 0,
        taxAmount: 0,
        lineTotal: totalAmount,
        accountCode: null,
        sortOrder: 0,
      },
    ],
  });

  return bill;
}
